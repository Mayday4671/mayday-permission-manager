/**
 * 真实审批重启证明。prepare 通过正常权限接口建立专属并行和父子待办；调用方重启相同 Jar/DB
 * 后执行 verify，沿原任务编号、游标和不可变版本继续办理。marker 仅放 .local，不保存管理员
 * 口令或任何会话；只登记随机测试账号口令供重启后重新登录。失败同样精确清理自己的子树。
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { isolatedSql } from "../tests/support/isolated-compose.mjs";
import { loginWithCaptcha } from "../tests/support/captcha.mjs";

const mode = process.argv[2],
  base = process.env.API_BASE,
  project = process.env.API_TEST_COMPOSE_PROJECT,
  database = process.env.API_TEST_DATABASE;
assert(
  ["--prepare", "--verify", "--cleanup"].includes(mode),
  "只允许 prepare、verify 或 cleanup 模式",
);
assert(
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
    ["fresh-db", "upgrade-db"].includes(database),
  "只允许白名单隔离项目",
);
assert(base && process.env.ADMIN_PASSWORD, "需要实际 API 与管理员验收环境");
const localRoot = resolve(".local"),
  markerPath = resolve(
    process.env.WORKFLOW_RESTART_MARKER ?? ".local/workflow-restart.json",
  );
assert(
  relative(localRoot, markerPath) &&
    !relative(localRoot, markerPath).startsWith(".."),
  "marker 必须位于当前项目 .local 内",
);
if (mode === "--prepare" && existsSync(markerPath))
  assert(
    JSON.parse(readFileSync(markerPath, "utf8")).cleanedAt,
    "尚未清理的 marker 不能覆盖，请先执行 cleanup",
  );
const owned =
  mode === "--prepare"
    ? {
        prefix:
          "qa_restart_" +
          Date.now().toString(36) +
          randomBytes(3).toString("hex"),
        project,
        database,
        base,
        password: "QaRestart_" + randomBytes(18).toString("hex"),
        users: [],
        roles: [],
        definitions: [],
        roots: [],
        snapshots: [],
        status: "preparing",
      }
    : JSON.parse(readFileSync(markerPath, "utf8"));
assert(
  owned.project === project &&
    owned.database === database &&
    owned.base === base &&
    /^qa_restart_[a-z0-9]+$/.test(owned.prefix),
  "marker 不能跨服务、数据库或测试批次使用",
);
const ids = (items) => {
  assert(items.every(Number.isSafeInteger));
  return items.length ? items.join(",") : "-1";
};

/** 使用 compose 内已配置的只读凭据来源，SQL 只由精确登记的安全数字编号组成。 */
function sql(statement) {
  return isolatedSql(statement, { raw: true, maxBuffer: 3e6 });
}

/** 成功响应也不打印：接口会返回人员或令牌，日志只记录方法与 HTTP 状态。 */
async function call(path, token, method = "GET", data, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: expected ${status}, received ${response.status}`,
  );
  return result.data;
}
function save() {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(owned, null, 2));
}

/** 先锁本批事件并去掉精确通知引用，子申请编号总在父之后，逐条降序避免自引用外键。 */
async function cleanup(admin) {
  const applicantId = owned.users[0]?.id;
  const userIds = ids(owned.users.map((user) => user.id)),
    roleIds = ids(owned.roles),
    definitionIds = ids(owned.definitions);
  // marker 来自文件仍需与服务器本批命名核对，不能把手改编号当成删除其他隔离数据的授权。
  const matching = sql(
    `SELECT (SELECT COUNT(*) FROM sys_user WHERE id IN (${userIds}) AND LEFT(username,${owned.prefix.length})='${owned.prefix}'),(SELECT COUNT(*) FROM sys_role WHERE id IN (${roleIds}) AND LEFT(code,${owned.prefix.length})='${owned.prefix}'),(SELECT COUNT(*) FROM ops_flow_definition WHERE id IN (${definitionIds}) AND LEFT(code,${owned.prefix.length})='${owned.prefix}');`,
  )
    .trim()
    .split(/\s+/)
    .map(Number);
  assert.deepEqual(
    matching,
    [owned.users.length, owned.roles.length, owned.definitions.length],
    "marker 编号与本批服务器命名不一致，不允许清理",
  );
  const requests = applicantId
    ? sql(
        `SELECT id FROM ops_flow_request WHERE definition_id IN (${ids(owned.definitions)}) AND applicant_id=${ids([applicantId])} ORDER BY id DESC;`,
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
    : [];
  const selected = ids(requests),
    definitions = ids(owned.definitions);
  sql(`START TRANSACTION; SELECT id FROM ops_event WHERE request_id IN (${selected}) FOR UPDATE;
    DELETE d FROM ops_delivery d JOIN ops_notification n ON n.id=d.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${selected});
    DELETE t FROM ops_notification_target t JOIN ops_notification n ON n.id=t.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${selected});
    DELETE FROM ops_notification WHERE target_type='APPROVAL' AND target_id IN (${selected});
    DELETE FROM ops_event WHERE request_id IN (${selected}); DELETE FROM ops_flow_task WHERE request_id IN (${selected}); DELETE FROM ops_flow_decision WHERE request_id IN (${selected});
    DELETE FROM ops_request_step WHERE request_id IN (${selected}); DELETE FROM ops_request_file WHERE request_id IN (${selected});
    ${requests.map((id) => `DELETE FROM ops_flow_request WHERE id=${id};`).join("\n")}
    DELETE FROM ops_flow_step WHERE definition_id IN (${definitions}); DELETE FROM ops_flow_version WHERE definition_id IN (${definitions}); DELETE FROM ops_flow_definition WHERE id IN (${definitions}); COMMIT;`);
  for (const account of owned.users)
    await call(`/system/users/${account.id}`, admin, "DELETE");
  for (const role of owned.roles)
    await call(`/system/roles/${role}`, admin, "DELETE");
  if (owned.departmentId)
    await call(
      `/system/entries/departments/${owned.departmentId}`,
      admin,
      "DELETE",
    );
  owned.cleanedAt = new Date().toISOString();
  save();
}

const memo = {
  id: "memo",
  label: "说明",
  type: "TEXT",
  required: true,
  width: 24,
  maxLength: 100,
};
const end = { id: "end", name: "结束", type: "END" };
const approval = (id, user, next) => ({
  id,
  name: id,
  type: "APPROVAL",
  source: "USERS",
  assigneeIds: [user.id],
  mode: "ALL",
  next,
  readable: ["memo"],
  writable: [],
  actions: ["APPROVE", "REJECT", "RETURN", "COMMENT"],
});
const schema = (nodes) => ({
  fields: [memo],
  nodes: [...nodes, end],
  startNodeId: nodes[0].id,
  applicantType: "ALL",
  applicantIds: [],
  allowSelfApproval: false,
  allowRepeatApproval: false,
  allowWithdraw: true,
});
let admin;
try {
  admin = (await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD))
    .token;
  if (mode === "--prepare") {
    assert(!owned.cleanedAt);
    save();
    const department = await call(
      "/system/entries/departments",
      admin,
      "POST",
      { name: owned.prefix, code: owned.prefix, enabled: true, sortOrder: 0 },
    );
    owned.departmentId = department.id;
    save();
    for (const suffix of ["app", "left", "right", "after", "gone"]) {
      const approver = suffix !== "app";
      const role = await call("/system/roles", admin, "POST", {
        name: owned.prefix + suffix,
        code: owned.prefix + suffix,
        enabled: true,
        permissions: approver
          ? ["requests:view", "requests:approve", "messages:view"]
          : ["requests:view", "requests:create", "messages:view"],
        dataScopes: {},
      });
      owned.roles.push(role.id);
      save();
      const user = await call("/system/users", admin, "POST", {
        username: owned.prefix + suffix,
        nickname: suffix,
        password: owned.password,
        enabled: true,
        departmentId: department.id,
        roleIds: [role.id],
      });
      owned.users.push({ id: user.id, username: user.username });
      save();
    }
    const [applicant, left, right, after] = owned.users,
      appToken = (
        await loginWithCaptcha(base, applicant.username, owned.password)
      ).token,
      leftToken = (await loginWithCaptcha(base, left.username, owned.password))
        .token;
    const category = (await call("/system/entries/approvalcategories", admin))
      .items[0];
    assert(category);
    const publish = async (model) => {
      const record = await call("/operations/workflows", admin, "POST", {
        name: owned.prefix + " " + owned.definitions.length,
        code: owned.prefix + "_" + owned.definitions.length,
        categoryId: category.id,
        businessType: "GENERAL",
        enabled: true,
        schema: model,
      });
      owned.definitions.push(record.id);
      save();
      return call(`/operations/workflows/${record.id}/publish`, admin, "POST", {
        version: record.version,
      });
    };
    const submit = async (definition) => {
      const instance = await call("/operations/requests", appToken, "POST", {
        definitionId: definition.id,
        versionId: definition.publishedVersionId,
        title: owned.prefix + " " + owned.roots.length,
        values: { memo: "持久重启验证" },
      });
      owned.roots.push(instance.id);
      save();
      return instance;
    };
    const parallel = await publish(
      schema([
        {
          id: "fork",
          name: "并行",
          type: "PARALLEL",
          next: "join",
          branches: ["left", "right"],
        },
        approval("left", left, "join"),
        approval("right", right, "join"),
        { id: "join", name: "汇合", type: "JOIN", next: "after" },
        approval("after", after, "end"),
      ]),
    );
    const first = await submit(parallel),
      leftDetail = await call(`/operations/requests/${first.id}`, leftToken);
    await call(`/operations/requests/${first.id}/decision`, leftToken, "POST", {
      version: leftDetail.version,
      taskId: leftDetail.myTaskId,
      action: "APPROVE",
    });
    // 精确十进制与游标一起跨冷启动保留；前台网络值为字符串，执行和固定子版本映射仍是 BigDecimal。
    const exactAmount = "999999999999999.99";
    const exactFields = [
      memo,
      { id: "amount", label: "精确金额", type: "MONEY", required: true },
      {
        id: "amountCopy",
        label: "金额副本",
        type: "CALCULATED",
        required: true,
        formula: { operation: "SUM", operands: ["amount"], scale: 2 },
      },
    ];
    const childSchema = schema([approval("childReview", left, "end")]);
    childSchema.fields = exactFields;
    childSchema.nodes[0].readable = exactFields.map((field) => field.id);
    const child = await publish(childSchema);
    const parentSchema = schema([
      {
        id: "child",
        name: "固定子流程",
        type: "SUBPROCESS",
        next: "end",
        // 子调用的输入必须可读，返回 amount 必须同时可读、可写；派生字段仍由服务器重算。
        readable: ["memo", "amount"],
        writable: ["amount"],
        actions: [],
        subprocess: {
          versionId: child.publishedVersionId,
          inputs: { memo: "memo", amount: "amount" },
          outputs: { amount: "amount" },
        },
      },
    ]);
    parentSchema.fields = exactFields;
    const exactParent = await publish(parentSchema);
    const second = await call("/operations/requests", appToken, "POST", {
      definitionId: exactParent.id,
      versionId: exactParent.publishedVersionId,
      title: owned.prefix + " 精确冷启动",
      values: { memo: "持久重启验证", amount: exactAmount },
    });
    owned.roots.push(second.id);
    owned.exactAmount = exactAmount;
    save();
    assert.equal(second.values.amount, exactAmount);
    assert.equal(second.values.amountCopy, exactAmount);
    assert.equal(second.childRequests.length, 1);
    const childId = second.childRequests[0].id;
    // 第三个根申请停在尚未生成子申请的失败调用：离职原人保持停用，人员覆盖先保存再重启。
    const departed = owned.users[4];
    const repairChild = await publish(
      schema([approval("review", departed, "end")]),
    );
    const repairParent = await publish(
      schema([
        {
          id: "child",
          name: "待启动修复调用",
          type: "SUBPROCESS",
          next: "end",
          readable: ["memo"],
          writable: [],
          actions: [],
          subprocess: {
            versionId: repairChild.publishedVersionId,
            inputs: { memo: "memo" },
            outputs: {},
          },
        },
      ]),
    );
    const departedAccount = (
      await call(`/system/users?keyword=${departed.username}`, admin)
    ).items.find((account) => account.id === departed.id);
    await call("/system/users/status", admin, "PUT", {
      rows: [{ id: departed.id, version: departedAccount.version }],
      enabled: false,
    });
    const third = await submit(repairParent);
    let failed = await call(`/operations/requests/${third.id}`, admin);
    assert.equal(failed.childRequests.length, 0);
    const repair = (
      await call(
        `/operations/requests/${third.id}/subprocess-repair-options`,
        admin,
      )
    )[0];
    failed = await call(
      `/operations/requests/${third.id}/subprocess-repair`,
      admin,
      "POST",
      {
        version: failed.version,
        tokenId: repair.tokenId,
        childNodeId: "review",
        targetUserIds: [left.id],
        reason: "离职账号不重新启用，固定子调用人员覆盖跨重启持久化",
      },
    );
    assert.equal(failed.childRequests.length, 0);
    owned.repairedRootId = third.id;
    owned.repairedVersionId = repairChild.publishedVersionId;
    for (const id of [first.id, second.id, childId, third.id]) {
      const current = await call(`/operations/requests/${id}`, admin);
      owned.snapshots.push({
        id,
        version: current.version,
        definitionVersionId: current.definitionVersionId,
        tasks: current.tasks.map((task) => ({
          id: task.id,
          nodeId: task.nodeId,
          nodeVisit: task.nodeVisit,
          executionTokenId: task.executionTokenId,
          status: task.status,
        })),
        execution: current.execution.map((token) => ({
          tokenId: token.tokenId,
          nodeId: token.nodeId,
          status: token.status,
          childRequestId: token.childRequestId ?? null,
        })),
        decimalValues:
          id === second.id || id === childId ? current.values : null,
      });
    }
    owned.childId = childId;
    owned.status = "prepared";
    owned.preparedAt = new Date().toISOString();
    save();
    console.log(
      "通过：重启前并行支路、固定父子待办及待启动子调用人员修复均已持久化",
    );
  } else if (mode === "--cleanup") {
    if (!owned.cleanedAt) await cleanup(admin);
    console.log("通过：重启验收专属数据已清理");
  } else {
    assert.equal(owned.status, "prepared");
    try {
      for (const snapshot of owned.snapshots) {
        const current = await call(
          `/operations/requests/${snapshot.id}`,
          admin,
        );
        assert.equal(current.version, snapshot.version);
        assert.equal(current.definitionVersionId, snapshot.definitionVersionId);
        if (snapshot.decimalValues) {
          assert.deepEqual(
            current.values,
            snapshot.decimalValues,
            "金额和派生值不能在重启后舍入",
          );
          assert.equal(current.values.amount, owned.exactAmount);
          assert.equal(current.values.amountCopy, owned.exactAmount);
          assert.equal(
            current.history.find((item) => item.action === "SUBMIT")
              .submittedValues.amount,
            owned.exactAmount,
          );
        }
        assert.deepEqual(
          current.tasks.map((task) => ({
            id: task.id,
            nodeId: task.nodeId,
            nodeVisit: task.nodeVisit,
            executionTokenId: task.executionTokenId,
            status: task.status,
          })),
          snapshot.tasks,
          "重启不能创建新任务或改写已通过支路",
        );
        assert.deepEqual(
          current.execution.map((token) => ({
            tokenId: token.tokenId,
            nodeId: token.nodeId,
            status: token.status,
            childRequestId: token.childRequestId ?? null,
          })),
          snapshot.execution,
          "重启必须恢复原游标和子申请关联",
        );
      }
      const [applicant, left, right, after] = owned.users;
      const tokens = new Map();
      for (const person of [left, right, after])
        tokens.set(
          person.id,
          (await loginWithCaptcha(base, person.username, owned.password)).token,
        );
      const decide = async (id, person) => {
        const token = tokens.get(person.id),
          current = await call(`/operations/requests/${id}`, token);
        return call(`/operations/requests/${id}/decision`, token, "POST", {
          version: current.version,
          taskId: current.myTaskId,
          action: "APPROVE",
        });
      };
      const next = await decide(owned.roots[0], right);
      assert.equal(
        next.tasks.filter((task) => task.nodeId === "after").length,
        1,
      );
      await decide(owned.roots[0], after);
      assert.equal(
        (await call(`/operations/requests/${owned.roots[0]}`, admin)).status,
        "APPROVED",
      );
      await decide(owned.childId, left);
      const finished = await call(
        `/operations/requests/${owned.roots[1]}`,
        admin,
      );
      assert.equal(finished.status, "APPROVED");
      assert.equal(finished.childRequests.length, 1);
      if (owned.exactAmount) {
        assert.equal(finished.values.amount, owned.exactAmount);
        assert.equal(
          finished.values.amountCopy,
          owned.exactAmount,
          "固定子流程完成回写后派生重算仍精确",
        );
      }
      if (owned.repairedRootId) {
        const current = await call(
          `/operations/requests/${owned.repairedRootId}`,
          admin,
        );
        const recovered = await call(
          `/operations/requests/${owned.repairedRootId}/recover`,
          admin,
          "POST",
          {
            version: current.version,
            reason: "重启后继续使用已持久化的人员修复和固定版本",
          },
        );
        assert.equal(recovered.childRequests.length, 1);
        const repairedChild = await call(
          `/operations/requests/${recovered.childRequests[0].id}`,
          admin,
        );
        assert.equal(
          repairedChild.definitionVersionId,
          owned.repairedVersionId,
        );
        assert.equal(
          repairedChild.tasks.find((task) => task.status === "PENDING")
            .assigneeId,
          left.id,
        );
        await call(
          `/operations/requests/${owned.repairedRootId}/recover`,
          admin,
          "POST",
          {
            version: recovered.version,
            reason: "重复恢复不得生成另一子申请",
          },
          400,
        );
        await decide(repairedChild.id, left);
        assert.equal(
          (await call(`/operations/requests/${owned.repairedRootId}`, admin))
            .status,
          "APPROVED",
        );
        const departed = owned.users[4];
        assert.equal(
          (
            await call(`/system/users?keyword=${departed.username}`, admin)
          ).items.find((account) => account.id === departed.id).enabled,
          false,
        );
      }
      owned.status = "verified";
      owned.verifiedAt = new Date().toISOString();
      save();
      console.log(
        "通过：相同待办/游标/版本及子调用人员覆盖跨重启继续办理，汇合及父唤醒各执行一次",
      );
    } finally {
      await cleanup(admin);
    }
  }
} catch (error) {
  if (mode === "--prepare" && admin) await cleanup(admin);
  throw error;
} finally {
  if (admin) await call("/auth/logout", admin, "POST");
}
