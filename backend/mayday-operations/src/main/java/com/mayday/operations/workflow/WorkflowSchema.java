package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 运行引擎和设计器共用的发布契约。只支持无循环的审批/条件/结束节点，禁止把未实现的节点保存为可执行流程。 所有 ID 均稳定且与显示名称无关；已发布的 JSON
 * 是不可变快照，后续编辑只产生下一发布版本。
 */
public final class WorkflowSchema {
  private WorkflowSchema() {}

  /** 字段 ID 稳定；类型和上下限同时控制前端输入与后端提交，宽度只参与页面排版。 */
  public record Field(
      String id,
      String label,
      String type,
      Boolean required,
      Integer width,
      BigDecimal min,
      BigDecimal max,
      Integer maxLength,
      List<String> options,
      String placeholder,
      String helpText,
      List<Field> columns,
      Integer maxRows) {
    /** 已有发布版本及业务扩展保持原构造签名；新增属性缺失时使用运行端默认值。 */
    public Field(
        String id,
        String label,
        String type,
        Boolean required,
        Integer width,
        BigDecimal min,
        BigDecimal max,
        Integer maxLength,
        List<String> options) {
      this(id, label, type, required, width, min, max, maxLength, options, null, null, null, null);
    }
  }

  /** 条件按列表顺序匹配，next 是稳定节点 ID；全部不命中时使用节点默认出口。 */
  public record Condition(String field, String operator, String value, String next) {}

  /** 节点保存人员来源、会签规则、字段和动作授权；timeoutMinutes 为空表示不自动提醒。 */
  public record Node(
      String id,
      String name,
      String type,
      String next,
      String source,
      List<Long> assigneeIds,
      String mode,
      Set<String> readable,
      Set<String> writable,
      Set<String> actions,
      List<Condition> conditions,
      Integer timeoutMinutes) {
    /** 旧流程 JSON 未包含超时配置时保持原行为，已有 Java 扩展调用也可继续使用原构造签名。 */
    public Node(
        String id,
        String name,
        String type,
        String next,
        String source,
        List<Long> assigneeIds,
        String mode,
        Set<String> readable,
        Set<String> writable,
        Set<String> actions,
        List<Condition> conditions) {
      this(
          id,
          name,
          type,
          next,
          source,
          assigneeIds,
          mode,
          readable,
          writable,
          actions,
          conditions,
          null);
    }

    public Node {
      assigneeIds = assigneeIds == null ? List.of() : List.copyOf(assigneeIds);
      readable = readable == null ? Set.of() : Set.copyOf(readable);
      writable = writable == null ? Set.of() : Set.copyOf(writable);
      actions = actions == null ? Set.of("APPROVE", "REJECT") : Set.copyOf(actions);
      conditions = conditions == null ? List.of() : List.copyOf(conditions);
    }
  }

  /** 发布及提交冻结的完整流程契约，开关不会从未来草稿回灌到历史实例。 */
  public record Spec(
      List<Field> fields,
      List<Node> nodes,
      String startNodeId,
      String applicantType,
      Set<Long> applicantIds,
      Boolean allowSelfApproval,
      Boolean allowRepeatApproval,
      Boolean allowWithdraw) {
    public Spec {
      fields = fields == null ? List.of() : List.copyOf(fields);
      nodes = nodes == null ? List.of() : List.copyOf(nodes);
      applicantIds = applicantIds == null ? Set.of() : Set.copyOf(applicantIds);
    }

    /** 缺少引用节点即终止解析，不能跳过非法节点把未完成申请当作通过。 */
    public Node node(String id) {
      return nodes.stream()
          .filter(n -> n.id().equals(id))
          .findFirst()
          .orElseThrow(() -> new BusinessException("流程节点不存在"));
    }
  }

  public static final Set<String> TYPES =
      Set.of(
          "TEXT",
          "TEXTAREA",
          "NUMBER",
          "MONEY",
          "DATE",
          "DATETIME",
          "DATE_RANGE",
          "DETAILS",
          "SINGLE",
          "MULTI",
          "USER",
          "DEPARTMENT",
          "FILES");

  private static void require(boolean valid, String message) {
    if (!valid) throw new BusinessException(message);
  }

  private static boolean text(String value, int limit) {
    return value != null && !value.isBlank() && value.length() <= limit;
  }

  /** 发布与模拟使用同一验证器。先校验字段，再遍历图中的每一条边，而不是仅检查当前预览路径。 */
  public static void validate(Spec s) {
    require(s != null, "请先配置流程");
    require(s.fields().size() <= 40, "表单最多 40 个字段");
    require(!s.nodes().isEmpty() && s.nodes().size() <= 40, "流程需要 1 至 40 个节点");
    require(
        Set.of("ALL", "USERS", "ROLES", "DEPARTMENTS")
            .contains(Objects.toString(s.applicantType(), "")),
        "请选择发起范围");
    require(
        s.applicantIds().size() <= 100
            && ("ALL".equals(s.applicantType()) || !s.applicantIds().isEmpty()),
        "发起范围不能为空或超过 100 项");
    Set<String> fields = new HashSet<>();
    for (Field f : s.fields()) {
      require(
          f != null
              && f.id() != null
              && f.id().matches("[A-Za-z][A-Za-z0-9_]{0,39}")
              && fields.add(f.id()),
          "字段 ID 必须唯一，只包含字母、数字和下划线");
      require(text(f.label(), 60) && TYPES.contains(Objects.toString(f.type(), "")), "字段名称或类型无效");
      require(f.placeholder() == null || f.placeholder().length() <= 200, "输入提示最多 200 字");
      require(f.helpText() == null || f.helpText().length() <= 500, "字段说明最多 500 字");
      if ("DETAILS".equals(f.type())) {
        require(
            f.columns() != null && !f.columns().isEmpty() && f.columns().size() <= 6,
            "明细表需要 1 至 6 列");
        require(f.maxRows() == null || (f.maxRows() >= 1 && f.maxRows() <= 50), "明细最多 1 至 50 行");
        require(
            f.columns().stream()
                .allMatch(
                    column ->
                        column != null
                            && Set.of(
                                    "TEXT",
                                    "TEXTAREA",
                                    "NUMBER",
                                    "MONEY",
                                    "DATE",
                                    "DATETIME",
                                    "SINGLE")
                                .contains(Objects.toString(column.type(), ""))),
            "明细列只支持文字、数值、日期时间与单选，不能嵌套明细或附件");
        validateFields(f.columns());
      } else require(f.columns() == null || f.columns().isEmpty(), "只有明细表可以配置子列");
      require(f.width() == null || Set.of(12, 24).contains(f.width()), "字段布局只支持半行或整行");
      require(
          f.maxLength() == null || (f.maxLength() >= 1 && f.maxLength() <= 10000),
          "文本长度必须在 1 至 10000 之间");
      require(f.min() == null || f.max() == null || f.min().compareTo(f.max()) <= 0, "数值下限不能大于上限");
      if (Set.of("SINGLE", "MULTI").contains(f.type()))
        require(
            f.options() != null
                && !f.options().isEmpty()
                && f.options().size() <= 50
                && new HashSet<>(f.options()).size() == f.options().size()
                && f.options().stream().allMatch(v -> text(v, 100)),
            "选择项应为 1 至 50 个不重复值");
    }
    Map<String, Node> nodes = new LinkedHashMap<>();
    for (Node n : s.nodes()) {
      require(
          n != null
              && n.id() != null
              && n.id().matches("[A-Za-z][A-Za-z0-9_]{0,39}")
              && !nodes.containsKey(n.id()),
          "节点 ID 必须唯一且格式正确");
      require(
          text(n.name(), 80)
              && Set.of("APPROVAL", "COPY", "CONDITION", "END")
                  .contains(Objects.toString(n.type(), "")),
          "节点名称或类型无效");
      require(
          fields.containsAll(n.readable()) && n.readable().containsAll(n.writable()),
          "可写字段必须同时可读，且字段必须存在");
      if (Set.of("APPROVAL", "COPY").contains(n.type())) {
        require(
            n.timeoutMinutes() == null || (n.timeoutMinutes() >= 1 && n.timeoutMinutes() <= 43200),
            "超时提醒应为 1 至 43200 分钟，留空表示不提醒");
        require(
            Set.of("USERS", "ROLES", "DEPARTMENT_LEADER")
                .contains(Objects.toString(n.source(), "")),
            "请选择审批人来源");
        require(
            "COPY".equals(n.type())
                || Set.of("ANY", "ALL", "SERIAL").contains(Objects.toString(n.mode(), "")),
            "请选择或签、会签或顺签");
        require(
            n.assigneeIds().size() <= 100
                && ("DEPARTMENT_LEADER".equals(n.source()) || !n.assigneeIds().isEmpty()),
            "审批人来源不能为空或超过 100 项");
        require(new HashSet<>(n.assigneeIds()).size() == n.assigneeIds().size(), "审批人来源不能重复");
        require(
            "COPY".equals(n.type())
                || (Set.of("APPROVE", "REJECT", "RETURN", "COMMENT", "TRANSFER", "ADD_SIGN")
                        .containsAll(n.actions())
                    && n.actions().contains("APPROVE")
                    && n.actions().contains("REJECT")),
            "节点至少允许同意和驳回");
        require(
            !"COPY".equals(n.type()) || (n.writable().isEmpty() && n.actions().isEmpty()),
            "抄送节点不能修改字段或审批");
      }
      require("APPROVAL".equals(n.type()) || n.timeoutMinutes() == null, "只有审批节点可以配置超时提醒");
      if ("CONDITION".equals(n.type())) {
        require(!n.conditions().isEmpty() && n.conditions().size() <= 10, "条件节点需要 1 至 10 条规则及默认出口");
        for (Condition c : n.conditions()) {
          require(
              c != null
                  && fields.contains(c.field())
                  && Set.of("EQ", "NE", "GT", "GE", "LT", "LE", "CONTAINS")
                      .contains(Objects.toString(c.operator(), ""))
                  && c.value() != null
                  && c.value().length() <= 1000,
              "分支条件引用或比较值无效");
          Field f =
              s.fields().stream().filter(v -> v.id().equals(c.field())).findFirst().orElseThrow();
          require(
              !Set.of("FILES", "MULTI", "USER", "DEPARTMENT", "DATE_RANGE", "DETAILS")
                  .contains(f.type()),
              "条件暂不支持附件或对象字段");
          if (Set.of("GT", "GE", "LT", "LE").contains(c.operator()))
            require(Set.of("NUMBER", "MONEY").contains(f.type()), "大小比较只适用于数值字段");
          if (Set.of("NUMBER", "MONEY").contains(f.type()) && !"CONTAINS".equals(c.operator())) {
            try {
              new BigDecimal(c.value());
            } catch (Exception e) {
              throw new BusinessException("条件数值无效");
            }
          }
        }
      }
      nodes.put(n.id(), n);
      require("CONDITION".equals(n.type()) || n.conditions().isEmpty(), "只有条件节点可以配置分支规则");
    }
    require(nodes.containsKey(s.startNodeId()), "起始节点不存在");
    Set<String> visiting = new HashSet<>(), done = new HashSet<>();
    walk(s.startNodeId(), nodes, visiting, done);
    require(done.size() == nodes.size(), "存在无法从起点到达的节点");
    require(s.nodes().stream().anyMatch(n -> "APPROVAL".equals(n.type())), "流程至少需要一个审批节点");
    approvalOnEveryPath(s.startNodeId(), nodes, false, new HashSet<>());
  }

  private static void approvalOnEveryPath(
      String id, Map<String, Node> nodes, boolean passed, Set<String> checked) {
    Node n = nodes.get(id);
    passed = passed || "APPROVAL".equals(n.type());
    if (!checked.add(id + ":" + passed)) return;
    if ("END".equals(n.type())) {
      require(passed, "每条分支必须经过至少一个审批节点");
      return;
    }
    approvalOnEveryPath(n.next(), nodes, passed, checked);
    for (Condition c : n.conditions()) approvalOnEveryPath(c.next(), nodes, passed, checked);
  }

  private static void walk(
      String id, Map<String, Node> nodes, Set<String> visiting, Set<String> done) {
    require(nodes.containsKey(id), "节点出口不存在");
    require(!visiting.contains(id), "暂不支持循环流程");
    if (done.contains(id)) return;
    visiting.add(id);
    Node n = nodes.get(id);
    if (!"END".equals(n.type())) {
      walk(n.next(), nodes, visiting, done);
      for (Condition c : n.conditions()) walk(c.next(), nodes, visiting, done);
    }
    visiting.remove(id);
    done.add(id);
  }

  /** 未知字段一律拒绝，避免利用 JSON 额外属性覆盖审批状态、申请人或业务关联。 */
  public static Map<String, Object> form(Spec s, Map<String, Object> raw) {
    return form(s, raw, true);
  }

  /** 草稿允许暂缺必填项，仍严格校验类型、数值边界、未知字段及明细结构。 */
  public static Map<String, Object> form(Spec s, Map<String, Object> raw, boolean required) {
    Map<String, Object> values = raw == null ? Map.of() : raw;
    Map<String, Object> result = new LinkedHashMap<>();
    require(s.fields().stream().map(Field::id).toList().containsAll(values.keySet()), "表单含未登记字段");
    for (Field f : s.fields()) {
      Object value = values.get(f.id());
      boolean empty =
          value == null
              || (value instanceof String v && v.isBlank())
              || (value instanceof Collection<?> v && v.isEmpty());
      require(!required || !Boolean.TRUE.equals(f.required()) || !empty, f.label() + "不能为空");
      if (empty) {
        result.put(f.id(), null);
        continue;
      }
      switch (f.type()) {
        case "DETAILS" -> {
          require(value instanceof List<?>, f.label() + "必须为明细列表");
          List<?> rows = (List<?>) value;
          require(rows.size() <= (f.maxRows() == null ? 20 : f.maxRows()), f.label() + "明细行数超限");
          value =
              rows.stream()
                  .map(
                      row -> {
                        require(row instanceof Map<?, ?>, f.label() + "明细行无效");
                        Map<String, Object> cells = new LinkedHashMap<>();
                        ((Map<?, ?>) row)
                            .forEach(
                                (key, cell) -> {
                                  require(key instanceof String, "明细字段名无效");
                                  cells.put((String) key, cell);
                                });
                        return form(
                            new Spec(
                                f.columns(), List.of(), "", "ALL", Set.of(), false, false, true),
                            cells,
                            required);
                      })
                  .toList();
        }
        case "DATE_RANGE" -> {
          require(value instanceof List<?> && ((List<?>) value).size() == 2, f.label() + "需要起止日期");
          List<?> range = (List<?>) value;
          try {
            LocalDate from = LocalDate.parse(range.get(0).toString());
            LocalDate to = LocalDate.parse(range.get(1).toString());
            require(!from.isAfter(to), f.label() + "结束日期不能早于开始日期");
            value = List.of(from.toString(), to.toString());
          } catch (BusinessException e) {
            throw e;
          } catch (Exception e) {
            throw new BusinessException(f.label() + "日期区间格式无效");
          }
        }
        case "NUMBER", "MONEY" -> {
          BigDecimal number;
          try {
            number = new BigDecimal(value.toString());
          } catch (Exception e) {
            throw new BusinessException(f.label() + "必须是数值");
          }
          require(
              number.precision() <= 18
                  && number.scale() <= ("MONEY".equals(f.type()) ? 2 : 6)
                  && number.abs().compareTo(new BigDecimal("1000000000000000")) <= 0,
              f.label() + "精度或大小超出范围");
          require(
              (f.min() == null || number.compareTo(f.min()) >= 0)
                  && (f.max() == null || number.compareTo(f.max()) <= 0),
              f.label() + "超出允许范围");
          value = number;
        }
        case "MULTI", "FILES" -> {
          require(value instanceof List<?>, f.label() + "必须为列表");
          List<?> list = (List<?>) value;
          require(
              list.size() <= ("FILES".equals(f.type()) ? 8 : 50)
                  && new HashSet<>(list).size() == list.size(),
              f.label() + "数量超限或存在重复");
          if ("MULTI".equals(f.type()))
            require(f.options().containsAll(list), f.label() + "包含无效选项");
          else value = list.stream().map(v -> positiveId(v, f.label())).toList();
        }
        case "USER", "DEPARTMENT" -> value = positiveId(value, f.label());
        default -> {
          require(value instanceof String, f.label() + "必须为文本");
          String text = (String) value;
          require(
              text.length() <= (f.maxLength() == null ? 2000 : f.maxLength()),
              f.label() + "超过最大长度");
          if ("SINGLE".equals(f.type())) require(f.options().contains(text), f.label() + "包含无效选项");
          if ("DATE".equals(f.type()))
            try {
              LocalDate.parse(text);
            } catch (Exception e) {
              throw new BusinessException(f.label() + "日期格式应为 YYYY-MM-DD");
            }
          if ("DATETIME".equals(f.type()))
            try {
              value = LocalDateTime.parse(text).toString();
            } catch (Exception e) {
              throw new BusinessException(f.label() + "日期时间格式无效");
            }
        }
      }
      result.put(f.id(), value);
    }
    return result;
  }

  /** 明细列复用主表字段校验，不绕过稳定 ID、选项和数值规则；没有可执行的子流程。 */
  private static void validateFields(List<Field> columns) {
    Node approval =
        new Node(
            "review",
            "校验",
            "APPROVAL",
            "end",
            "USERS",
            List.of(1L),
            "ALL",
            Set.of(),
            Set.of(),
            Set.of("APPROVE", "REJECT"),
            List.of());
    Node end =
        new Node(
            "end", "结束", "END", null, null, List.of(), null, Set.of(), Set.of(), Set.of(),
            List.of());
    validate(
        new Spec(columns, List.of(approval, end), "review", "ALL", Set.of(), false, false, true));
  }

  /** 人员/部门/文件关联 ID 必须为正整数，不接受小数、科学计数或任意对象。 */
  public static Long positiveId(Object value, String label) {
    try {
      long id = Long.parseLong(value.toString());
      if (id > 0) return id;
    } catch (Exception ignored) {
    }
    throw new BusinessException(label + "关联 ID 无效");
  }

  /** 只执行已经发布校验过的比较运算，不拼接表达式或执行来自页面的脚本。 */
  public static String next(Node n, Map<String, Object> values) {
    if ("CONDITION".equals(n.type()))
      for (Condition c : n.conditions()) {
        Object value = values.get(c.field());
        if (value == null) continue;
        boolean match =
            switch (c.operator()) {
              case "EQ" ->
                  value instanceof Number
                      ? new BigDecimal(value.toString()).compareTo(new BigDecimal(c.value())) == 0
                      : value.toString().equals(c.value());
              case "NE" ->
                  value instanceof Number
                      ? new BigDecimal(value.toString()).compareTo(new BigDecimal(c.value())) != 0
                      : !value.toString().equals(c.value());
              case "CONTAINS" -> value.toString().contains(c.value());
              default -> {
                int compare = new BigDecimal(value.toString()).compareTo(new BigDecimal(c.value()));
                yield switch (c.operator()) {
                  case "GT" -> compare > 0;
                  case "GE" -> compare >= 0;
                  case "LT" -> compare < 0;
                  default -> compare <= 0;
                };
              }
            };
        if (match) return c.next();
      }
    return n.next();
  }
}
