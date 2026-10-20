package com.mayday.common.persistence;

import java.util.Locale;

import com.mybatisflex.core.query.QueryCondition;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.query.RawQueryCondition;

/**
 * 字面量关键词查询的公共入口。用户输入中的百分号和下划线是普通字符，不代表通配符。 显式指定 ! 为 SQL ESCAPE
 * 字符并同步转义输入，让数据库按字面量匹配；不能只转义字符串却省略 escape 子句，否则生成的 SQL 会把转义符当普通字符。
 *
 * <p>
 * 包含条件使用原生片段：列名只来自服务端常量，值通过 ? 占位符按顺序绑定，不拼接用户输入。
 */
public final class SearchPredicates
{
    private SearchPredicates()
    {
    }

    /** 生成大小写无关的字面量包含条件；空关键词匹配所有非空字段，资源与数据范围必须由调用方另外限定。 */
    public static QueryCondition contains(String column, String keyword)
    {
        return containsExpression("lower(" + column + ")", keyword);
    }

    /** 关键词的转义结果；供子查询里的 like 直接绑定，转义规则与 contains 一致。 */
    public static String escapedLiteral(String keyword)
    {
        return keyword == null
                ? ""
                : keyword.trim().toLowerCase(Locale.ROOT).replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    /** 与 contains 相同的字面量规则，但作用于调用方给出的 SQL 表达式；表达式只能由服务端常量拼接。 */
    public static QueryCondition containsExpression(String expression, String keyword)
    {
        String escaped = keyword == null
                ? ""
                : keyword.trim().toLowerCase(Locale.ROOT).replace("!", "!!").replace("%", "!%").replace("_", "!_");
        return new RawQueryCondition(expression + " like ? escape '!'", "%" + escaped + "%");
    }

    /** 把多个包含条件按“任一命中”合并进当前查询；调用方保证列同属一张表。 */
    public static QueryWrapper anyOf(QueryWrapper wrapper, QueryCondition... conditions)
    {
        QueryCondition merged = null;
        for (QueryCondition condition : conditions)
        {
            if (condition == null)
            {
                continue;
            }
            merged = merged == null ? condition : merged.or(condition);
        }
        return merged == null ? wrapper : wrapper.and(merged);
    }
}
