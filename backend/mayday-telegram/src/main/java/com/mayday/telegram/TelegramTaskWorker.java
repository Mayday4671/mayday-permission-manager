package com.mayday.telegram;

import java.util.concurrent.CompletionException;

import com.mayday.common.util.ModuleSwitches;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

/**
 * Processes a single persisted history page per tick outside controller
 * threads.
 */
@Component
@RequiredArgsConstructor
public class TelegramTaskWorker
{
    private final ModuleSwitches modules;
    private final TelegramCollectionService collections;

    /** Module-off environments never claim Telegram work or load a TDLib client. */
    @Scheduled(scheduler = "telegramTaskScheduler", fixedDelayString = "${mayday.telegram.task-delay-ms:1500}", initialDelay = 5000)
    public void tick()
    {
        if (!modules.isEnabled("telegram"))
        {
            return;
        }
        TelegramCollectionTask task = collections.claimNext();
        if (task == null)
        {
            processTrackingTask();
            return;
        }
        try
        {
            collections.commitPage(task, collections.readNextPage(task));
        } catch (TelegramSessionUnavailableException exception)
        {
            collections.waitForAccount(task);
        } catch (AccessDeniedException exception)
        {
            collections.fail(task, "任务所有者已停用或失去 Telegram 采集权限，任务已停止");
        } catch (CompletionException | IllegalArgumentException exception)
        {
            collections.fail(task, "消息链接不可访问、已失效或当前账号无权读取；请核对来源后重新创建任务");
        } catch (RuntimeException exception)
        {
            collections.fail(task, "Telegram 历史读取失败；已保留此前保存的消息，可核对账号连接后重试");
        }
    }

    /** Runs one low-frequency, independently leased channel catch-up page. */
    private void processTrackingTask()
    {
        TelegramCollectionTask task = collections.claimNextTracking();
        if (task == null)
        {
            return;
        }
        try
        {
            collections.commitTrackingPage(task, collections.readTrackingPage(task));
        } catch (TelegramSessionUnavailableException exception)
        {
            collections.waitForTrackingAccount(task);
        } catch (AccessDeniedException exception)
        {
            collections.failTracking(task, "定期拉取已停止：任务所有者已停用或失去 Telegram 访问权限");
        } catch (CompletionException | IllegalArgumentException exception)
        {
            collections.failTracking(task, "定期拉取失败：频道当前不可访问，请核对 Telegram 账号和频道权限");
        } catch (RuntimeException exception)
        {
            collections.failTracking(task, "定期拉取失败；为避免重复请求已自动停止，请检查账号状态后重新启用");
        }
    }
}
