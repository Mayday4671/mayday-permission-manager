package com.mayday.common.persistence;

import java.util.List;
import java.util.function.Function;

import com.mybatisflex.core.paginate.Page;

/** 前端统一使用从 1 开始的分页；限制每页最多 100 条，避免无界列表查询。 */
public record PageResult<T>(List<T> items, long total, int page, int size) {
    /** 将已经执行数据范围过滤的数据库分页转换为页面约定，保留总数并保持页码从 1 开始。 */
    public static <T> PageResult<T> from(Page<T> data)
    {
        return new PageResult<>(data.getRecords(), data.getTotalRow(), (int) data.getPageNumber(),
                (int) data.getPageSize());
    }

    /** 分页查询与视图转换共用同一次数据库结果，避免先取整页实体再丢失总数。 */
    public static <T, R> PageResult<R> of(Page<T> data, Function<T, R> mapper)
    {
        return from(data.map(mapper));
    }

    /** 规范化不可信分页参数；调用方仍需在查询条件里追加资源权限、行级范围和稳定排序。 */
    public static <T> Page<T> request(int page, int size)
    {
        return Page.of(Math.max(1, page), Math.min(100, Math.max(1, size)));
    }
}
