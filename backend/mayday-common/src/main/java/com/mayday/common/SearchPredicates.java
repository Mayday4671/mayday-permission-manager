package com.mayday.common;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Predicate;
import java.util.Locale;

/**
 * 字面量关键词查询的公共入口。用户输入中的百分号和下划线是普通字符，不代表通配符。 显式指定 ! 为 SQL ESCAPE 字符，让 Hibernate 与 MySQL
 * 使用相同规则；不能只转义字符串 却调用没有 escape 参数的 like，否则 ORM 生成的 SQL 可能把反斜杠当普通字符。
 */
public final class SearchPredicates {
  private SearchPredicates() {}

  public static Predicate contains(
      CriteriaBuilder builder, Expression<String> field, String keyword) {
    String escaped =
        keyword == null
            ? ""
            : keyword
                .trim()
                .toLowerCase(Locale.ROOT)
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
    return builder.like(builder.lower(field), "%" + escaped + "%", '!');
  }
}
