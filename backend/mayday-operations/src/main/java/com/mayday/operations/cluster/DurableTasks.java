package com.mayday.operations.cluster;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Supplier;

import com.mayday.common.exception.BusinessException;
import com.mayday.operations.cluster.mapper.DurableTaskMapper;
import com.mybatisflex.core.row.Row;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 可复用 MySQL 持久队列。稳定业务键防重复提交，SKIP LOCKED 领取不阻塞其他任务，随机租约令牌隔离旧工作器。
 * 网络和文件处理不得持队列锁；业务提交使用 fenced，和租约核对在同一事务中完成。外部副作用须使用稳定业务键自行幂等。
 */
@Service
public class DurableTasks
{
    private final DurableTaskMapper queue;
    private final TransactionTemplate transaction;
    private final String instance = UUID.randomUUID().toString();
    private final long leaseMillis;

    /** 租约不依靠主机时钟；每次启动有新实例标识，不把上次进程的所有权继承给当前进程。 */
    public DurableTasks(DurableTaskMapper queue, PlatformTransactionManager manager,
            @Value("${mayday.tasks.lease-seconds:90}") int leaseSeconds)
    {
        if (leaseSeconds < 15 || leaseSeconds > 300)
        {
            throw new IllegalStateException("任务租约须为 15–300 秒");
        }
        this.queue = queue;
        leaseMillis = leaseSeconds * 1000L;
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setTimeout(30);
    }

    private long now()
    {
        return queue.nowMillis();
    }

    /** 同一类型和业务键只能有一个作业；不同内容不能借旧键覆盖已排队或完成的任务。 */
    public long enqueue(String type, String key, String payload, int maxAttempts)
    {
        if (!type.matches("[A-Z][A-Z0-9_]{0,63}") || key.isBlank() || key.length() > 128 || payload == null
                || payload.length() > 10000 || maxAttempts < 1 || maxAttempts > 10)
        {
            throw new BusinessException("后台任务参数无效");
        }
        return transaction.execute(status -> {
            long now = now();
            queue.enqueue(type, key, payload, maxAttempts, now);
            Row existing = queue.lockByKey(type, key);
            if (!Objects.equals(existing.getString("payload"), payload))
            {
                throw new BusinessException("任务标识已用于不同内容");
            }
            return existing.getLong("id");
        });
    }

    /** 到期租约可由任意实例重新领取；达到重试上限明确失败，不能无限占用队列。 */
    public Lease claim(String type)
    {
        return claim(type, null);
    }

    /** 手动执行指定稳定业务键；不得为了同步回执误领其他配置的排队工作。 */
    public Lease claim(String type, String key)
    {
        return transaction.execute(status -> {
            long now = now();
            Row claimed = queue.claimRow(type, key, now);
            if (claimed == null)
            {
                return null;
            }
            Lease lease = new Lease(claimed.getLong("id"), claimed.getString("task_type"),
                    claimed.getString("business_key"), claimed.getString("payload"), UUID.randomUUID().toString(),
                    claimed.getInt("attempts") + 1);
            if (lease.attempt() > queue.maxAttempts(lease.id()))
            {
                queue.markFailedByCap(lease.id(), now);
                return null;
            }
            queue.markRunning(lease.id(), lease.attempt(), instance, lease.token(), now + leaseMillis, now);
            return lease;
        });
    }

    /** 心跳只延长仍有效的原租约；过期令牌不能凭一次迟到的心跳抢回已丢失的所有权。 */
    public boolean heartbeat(Lease lease)
    {
        long now = now();
        return queue.heartbeat(lease.id(), lease.token(), now + leaseMillis, now) == 1;
    }

    /** 业务写入持任务行锁并在提交前再次核验时间；暂停很久或取消的旧工作器不能提交成功。 */
    public <T> T fenced(Lease lease, Supplier<T> work)
    {
        return transaction.execute(status -> {
            if (!validLocked(lease))
            {
                throw new LostLease();
            }
            T result = work.get();
            if (!validLocked(lease))
            {
                throw new LostLease();
            }
            return result;
        });
    }

    private boolean validLocked(Lease lease)
    {
        return queue.validForUpdate(lease.id(), lease.token(), now());
    }

    /** 完成与业务输出写入可以位于同一 fenced 事务；成功以后任何旧令牌不能再次改状态。 */
    public void complete(Lease lease)
    {
        finish(lease, () -> null);
    }

    /** 业务结果与队列成功同事务提交；若结果提交时已超过租约期限，整笔结果回滚供新实例恢复。 */
    public <T> T finish(Lease lease, Supplier<T> work)
    {
        return transaction.execute(status -> {
            if (!validLocked(lease))
            {
                throw new LostLease();
            }
            T result = work.get();
            if (!validLocked(lease))
            {
                throw new LostLease();
            }
            queue.markSucceeded(lease.id(), now());
            return result;
        });
    }

    /** 重试退避保留同一业务键；仅脱敏固定错误说明入库，不持久化网络异常凭据或业务正文。 */
    public void failed(Lease lease, String explanation, boolean retryable)
    {
        failed(lease, explanation, retryable, next -> {
        });
    }

    /** 失败/重排与注册业务进度一起提交，旧工作器不能在新工作器完成后覆盖业务状态。 */
    public void failed(Lease lease, String explanation, boolean retryable, Consumer<String> update)
    {
        transaction.executeWithoutResult(status -> {
            if (!validLocked(lease))
            {
                return;
            }
            int max = queue.maxAttempts(lease.id());
            String next = retryable && lease.attempt() < max ? "QUEUED" : "FAILED";
            queue.markOutcome(lease.id(), next, explanation.substring(0, Math.min(300, explanation.length())),
                    now() + Math.min(60000, 1000L << Math.min(6, lease.attempt())), now());
            update.accept(next);
        });
    }

    /** 取消立即作废所有租约；调用方先完成任务归属及资源权限检查，不能以队列 ID 作为授权凭证。 */
    public void cancel(String type, String key)
    {
        cancel(type, key, () -> {
        });
    }

    /** 队列状态与业务取消回执共用事务；不存在取消队列成功但业务仍显示运行的恢复空洞。 */
    public boolean cancel(String type, String key, Runnable update)
    {
        return transaction.execute(status -> {
            int changed = queue.cancelQueuedOrRunning(type, key, now());
            if (changed == 1)
            {
                update.run();
            }
            return changed == 1;
        });
    }

    /** 失败或取消后由明确操作恢复，清零本轮尝试次数但保留原作业身份和历史创建时间。 */
    public boolean retry(String type, String key)
    {
        return retry(type, key, () -> {
        });
    }

    /** 恢复队列与业务重试回执共用事务；注册业务在 callback 内重新检查并发额度和版本。 */
    public boolean retry(String type, String key, Runnable update)
    {
        return transaction.execute(status -> {
            int changed = queue.retryFailed(type, key, now());
            if (changed == 1)
            {
                update.run();
            }
            return changed == 1;
        });
    }

    /** 仅对仍处于目标终态的队列协调业务显示，取消/重试竞争时由队列行锁决定先后。 */
    public void synchronizeTerminal(String type, String key, Consumer<String> update)
    {
        transaction.executeWithoutResult(status -> {
            Row locked = queue.lockStatus(type, key);
            if (locked != null && Set.of("FAILED", "CANCELLED").contains(locked.getString("status")))
            {
                update.accept(locked.getString("status"));
            }
        });
    }

    /** 状态只供注册业务协调自己的公开进度；不存在匿名查询全部队列的入口。 */
    public String state(String type, String key)
    {
        return queue.status(type, key);
    }

    /** 队列行与业务回执共用短事务；返回原有终态，不能因网络重试重新发布成功或抹掉执行历史。 */
    public <T> T inspect(String type, String key, Supplier<T> view)
    {
        return transaction.execute(status -> {
            queue.lockRow(type, key);
            return view.get();
        });
    }

    /** 领取快照只能由服务端生成；token 是写入隔离凭据，绝不返回到普通任务接口。 */
    public record Lease(long id, String type, String key, String payload, String token, int attempt) {
    }

    /** 原租约失效是正常竞争结果，调用方丢弃自己的临时输出，不能标失败覆盖新工作器。 */
    public static final class LostLease extends RuntimeException
    {
        public LostLease()
        {
            super("任务租约已失效");
        }
    }
}
