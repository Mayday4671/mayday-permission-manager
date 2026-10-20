package com.mayday.bulk.mapper;

import java.util.Optional;

import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import org.apache.ibatis.annotations.Mapper;

/**
 * 导出结果表（sys_bulk_result）的 SQL 收口：正文为 MEDIUMBLOB，写入用 ON DUPLICATE KEY
 * 原子覆盖；语句集中在本层，缓存文件编排仍在服务。
 */
@Mapper
public interface BulkResultMapper
{
    /** 数据库毫秒时间戳；缓存访问时间与作业清理窗口不依赖主机时钟。 */
    default long nowMillis()
    {
        return ((Number) Db.selectObject("select cast(unix_timestamp(current_timestamp(3))*1000 as unsigned)"))
                .longValue();
    }

    /** 发布一份成功正文；同作业重复提交整体覆盖。 */
    default void upsert(long jobId, byte[] content)
    {
        Db.updateBySql(
                "insert into sys_bulk_result(job_id,content,created_at)"
                        + " values(?,?,cast(unix_timestamp(current_timestamp(3))*1000 as unsigned))"
                        + " on duplicate key update content=values(content),created_at=values(created_at)",
                jobId, content);
    }

    /** 读取结果正文；不存在返回空由调用方重建缓存。 */
    default Optional<byte[]> load(long jobId)
    {
        Row row = Db.selectOneBySql("select content from sys_bulk_result where job_id=?", jobId);
        return row == null ? Optional.empty() : Optional.of((byte[]) row.get("content"));
    }
}
