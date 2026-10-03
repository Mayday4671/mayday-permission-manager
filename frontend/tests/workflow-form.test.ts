import assert from "node:assert/strict";
import test from "node:test";
import {
  copyWorkflowField,
  createWorkflowField,
  insertWorkflowField,
  MAX_WORKFLOW_FIELDS,
  moveWorkflowField,
  removeWorkflowField,
  validateWorkflowFormReferences,
  validateWorkflowFormValues,
  validateWorkflowFields,
} from "../src/lib/workflowForm";
import {
  fieldNames,
  initialSpec,
  type FieldType,
  type WorkflowField,
  type WorkflowSpec,
} from "../src/types/workflow";

/** 合成定义覆盖编排与发布字段契约，不读取令牌、请求真实 API 或改动业务流程。 */
function model(fields: WorkflowField[]): WorkflowSpec {
  const spec = initialSpec();
  spec.fields = fields;
  spec.nodes[0].readable = fields.map((field) => field.id);
  spec.nodes[0].writable = fields.slice(0, 1).map((field) => field.id);
  return spec;
}

function text(id: string, label = id): WorkflowField {
  return { id, label, type: "TEXT" };
}

function fieldIds(spec: WorkflowSpec): string[] {
  return spec.fields.map((field) => field.id);
}

test("13 种控件创建完整有效默认值，稳定 ID 使用首个空闲编号", () => {
  const existing = [text("field_1"), text("field_3"), text("business_code")];
  const original = structuredClone(existing);
  for (const type of Object.keys(fieldNames) as FieldType[]) {
    const field = createWorkflowField(type, existing);
    assert.equal(field.id, "field_2");
    assert.equal(field.type, type);
    assert.equal(field.label, fieldNames[type]);
    assert.equal(field.required, false);
    assert.deepEqual(validateWorkflowFields([field]), []);
    if (type === "SINGLE" || type === "MULTI")
      assert.deepEqual(field.options, ["选项1", "选项2"]);
    if (type === "DETAILS") {
      assert.equal(field.width, 24);
      assert.equal(field.maxRows, 20);
      assert.deepEqual(
        field.columns?.map((column) => column.id),
        ["item", "amount"],
      );
    }
  }
  assert.deepEqual(existing, original);
});

test("头部、中间和末尾精确插入，新增字段不扩展原节点读写或改变连线", () => {
  const source = model([text("first"), text("second")]);
  const original = structuredClone(source);
  for (const index of [0, 1, 2]) {
    const result = insertWorkflowField(source, index, "MONEY");
    const expected = ["first", "second"];
    expected.splice(index, 0, "field_1");
    assert.deepEqual(fieldIds(result), expected);
    assert.deepEqual(result.nodes, source.nodes);
    assert.equal(result.startNodeId, source.startNodeId);
  }
  assert.deepEqual(source, original);
});

test("向前、向后和末尾移动使用插入排序，中间字段不会被交换或重建 ID", () => {
  const source = model(["a", "b", "c", "d"].map((id) => text(id)));
  const original = structuredClone(source);
  assert.deepEqual(fieldIds(moveWorkflowField(source, "d", "b")), [
    "a",
    "d",
    "b",
    "c",
  ]);
  assert.deepEqual(fieldIds(moveWorkflowField(source, "a", "d")), [
    "b",
    "c",
    "a",
    "d",
  ]);
  assert.deepEqual(fieldIds(moveWorkflowField(source, "b", null)), [
    "a",
    "c",
    "d",
    "b",
  ]);
  const unchanged = moveWorkflowField(source, "b", "b");
  assert.deepEqual(unchanged, source);
  assert.notEqual(unchanged, source);
  for (const result of [moveWorkflowField(source, "a", "d"), unchanged])
    assert.deepEqual(result.nodes, source.nodes);
  assert.deepEqual(source, original);
});

test("复制在原后插入，明细列标识保持局部作用域，副本数组和授权互不共享", () => {
  const details = createWorkflowField("DETAILS", []);
  details.label = "费用明细";
  const source = model([text("memo"), details, text("last")]);
  const original = structuredClone(source);
  const result = copyWorkflowField(source, details.id);
  assert.deepEqual(fieldIds(result), ["memo", "field_1", "field_2", "last"]);
  const copy = result.fields[2];
  assert.equal(copy.label, "费用明细（副本）");
  assert.deepEqual(copy.columns, details.columns);
  assert.notEqual(copy.columns, details.columns);
  assert.notEqual(copy.columns?.[0], details.columns?.[0]);
  assert.deepEqual(result.nodes, source.nodes);
  assert.equal(result.nodes[0].readable?.includes(copy.id), false);
  copy.columns![0].label = "副本项目";
  assert.equal(result.fields[1].columns?.[0].label, "项目");
  assert.deepEqual(source, original);
});

test("复制选择项深拷贝且标题不超过 Java 的 60 字符边界", () => {
  const field = createWorkflowField("SINGLE", []);
  field.label = "长".repeat(60);
  const source = model([field]);
  const result = copyWorkflowField(source, field.id);
  const copy = result.fields[1];
  assert.equal(copy.label.length, 60);
  assert.ok(copy.label.endsWith("（副本）"));
  copy.options!.push("新选项");
  assert.deepEqual(source.fields[0].options, ["选项1", "选项2"]);
  assert.deepEqual(result.fields[0].options, ["选项1", "选项2"]);
});

test("删除普通字段只清理自身读写引用，保留图、其他权限及旧属性缺省状态", () => {
  const source = model([text("memo"), text("amount"), text("other")]);
  source.nodes[0].readable = ["memo", "amount", "other"];
  source.nodes[0].writable = ["memo", "amount"];
  const original = structuredClone(source);
  const result = removeWorkflowField(source, "amount");
  assert.deepEqual(fieldIds(result), ["memo", "other"]);
  assert.deepEqual(result.nodes[0].readable, ["memo", "other"]);
  assert.deepEqual(result.nodes[0].writable, ["memo"]);
  assert.equal(result.nodes[0].next, source.nodes[0].next);
  assert.deepEqual(result.nodes[1], source.nodes[1]);
  assert.equal(Object.hasOwn(result.nodes[1], "readable"), false);
  assert.equal(Object.hasOwn(result.fields[0], "width"), false);
  assert.deepEqual(source, original);
});

test("删除条件引用字段被阻止，并明确指出全部引用节点，不改写任何路由", () => {
  const source = model([text("amount"), text("memo")]);
  for (const [id, name] of [
    ["condition_a", "部门判断"],
    ["condition_b", "金额判断"],
  ])
    source.nodes.push({
      id,
      name,
      type: "CONDITION",
      next: "end",
      conditions: [
        { field: "amount", operator: "EQ", value: "100", next: "review" },
      ],
    });
  const original = structuredClone(source);
  assert.throws(
    () => removeWorkflowField(source, "amount"),
    /部门判断、金额判断.*先修改分支条件/,
  );
  assert.deepEqual(source, original);
  const copy = copyWorkflowField(source, "amount");
  assert.deepEqual(copy.nodes, source.nodes);
  assert.equal(copy.nodes[2].conditions?.[0].field, "amount");
});

test("40 字段容量允许最后一个添加，超限创建和复制明确拒绝，移动删除仍可修复", () => {
  const source = model(
    Array.from({ length: 39 }, (_, index) => text(`legacy${index}`)),
  );
  const full = insertWorkflowField(source, source.fields.length, "TEXT");
  assert.equal(full.fields.length, MAX_WORKFLOW_FIELDS);
  assert.deepEqual(validateWorkflowFields(full.fields), []);
  assert.throws(() => createWorkflowField("TEXT", full.fields), /最多 40/);
  assert.throws(() => insertWorkflowField(full, 0, "TEXT"), /最多 40/);
  assert.throws(() => copyWorkflowField(full, "legacy0"), /最多 40/);
  assert.equal(moveWorkflowField(full, "legacy0", null).fields.length, 40);
  assert.equal(removeWorkflowField(full, "legacy0").fields.length, 39);
  const oversized = [...full.fields, text("overflow")];
  assert.ok(
    validateWorkflowFields(oversized).some(
      (issue) => issue.fieldId === "overflow" && /最多 40/.test(issue.message),
    ),
  );
});

test("非法插入位置、缺失字段、过期拖放目标及重复旧 ID 不会改动源模型", () => {
  const source = model([text("a"), text("b")]);
  const original = structuredClone(source);
  for (const index of [-1, 3, 0.5, NaN, Infinity])
    assert.throws(
      () => insertWorkflowField(source, index, "TEXT"),
      /插入位置无效/,
    );
  for (const mutate of [copyWorkflowField, removeWorkflowField])
    assert.throws(() => mutate(source, "missing"), /字段不存在/);
  assert.throws(() => moveWorkflowField(source, "missing", "b"), /字段不存在/);
  assert.throws(() => moveWorkflowField(source, "a", "removed"), /字段不存在/);
  assert.throws(
    () => createWorkflowField("UNSUPPORTED" as FieldType, source.fields),
    /不支持/,
  );
  assert.deepEqual(source, original);
  const duplicate = model([text("same"), text("same")]);
  for (const mutate of [copyWorkflowField, removeWorkflowField])
    assert.throws(() => mutate(duplicate, "same"), /标识/);
  assert.throws(() => moveWorkflowField(duplicate, "same", null), /标识/);
});

test("旧字段缺省布局和可选属性合法，校验及重排不自动补写默认值", () => {
  const oldFields: WorkflowField[] = [
    text("business_memo", "说明"),
    { id: "business_amount", label: "金额", type: "MONEY" },
    { id: "dates", label: "日期范围", type: "DATE_RANGE" },
    {
      id: "items",
      label: "费用明细",
      type: "DETAILS",
      columns: [text("item", "项目")],
    },
  ];
  const original = structuredClone(oldFields);
  assert.deepEqual(validateWorkflowFields(oldFields), []);
  const moved = moveWorkflowField(model(oldFields), "business_memo", null);
  for (const field of moved.fields)
    assert.equal(Object.hasOwn(field, "width"), false);
  assert.deepEqual(oldFields, original);
  assert.deepEqual(validateWorkflowFields([]), []);
});

test("主字段及明细列各自去重，同名列跨明细或与主字段同 ID 均不误报", () => {
  const detailsA = createWorkflowField("DETAILS", []);
  const detailsB = createWorkflowField("DETAILS", [detailsA]);
  const fields = [text("item"), detailsA, detailsB];
  assert.deepEqual(validateWorkflowFields(fields), []);
  detailsA.columns!.push(text("item", "重复列"));
  const issues = validateWorkflowFields(fields);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fieldId, detailsA.id);
  assert.match(issues[0].message, /明细列“重复列”.*标识不能重复/);
  assert.equal(
    issues.some((issue) => issue.fieldId === detailsB.id),
    false,
  );
});

test("名称、ID、布局、提示与说明边界按 Java 发布标准逐项反馈", () => {
  const invalid: WorkflowField = {
    id: "1bad id",
    label: "   ",
    type: "TEXT",
    width: 8 as 12,
    maxLength: 0,
    placeholder: "字".repeat(201),
    helpText: "字".repeat(501),
  };
  const original = structuredClone(invalid);
  const issues = validateWorkflowFields([invalid]);
  assert.equal(issues.length, 6);
  assert.ok(issues.every((issue) => issue.fieldId === invalid.id));
  for (const fragment of [
    "字段标识",
    "字段名称",
    "布局",
    "最大长度",
    "输入提示",
    "填写说明",
  ])
    assert.ok(
      issues.some((issue) => issue.message.includes(fragment)),
      fragment,
    );
  assert.deepEqual(invalid, original);
  assert.deepEqual(
    validateWorkflowFields([
      {
        id: "A".repeat(40),
        label: "字".repeat(60),
        type: "TEXTAREA",
        width: 24,
        maxLength: 10000,
        placeholder: "字".repeat(200),
        helpText: "字".repeat(500),
      },
    ]),
    [],
  );
});

test("非法名称与 ID、重复主字段和未知控件不会绕过发布前字段检查", () => {
  for (const id of ["", "1name", "a-b", "中", "a".repeat(41)])
    assert.ok(
      validateWorkflowFields([text(id)]).some((issue) =>
        /标识/.test(issue.message),
      ),
    );
  for (const label of ["", "\n\t", "字".repeat(61)])
    assert.ok(
      validateWorkflowFields([text("valid", label)]).some((issue) =>
        /名称/.test(issue.message),
      ),
    );
  assert.ok(
    validateWorkflowFields([text("duplicate"), text("duplicate")]).some(
      (issue) => /不能重复/.test(issue.message),
    ),
  );
  assert.ok(
    validateWorkflowFields([
      { ...text("bad_type"), type: "constructor" as FieldType },
    ]).some((issue) => /类型/.test(issue.message)),
  );
});

test("单选多选检查数量、重复值和字符边界，验证过程不修剪合法原值", () => {
  for (const type of ["SINGLE", "MULTI"] as const) {
    for (const options of [
      undefined,
      [],
      Array.from({ length: 51 }, (_, index) => String(index)),
    ])
      assert.ok(
        validateWorkflowFields([
          { id: "choice", label: "类型", type, options },
        ]).some((issue) => /1 至 50/.test(issue.message)),
      );
    const badOptions = ["同值", "同值", " ", "字".repeat(101)];
    const issues = validateWorkflowFields([
      { id: "choice", label: "类型", type, options: badOptions },
    ]);
    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => /不能重复/.test(issue.message)));
    assert.ok(issues.some((issue) => /1 至 100/.test(issue.message)));
    const valid = [
      {
        id: "choice",
        label: "类型",
        type,
        options: [" 保留原值 ", "字".repeat(100)],
      },
    ];
    const original = structuredClone(valid);
    assert.deepEqual(validateWorkflowFields(valid), []);
    assert.deepEqual(valid, original);
  }
});

test("数值上下限和文本长度即时检查，合法负数、相等边界不误报", () => {
  for (const minMax of [{ min: 2, max: 1 }, { min: NaN }, { max: Infinity }])
    assert.ok(
      validateWorkflowFields([
        { id: "number", label: "数量", type: "NUMBER", ...minMax },
      ]).some((issue) => /数值/.test(issue.message)),
    );
  for (const maxLength of [0, -1, 10001, 1.5, NaN])
    assert.ok(
      validateWorkflowFields([{ ...text("memo"), maxLength }]).some((issue) =>
        /最大长度/.test(issue.message),
      ),
    );
  assert.deepEqual(
    validateWorkflowFields([
      { id: "balance", label: "余额", type: "MONEY", min: -100, max: 100 },
      { id: "fixed", label: "固定数量", type: "NUMBER", min: 0, max: 0 },
      { ...text("memo"), maxLength: 1 },
    ]),
    [],
  );
});

test("明细列数量、行数及不可嵌套类型都有主字段定位，嵌套非法模型不会无限递归", () => {
  const details = createWorkflowField("DETAILS", []);
  for (const columns of [
    undefined,
    [],
    Array.from({ length: 7 }, (_, index) => text(`col${index}`)),
  ])
    assert.ok(
      validateWorkflowFields([{ ...details, columns }]).some((issue) =>
        /1 至 6 列/.test(issue.message),
      ),
    );
  for (const maxRows of [0, -1, 51, 1.5, NaN])
    assert.ok(
      validateWorkflowFields([{ ...details, maxRows }]).some((issue) =>
        /1 至 50/.test(issue.message),
      ),
    );
  for (const type of [
    "MULTI",
    "FILES",
    "USER",
    "DEPARTMENT",
    "DATE_RANGE",
    "DETAILS",
  ] as const) {
    const child = createWorkflowField(type, []);
    if (type === "DETAILS") child.columns = [child];
    const issues = validateWorkflowFields([{ ...details, columns: [child] }]);
    assert.ok(issues.every((issue) => issue.fieldId === details.id));
    assert.ok(issues.some((issue) => /不能嵌套/.test(issue.message)));
  }
  for (const maxRows of [1, 50])
    assert.deepEqual(validateWorkflowFields([{ ...details, maxRows }]), []);
});

test("明细子列复用名称、选项和数值规则，非明细字段不能保留子列", () => {
  const details: WorkflowField = {
    id: "items",
    label: "采购明细",
    type: "DETAILS",
    columns: [
      { id: "item", label: " ", type: "TEXT", maxLength: 0 },
      { id: "amount", label: "金额", type: "MONEY", min: 10, max: 0 },
      { id: "kind", label: "类型", type: "SINGLE", options: ["重复", "重复"] },
    ],
  };
  const issues = validateWorkflowFields([details]);
  assert.equal(issues.length, 4);
  assert.ok(
    issues.every(
      (issue) =>
        issue.fieldId === details.id && issue.message.startsWith("明细列"),
    ),
  );
  assert.ok(
    validateWorkflowFields([
      { ...text("memo"), columns: [text("child")] },
    ]).some((issue) => /只有明细表/.test(issue.message)),
  );
  assert.deepEqual(
    validateWorkflowFields([{ ...text("memo"), columns: [] }]),
    [],
  );
});

test("单选 EQ/NE 条件使用原值，重命名或删除选项后指出关联字段和节点", () => {
  const source = model([
    {
      id: "kind",
      label: "申请类型",
      type: "SINGLE",
      options: [" 差旅 ", "采购"],
    },
  ]);
  source.nodes.push({
    id: "choice",
    name: "类型判断",
    type: "CONDITION",
    next: "end",
    conditions: [
      { field: "kind", operator: "EQ", value: " 差旅 ", next: "review" },
      { field: "kind", operator: "NE", value: "采购", next: "end" },
      { field: "kind", operator: "CONTAINS", value: "差旅", next: "review" },
    ],
  });
  const original = structuredClone(source);
  assert.deepEqual(validateWorkflowFormReferences(source), []);
  source.fields[0].options = ["服务", "采购"];
  const issues = validateWorkflowFormReferences(source);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fieldId, "kind");
  assert.match(issues[0].message, /类型判断.*申请类型.*重新配置/);
  assert.equal(source.nodes[2].conditions?.[0].value, " 差旅 ");
  source.fields[0].options = [" 差旅 "];
  assert.equal(validateWorkflowFormReferences(source).length, 1);
  assert.equal(source.nodes[2].conditions?.[1].value, "采购");
  source.fields[0].options = original.fields[0].options;
  source.nodes[2].conditions![0].value = "差旅";
  assert.equal(validateWorkflowFormReferences(source).length, 1);
  assert.deepEqual(original.fields[0].options, [" 差旅 ", "采购"]);
});

test("单选包含子串及普通文字比较不受选项成员限制", () => {
  const source = model([
    { id: "kind", label: "类型", type: "SINGLE", options: ["国内差旅"] },
    text("memo", "备注"),
  ]);
  source.nodes.push({
    id: "choice",
    name: "判断",
    type: "CONDITION",
    next: "end",
    conditions: [
      { field: "kind", operator: "CONTAINS", value: "差旅", next: "review" },
      { field: "memo", operator: "EQ", value: "任意备注", next: "review" },
    ],
  });
  assert.deepEqual(validateWorkflowFormReferences(source), []);
});

test("全部控件预览值通过，检查不转换日期、数字文本或关联值，也不改模型", () => {
  const fields: WorkflowField[] = [];
  const values: Record<string, unknown> = {};
  const byType: Record<FieldType, unknown> = {
    TEXT: "事项",
    TEXTAREA: "第一行\n第二行",
    NUMBER: "42.123456",
    MONEY: "001.20",
    DATE: "2026-10-03",
    DATETIME: "2026-10-03T10:30:00.123456789",
    DATE_RANGE: ["2026-10-01", "2026-10-03"],
    DETAILS: [
      { item: "交通", amount: 12.3 },
      { item: "住宿", amount: "100.00" },
    ],
    SINGLE: "选项1",
    MULTI: ["选项1", "选项2"],
    USER: "+001",
    DEPARTMENT: 2,
    FILES: [1, 2],
  };
  for (const type of Object.keys(fieldNames) as FieldType[]) {
    const field = createWorkflowField(type, fields);
    field.required = true;
    fields.push(field);
    values[field.id] = byType[type];
  }
  const originalFields = structuredClone(fields);
  const originalValues = structuredClone(values);
  assert.deepEqual(validateWorkflowFormValues(fields, values), []);
  assert.deepEqual(fields, originalFields);
  assert.deepEqual(values, originalValues);
});

test("必填、未知键、文字类型和长度均可定位，空的可选值保持 Java 空值语义", () => {
  const required = createWorkflowField("TEXT", []);
  required.required = true;
  for (const value of [undefined, null, "", " \n", []])
    assert.ok(
      validateWorkflowFormValues([required], { [required.id]: value }).some(
        (issue) => /不能为空/.test(issue.message),
      ),
    );
  for (const value of [1, true, {}, ["文本"]])
    assert.ok(
      validateWorkflowFormValues([required], { [required.id]: value }).some(
        (issue) => /必须为文本/.test(issue.message),
      ),
    );
  assert.ok(
    validateWorkflowFormValues([{ ...required, maxLength: 2 }], {
      [required.id]: "三个字",
    }).some((issue) => /最大长度/.test(issue.message)),
  );
  const issues = validateWorkflowFormValues([text("memo")], {
    undeclared: "未知",
  });
  assert.equal(issues[0].fieldId, "undeclared");
  assert.match(issues[0].message, /未登记字段/);
  for (const type of Object.keys(fieldNames) as FieldType[]) {
    const field = createWorkflowField(type, []);
    for (const value of [undefined, null, " ", []])
      assert.deepEqual(
        validateWorkflowFormValues([field], { [field.id]: value }),
        [],
      );
  }
});

test("十进制精度和金额小数与 Java BigDecimal 一致，科学计数及上限不被浮点取整", () => {
  const money = createWorkflowField("MONEY", []);
  const number = createWorkflowField("NUMBER", []);
  for (const value of [
    "1.00",
    "1e-2",
    "000000000000000001.20",
    0,
    "1000000000000000",
  ])
    assert.deepEqual(
      validateWorkflowFormValues([money], { [money.id]: value }),
      [],
    );
  for (const value of [
    "1.001",
    "0.0100",
    "1000000000000000.01",
    "1000000000000000000e-3",
    Infinity,
  ])
    assert.ok(
      validateWorkflowFormValues([money], { [money.id]: value }).length > 0,
      String(value),
    );
  for (const value of [
    "0.000001",
    "1.23456789e2",
    "0000000000000000001",
    "0e2147483647",
  ])
    assert.deepEqual(
      validateWorkflowFormValues([number], { [number.id]: value }),
      [],
      String(value),
    );
  for (const value of [
    "0.0000001",
    "1000000000000000.01",
    "1e-2147483648",
    "0e2147483648",
    " 1 ",
    false,
    {},
  ])
    assert.ok(
      validateWorkflowFormValues([number], { [number.id]: value }).length > 0,
      String(value),
    );
  const bounded = { ...number, min: -0.1, max: 0.1 };
  for (const value of ["-0.100000", "0.100000", "-0", ".1"])
    assert.deepEqual(
      validateWorkflowFormValues([bounded], { [number.id]: value }),
      [],
    );
  for (const value of ["-0.100001", "0.100001"])
    assert.ok(
      validateWorkflowFormValues([bounded], { [number.id]: value }).some(
        (issue) => /允许范围/.test(issue.message),
      ),
    );
});

test("日期和时间校验真实日历，日期区间不完整或逆序无法宣称填写通过", () => {
  const date = createWorkflowField("DATE", []);
  const time = createWorkflowField("DATETIME", []);
  const range = createWorkflowField("DATE_RANGE", []);
  for (const value of [
    "2024-02-29",
    "2000-02-29",
    "0000-02-29",
    "+10000-01-01",
  ])
    assert.deepEqual(
      validateWorkflowFormValues([date], { [date.id]: value }),
      [],
    );
  for (const value of [
    "2026-02-29",
    "1900-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-04-31",
    "2026-1-01",
    "+2026-10-03",
  ])
    assert.ok(
      validateWorkflowFormValues([date], { [date.id]: value }).length > 0,
      value,
    );
  for (const value of [
    "2026-10-03T10:30",
    "2026-10-03T23:59:59",
    "2026-10-03T10:30:00.123456789",
  ])
    assert.deepEqual(
      validateWorkflowFormValues([time], { [time.id]: value }),
      [],
    );
  for (const value of [
    "2026-02-30T10:30",
    "2026-10-03T24:00",
    "2026-10-03T10:60",
    "2026-10-03T10:30:60",
    "2026-10-03T10:30:00Z",
    "2026-10-03T10:30:00.1234567890",
  ])
    assert.ok(
      validateWorkflowFormValues([time], { [time.id]: value }).length > 0,
      value,
    );
  for (const value of [
    ["2026-10-01", ""],
    ["2026-10-01"],
    ["2026-10-03", "2026-10-01"],
    ["2026-02-30", "2026-10-03"],
  ])
    assert.ok(
      validateWorkflowFormValues([range], { [range.id]: value }).length > 0,
    );
  for (const value of [
    ["2026-10-03", "2026-10-03"],
    ["2026-10-03", "2027-01-01"],
    ["9999-12-31", "+10000-01-01"],
  ])
    assert.deepEqual(
      validateWorkflowFormValues([range], { [range.id]: value }),
      [],
    );
});

test("明细逐行校验必填列、数值选项和未知键，错误定位主字段并保留试填值", () => {
  const details: WorkflowField = {
    id: "lines",
    label: "费用明细",
    type: "DETAILS",
    required: true,
    maxRows: 2,
    columns: [
      { id: "item", label: "项目", type: "TEXT", required: true, maxLength: 4 },
      {
        id: "amount",
        label: "金额",
        type: "MONEY",
        required: true,
        min: 0,
        max: 100,
      },
      {
        id: "kind",
        label: "类型",
        type: "SINGLE",
        required: true,
        options: ["A", "B"],
      },
    ],
  };
  const values = { lines: [{ item: "交通", amount: 20, kind: "A" }, {}] };
  const original = structuredClone(values);
  const issues = validateWorkflowFormValues([details], values);
  assert.equal(issues.length, 3);
  assert.ok(
    issues.every(
      (issue) =>
        issue.fieldId === details.id && issue.message.includes("第 2 行"),
    ),
  );
  assert.deepEqual(values, original);
  for (const value of [
    "明细",
    ["字符串行"],
    [["数组行"]],
    [{ item: "五个字项目", amount: -1, kind: "不存在" }],
    [{ item: "交通", amount: 20, kind: "A", extra: true }],
    [{}, {}, {}],
  ])
    assert.ok(
      validateWorkflowFormValues([details], { lines: value }).length > 0,
    );
  assert.deepEqual(
    validateWorkflowFormValues([details], {
      lines: [{ item: "交通", amount: "100.00", kind: "A" }],
    }),
    [],
  );
});

test("单选多选按原值成员检查，列表重复和非法类型不能跳过填写校验", () => {
  const single: WorkflowField = {
    id: "kind",
    label: "类型",
    type: "SINGLE",
    options: [" A ", "B"],
  };
  const multi: WorkflowField = { ...single, type: "MULTI" };
  assert.deepEqual(validateWorkflowFormValues([single], { kind: " A " }), []);
  assert.ok(validateWorkflowFormValues([single], { kind: "A" }).length > 0);
  assert.deepEqual(
    validateWorkflowFormValues([multi], { kind: [" A ", "B"] }),
    [],
  );
  for (const value of ["B", ["B", "B"], ["A"], [1], Array(51).fill("B")])
    assert.ok(validateWorkflowFormValues([multi], { kind: value }).length > 0);
});

test("人员、部门及附件只做值格式与必填校验，不把通过当作服务器归属授权", () => {
  for (const type of ["USER", "DEPARTMENT"] as const) {
    const field = createWorkflowField(type, []);
    for (const value of [1, "+001", "9223372036854775807"])
      assert.deepEqual(
        validateWorkflowFormValues([field], { [field.id]: value }),
        [],
      );
    for (const value of [0, -1, 1.5, "1e3", "9223372036854775808", { id: 1 }])
      assert.ok(
        validateWorkflowFormValues([field], { [field.id]: value }).length > 0,
      );
  }
  const files = { ...createWorkflowField("FILES", []), required: true };
  assert.ok(
    validateWorkflowFormValues([files], { [files.id]: [] }).some((issue) =>
      /不能为空/.test(issue.message),
    ),
  );
  assert.deepEqual(
    validateWorkflowFormValues([files], { [files.id]: [1, 2] }),
    [],
  );
  for (const value of [
    [1, 1],
    Array.from({ length: 9 }, (_, index) => index + 1),
    [0],
    [{ response: { id: 1 } }],
    "文件",
  ])
    assert.ok(
      validateWorkflowFormValues([files], { [files.id]: value }).length > 0,
    );
});

test("与对象原型同名的主字段及明细列只读取自有值，缺省值遵循 Java Map 语义", () => {
  const optional: WorkflowField = {
    id: "toString",
    label: "备注",
    type: "TEXT",
  };
  const required = { ...optional, required: true };
  assert.deepEqual(validateWorkflowFormValues([optional], {}), []);
  assert.ok(
    validateWorkflowFormValues([required], {}).some((issue) =>
      /不能为空/.test(issue.message),
    ),
  );
  assert.deepEqual(
    validateWorkflowFormValues([required], { toString: "实际填写" }),
    [],
  );

  const details: WorkflowField = {
    id: "lines",
    label: "申请明细",
    type: "DETAILS",
    columns: [
      { id: "constructor", label: "项目", type: "TEXT", required: true },
    ],
  };
  assert.ok(
    validateWorkflowFormValues([details], { lines: [{}] }).some((issue) =>
      /第 1 行.*不能为空/.test(issue.message),
    ),
  );
  assert.deepEqual(
    validateWorkflowFormValues([details], {
      lines: [{ constructor: "实际填写" }],
    }),
    [],
  );
});
