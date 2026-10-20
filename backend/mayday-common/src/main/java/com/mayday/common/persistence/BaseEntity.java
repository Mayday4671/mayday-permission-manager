package com.mayday.common.persistence;

import java.time.LocalDateTime;

import com.mayday.common.util.BusinessTime;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.InsertListener;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.UpdateListener;
import lombok.Getter;
import lombok.Setter;

/**
 * 所有业务实体的公共字段。时间由服务端产生，版本号用于防止并发编辑覆盖他人的修改。
 *
 * <p>
 * MyBatis-Flex 没有持久化上下文：写入即时执行，字段只有被显式赋值后才会进入 SQL。创建与
 * 更新时间通过监听器在语句生成前写入；版本列参与乐观锁，更新影响行数为 0 即代表版本过期，由仓储门面统一转换为冲突异常。
 */
@Getter
@Setter
public abstract class BaseEntity
{
    @Id(keyType = KeyType.Auto)
    private Long id;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    /** 更新语句自动携带当前版本并递增；API 编辑请求必须携带读取到的版本，禁止把它当作可自由赋值的业务字段。 */
    @Column(version = true)
    private Long version;

    /** 首次保存统一生成服务端时间，不能信任客户端传入的创建时间。 */
    public static class CreatedAtListener implements InsertListener
    {
        @Override
        public void onInsert(Object entity)
        {
            if (entity instanceof BaseEntity base)
            {
                LocalDateTime now = BusinessTime.now();
                base.setCreatedAt(now);
                base.setUpdatedAt(now);
            }
        }
    }

    /** 只刷新修改时间；创建时间保持不可变，供历史排序和审计追溯。 */
    public static class UpdatedAtListener implements UpdateListener
    {
        @Override
        public void onUpdate(Object entity)
        {
            if (entity instanceof BaseEntity base)
            {
                base.setUpdatedAt(BusinessTime.now());
            }
        }
    }
}
