package com.mayday.telegram.mapper;

import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramAccount;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import org.apache.ibatis.annotations.Mapper;

/**
 * Telegram 唯一账号槽位的数据访问边界。
 *
 * <p>
 * 槽位只允许一条记录；MySQL 唯一约束与 INSERT IGNORE 处理多实例同时首次连接的竞争，不能在 Java 内存中假定全局互斥。
 */
@Mapper
public interface TelegramAccountMapper extends EntityMapper<TelegramAccount>
{
    /** 幂等创建唯一账号槽位；已有槽位的 owner 不会被后续连接请求覆盖。 */
    default int ensurePrimarySlot(Long ownerId, Long departmentId)
    {
        return Db.updateBySql("insert ignore into biz_telegram_account"
                + " (account_slot, owner_id, department_id, authorization_state, created_at, updated_at, version)"
                + " values ('primary', ?, ?, 'NOT_CONNECTED', now(6), now(6), 0)", ownerId, departmentId);
    }

    /** 读取唯一账号槽位；调用方必须再次执行所有者与动作权限校验。 */
    default Optional<TelegramAccount> findPrimary()
    {
        return Optional.ofNullable(
                selectOneByQuery(QueryWrapper.create().where(new QueryColumn("account_slot").eq("primary"))));
    }
}
