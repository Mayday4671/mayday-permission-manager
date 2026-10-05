/** 单例恢复的纯模拟回归：不启动 Docker、数据库、服务或 API，不执行实际 SQL。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  captureSingletonFixture,
  assertSingletonFixtureVersion,
  restoreSingletonFixture,
} from "./support/restore-singleton-fixture.mjs";

const environment = Object.freeze({
  API_TEST_COMPOSE_PROJECT: "mayday-check-20261005110000-a1b2c3",
  API_TEST_DATABASE: "fresh-db",
  DB_URL:
    "jdbc:mysql://127.0.0.1:49152/mayday_verify?serverTimezone=Asia/Shanghai",
});
const encoded = (value) =>
  value === null
    ? null
    : Buffer.from(String(value)).toString("hex").toUpperCase();
const outputValue = (value) => value ?? "NULL";
const privateMarker = "PRIVATE_SQL_VALUE_PASSWORD";

function mockDatabase(table = "udp_relay_config") {
  const business =
    table === "udp_relay_config"
      ? {
          bind_ip: "0.0.0.0",
          bind_port: 19000,
          target_ip: "127.0.0.1",
          target_port: 19001,
          receive_buffer_mib: 16,
          send_buffer_mib: 16,
          pending_memory_mib: 64,
        }
      : {
          enabled: 0,
          heap_threshold_percent: 85,
          database_threshold_ms: 500,
          last_alert_at: null,
        };
  const row = Object.fromEntries(
    Object.entries({
      id: 1,
      created_at: "2026-10-05 01:02:03.123456",
      updated_at: "2026-10-05 01:02:03.123456",
      version: 0,
      ...business,
    }).map(([name, value]) => [name, encoded(value)]),
  );
  const columns = Object.keys(row).map((name) => ({
    name,
    type: name.endsWith("_at") ? "datetime(6)" : "varchar(100)",
    nullable: name === "last_alert_at" ? "YES" : "NO",
    extra: name === "id" ? "auto_increment" : "",
    generation: "",
    charset: null,
    collation: null,
    defaultValue: null,
  }));
  const state = {
    table,
    row,
    columns,
    database: "mayday_verify",
    engine: "InnoDB",
    statements: [],
    beforeWrite: null,
    trigger: null,
    transactionResult: null,
    rowResult: null,
    lastSchema: null,
    writes: 0,
  };
  const schemaText = () =>
    state.columns
      .map((column, index) =>
        [
          column.name,
          column.type,
          column.nullable,
          column.extra,
          column.generation,
          column.charset,
          column.collation,
          column.defaultValue,
        ]
          .map((value) => outputValue(encoded(value)))
          .concat(String(index + 1))
          .join("\t"),
      )
      .join("\n") + "\n";
  const rowText = (selected = state.row) =>
    state.columns
      .map((column) => outputValue(selected[column.name]))
      .join("\t");
  const query = (statement, options) => {
    state.statements.push(statement);
    assert.equal(options.raw, true);
    assert(options.environment);
    if (statement === "SELECT DATABASE();") return state.database + "\n";
    if (statement.startsWith("SELECT ENGINE ")) return state.engine + "\n";
    if (
      statement.startsWith("SELECT ") &&
      statement.includes("information_schema.COLUMNS")
    ) {
      state.lastSchema = schemaText();
      return state.lastSchema;
    }
    if (statement.startsWith("SELECT "))
      return state.rowResult ?? rowText() + "\n";
    state.writes++;
    state.beforeWrite?.(state);
    // 模拟数据库用严格字节条件领取当前行；读后竞态或 CHECK 失败均不提交候选元数据。
    const predicates = [
      ...statement.matchAll(
        /IF\(`([a-z][a-z0-9_]*)` IS NULL,NULL,HEX\(CAST\(`\1` AS BINARY\)\)\) <=> (NULL|'([0-9A-F]*)')/g,
      ),
    ].map((match) => ({
      name: match[1],
      value: match[2] === "NULL" ? null : match[3],
    }));
    const size = state.columns.length;
    const actualCount = [
      ...statement.matchAll(/@mayday_singleton_fixture_changed=([01]),1,0/g),
    ];
    assert.equal(actualCount.length, 1);
    const expectedCount = Number(actualCount[0][1]);
    if (
      state.database !== "mayday_verify" ||
      state.engine !== "InnoDB" ||
      state.lastSchema !== schemaText() ||
      predicates.length !== size * 2 ||
      !predicates
        .slice(0, size)
        .every((condition) => state.row[condition.name] === condition.value)
    )
      throw new Error(privateMarker + " CHECK row or schema race");
    const candidate = { ...state.row };
    const update = statement.match(/UPDATE `[^`]+` SET (.+) WHERE /)[1];
    for (const assignment of update.split(",")) {
      const value = assignment.match(
        /^`(version|updated_at)`=(?:NULL|CONVERT\(X'([0-9A-F]*)' USING utf8mb4\))$/,
      );
      assert(value, "只允许两项元数据赋值");
      candidate[value[1]] = value[2] ?? null;
    }
    const count =
      candidate.version === state.row.version &&
      candidate.updated_at === state.row.updated_at
        ? 0
        : 1;
    state.trigger?.(candidate);
    if (
      count !== expectedCount ||
      !predicates
        .slice(size)
        .every((condition) => candidate[condition.name] === condition.value)
    )
      throw new Error(privateMarker + " CHECK count or restored row");
    Object.assign(state.row, candidate);
    return state.transactionResult ?? count + "\n" + rowText() + "\n";
  };
  return {
    state,
    query,
    capture: () => captureSingletonFixture(table, { query, environment }),
    restore: (snapshot, version) =>
      restoreSingletonFixture(snapshot, { version, query, environment }),
    advance: (version = 2) => {
      state.row.version = encoded(version);
      state.row.updated_at = encoded("2026-10-05 02:03:04.654321");
    },
  };
}

function sanitizedFailure(operation, expected) {
  assert.throws(operation, (error) => {
    assert.match(error.message, expected);
    assert(!error.message.includes(privateMarker));
    assert(!error.message.includes("UPDATE"));
    assert(!error.message.includes("jdbc:mysql"));
    return true;
  });
}

test("完整快照深度冻结，初始 API 版本须与 SQL 一致", () => {
  const database = mockDatabase();
  const snapshot = database.capture();
  assert.equal(snapshot.version, "0");
  assert.equal(snapshot.columns.length, database.state.columns.length);
  assert(Object.isFrozen(snapshot));
  assert(Object.isFrozen(snapshot.values));
  assert(Object.isFrozen(snapshot.columns));
  assert(
    snapshot.columns.every(
      (column) => Object.isFrozen(column) && Object.isFrozen(column.fields),
    ),
  );
  assert.throws(() => {
    snapshot.values[0] = "32";
  }, TypeError);
  for (const version of [0, "0", 0n])
    assertSingletonFixtureVersion(snapshot, version);
  sanitizedFailure(
    () => assertSingletonFixtureVersion(snapshot, 1),
    /初始版本/,
  );
  assert.equal(database.state.writes, 0);
});

test("两种单例只恢复推进的 version/updated_at，微秒及 NULL 完整复原", () => {
  for (const table of ["udp_relay_config", "ops_monitor_policy"]) {
    const database = mockDatabase(table);
    const before = { ...database.state.row };
    const snapshot = database.capture();
    database.advance();
    assert.deepEqual(database.restore(snapshot, 2), {
      table,
      id: 1,
      changed: true,
    });
    assert.deepEqual(database.state.row, before);
    const statement = database.state.statements.at(-1);
    assert(
      statement.indexOf("CREATE TEMPORARY TABLE") <
        statement.indexOf("START TRANSACTION"),
    );
    assert.match(
      statement,
      /UPDATE[^\n]+;\nSET @mayday_singleton_fixture_changed=ROW_COUNT\(\);/,
    );
    assert.match(statement, /CONVERT\(X'[0-9A-F]+' USING utf8mb4\)/);
    assert(statement.endsWith("COMMIT;"));
    assert.equal((statement.match(/HEX\(DATABASE\(\)\)/g) ?? []).length, 2);
  }
});

test("完整无变化是合法 no-op，严格要求零个修改行", () => {
  const database = mockDatabase("ops_monitor_policy");
  const snapshot = database.capture();
  assert.equal(database.restore(snapshot, 0).changed, false);
  assert.match(database.state.statements.at(-1), /fixture_changed=0,1,0/);
});

test("容器无 DB_URL 路径完整采集并恢复固定隔离库", () => {
  const database = mockDatabase("ops_monitor_policy");
  const containerEnvironment = {
    API_TEST_COMPOSE_PROJECT: environment.API_TEST_COMPOSE_PROJECT,
    API_TEST_DATABASE: environment.API_TEST_DATABASE,
  };
  const snapshot = captureSingletonFixture("ops_monitor_policy", {
    query: database.query,
    environment: containerEnvironment,
  });
  const before = { ...database.state.row };
  database.advance();
  assert.equal(
    restoreSingletonFixture(snapshot, {
      version: 2,
      query: database.query,
      environment: containerEnvironment,
    }).changed,
    true,
  );
  assert.deepEqual(database.state.row, before);
});

test("非 InnoDB 表在采集及恢复时拒绝，读写间换引擎也不能提交", () => {
  for (const engine of ["MyISAM", "MEMORY", "", "InnoDB\nInnoDB"]) {
    const database = mockDatabase();
    database.state.engine = engine;
    sanitizedFailure(() => database.capture(), /必须使用 InnoDB/);
    assert.equal(database.state.writes, 0);
  }
  for (const duringWrite of [false, true]) {
    const database = mockDatabase();
    const snapshot = database.capture();
    database.advance();
    if (duringWrite)
      database.state.beforeWrite = (state) => {
        state.engine = "MyISAM";
      };
    else database.state.engine = "MyISAM";
    sanitizedFailure(
      () => database.restore(snapshot, 2),
      duringWrite ? /隔离 SQL 执行失败/ : /必须使用 InnoDB/,
    );
    assert.equal(database.state.row.version, encoded(2));
    if (duringWrite) {
      const statement = database.state.statements.at(-1);
      assert(
        statement.indexOf("INTO @mayday_singleton_fixture_id") <
          statement.indexOf("FROM information_schema.TABLES"),
      );
      assert.match(statement, /WHERE `id`=1 FOR UPDATE;/);
      assert(
        statement.indexOf("FROM information_schema.TABLES") <
          statement.indexOf("UPDATE `"),
      );
      assert.equal(
        (statement.match(/SUM\(IF\(ENGINE='InnoDB'/g) ?? []).length,
        2,
      );
    }
  }
});

test("NULL 与空串有不同编码，原为 NULL 的修改时间也可精确恢复", () => {
  const database = mockDatabase("ops_monitor_policy");
  database.state.row.updated_at = null;
  database.state.row.last_alert_at = encoded("");
  const snapshot = database.capture();
  assert.equal(
    snapshot.values[
      snapshot.columns.findIndex((column) => column.name === "updated_at")
    ],
    null,
  );
  assert.equal(
    snapshot.values[
      snapshot.columns.findIndex((column) => column.name === "last_alert_at")
    ],
    "",
  );
  database.advance();
  database.restore(snapshot, 2);
  assert.equal(database.state.row.updated_at, null);
  assert.equal(database.state.row.last_alert_at, "");
});

test("大小写、尾空格、created_at 及 last_alert_at 变化均不能被元数据恢复吸收", () => {
  for (const [table, name, value] of [
    ["udp_relay_config", "bind_ip", "LOCALHOST"],
    ["udp_relay_config", "target_ip", "127.0.0.1 "],
    ["udp_relay_config", "created_at", "2026-10-05 01:02:03.123457"],
    ["ops_monitor_policy", "last_alert_at", ""],
    ["ops_monitor_policy", "last_alert_at", "2026-10-05 02:00:00.000001"],
  ]) {
    const database = mockDatabase(table);
    const snapshot = database.capture();
    database.advance();
    database.state.row[name] = encoded(value);
    sanitizedFailure(() => database.restore(snapshot, 2), /业务列已变化/);
    assert.equal(database.state.writes, 0);
    assert.equal(database.state.row[name], encoded(value));
  }
});

test("新增未知业务列也进入完整快照与拒绝变化范围", () => {
  const database = mockDatabase("ops_monitor_policy");
  database.state.columns.push({
    ...database.state.columns.at(-1),
    name: "new_policy_text",
    extra: "",
  });
  database.state.row.new_policy_text = encoded(privateMarker);
  const snapshot = database.capture();
  database.advance();
  database.state.row.new_policy_text = encoded(privateMarker + " ");
  sanitizedFailure(
    () => database.restore(snapshot, 2),
    /业务列已变化：new_policy_text/,
  );
  assert.equal(database.state.writes, 0);
});

test("API 所持最后版本与 SQL 不符或版本倒退时不执行 UPDATE", () => {
  const database = mockDatabase();
  database.state.row.version = encoded(4);
  const snapshot = database.capture();
  database.advance(6);
  sanitizedFailure(() => database.restore(snapshot, 5), /本测试 API 版本/);
  database.advance(3);
  sanitizedFailure(() => database.restore(snapshot, 3), /版本不能倒退/);
  assert.equal(database.state.writes, 0);
});

test("版本没有推进却更新 modified 时间不能假装为本测试 API 变化", () => {
  const database = mockDatabase();
  const snapshot = database.capture();
  database.state.row.updated_at = encoded("2026-10-05 03:00:00.123456");
  sanitizedFailure(() => database.restore(snapshot, 0), /未推进版本/);
  assert.equal(database.state.writes, 0);
});

test("NaN、非安全数字、非规范字符串及注入版本全部拒绝", () => {
  const database = mockDatabase();
  const snapshot = database.capture();
  for (const value of [
    NaN,
    Infinity,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "00",
    "01",
    "-1",
    "1.0",
    "1e3",
    "1; UPDATE",
    null,
    undefined,
    {},
  ]) {
    sanitizedFailure(
      () => assertSingletonFixtureVersion(snapshot, value),
      /版本格式/,
    );
    sanitizedFailure(() => database.restore(snapshot, value), /版本格式/);
  }
  assert.equal(database.state.writes, 0);
});

test("读后版本或业务字节竞态使事务守卫失败，外界值保留", () => {
  for (const [name, value] of [
    ["version", 3],
    ["target_ip", "127.0.0.1 "],
    ["bind_ip", "LOCALHOST"],
  ]) {
    const database = mockDatabase();
    const snapshot = database.capture();
    database.advance();
    const previous = database.state.row.updated_at;
    database.state.beforeWrite = (state) => {
      state.row[name] = encoded(value);
    };
    sanitizedFailure(() => database.restore(snapshot, 2), /隔离 SQL 执行失败/);
    assert.equal(database.state.row[name], encoded(value));
    assert.equal(database.state.row.updated_at, previous);
    assert.match(
      database.state.statements.at(-1),
      /HEX\(CAST\(`target_ip` AS BINARY\)\)/,
    );
  }
});

test("触发器改变业务字段时提交前完整行守卫失败并回滚元数据", () => {
  const database = mockDatabase();
  const snapshot = database.capture();
  database.advance();
  const current = { ...database.state.row };
  database.state.trigger = (candidate) => {
    candidate.target_ip = encoded(privateMarker);
  };
  sanitizedFailure(() => database.restore(snapshot, 2), /隔离 SQL 执行失败/);
  assert.deepEqual(database.state.row, current);
});

test("恢复前与读写间的结构、类型、默认值和排序规则变化全部拒绝", () => {
  for (const duringWrite of [false, true]) {
    for (const field of ["type", "defaultValue", "collation", "nullable"]) {
      const database = mockDatabase();
      const snapshot = database.capture();
      database.advance();
      const modify = (state) => {
        state.columns[1][field] = privateMarker;
      };
      if (duringWrite) database.state.beforeWrite = modify;
      else modify(database.state);
      sanitizedFailure(
        () => database.restore(snapshot, 2),
        duringWrite ? /隔离 SQL 执行失败/ : /表结构已变化/,
      );
      assert.equal(database.state.row.version, encoded(2));
    }
  }
});

test("新增或移走列的读写竞争不能遗漏未采集字段", () => {
  for (const add of [false, true]) {
    const database = mockDatabase();
    const snapshot = database.capture();
    database.advance();
    database.state.beforeWrite = (state) => {
      if (add) {
        state.columns.push({ ...state.columns[1], name: "new_column" });
        state.row.new_column = encoded(privateMarker);
      } else state.columns.pop();
    };
    sanitizedFailure(() => database.restore(snapshot, 2), /隔离 SQL 执行失败/);
    assert.equal(database.state.row.version, encoded(2));
  }
});

test("缺失必需列、不可信列名、重复列和非 1 主键不能取得快照", () => {
  for (const missing of [
    "id",
    "version",
    "created_at",
    "updated_at",
    "last_alert_at",
  ]) {
    const database = mockDatabase("ops_monitor_policy");
    database.state.columns = database.state.columns.filter(
      (column) => column.name !== missing,
    );
    sanitizedFailure(() => database.capture(), /必需列/);
  }
  for (const badName of ["x`; DELETE", "UnknownCase", "", "x.y"]) {
    const database = mockDatabase();
    database.state.columns[1].name = badName;
    sanitizedFailure(() => database.capture(), /列名不可信/);
  }
  const duplicate = mockDatabase();
  duplicate.state.columns[1].name = "id";
  sanitizedFailure(() => duplicate.capture(), /重复列/);
  const wrongId = mockDatabase();
  wrongId.state.row.id = encoded(2);
  sanitizedFailure(() => wrongId.capture(), /主键必须为 1/);
});

test("缺失、多行、列数错误及无效 HEX 行均拒绝", () => {
  for (const malformed of ["", "31\n31\n", "31\t00\n", "GG\n"]) {
    const database = mockDatabase();
    database.state.rowResult = malformed;
    sanitizedFailure(() => database.capture(), /行返回|记录缺失|列编码/);
  }
});

test("日常库、恶意 DB_URL 与 Compose 参数不能进入表采集或写入", () => {
  for (const changes of [
    { API_TEST_COMPOSE_PROJECT: "mayday" },
    { API_TEST_DATABASE: "mysql" },
    { MAYDAY_TEST_COMPOSE_ARGS: '["compose","-f","compose.yaml"]' },
    { DB_URL: "jdbc:mysql://db.example.invalid:3306/mayday_verify" },
    { DB_URL: "jdbc:mysql://127.0.0.1:3306/mayday" },
    { DB_URL: "jdbc:mysql://name:password@127.0.0.1:3306/mayday_verify" },
    { DB_URL: "jdbc:mysql://127.0.0.1:3306/mayday_verify#secret" },
    { DB_URL: "not-jdbc" },
  ]) {
    const database = mockDatabase();
    sanitizedFailure(
      () =>
        captureSingletonFixture("udp_relay_config", {
          query: database.query,
          environment: { ...environment, ...changes },
        }),
      /隔离/,
    );
    assert(
      !database.state.statements.some((statement) =>
        statement.includes("information_schema"),
      ),
    );
    assert.equal(database.state.writes, 0);
  }
  const daily = mockDatabase();
  daily.state.database = privateMarker;
  sanitizedFailure(() => daily.capture(), /隔离数据库绑定/);
  assert.equal(daily.state.statements.length, 1);
});

test("其他表、伪造快照和跨隔离项目恢复都拒绝", () => {
  const database = mockDatabase();
  for (const table of ["sys_user", "udp_relay_config; UPDATE", undefined])
    sanitizedFailure(
      () =>
        captureSingletonFixture(table, { query: database.query, environment }),
      /不允许/,
    );
  const snapshot = database.capture();
  sanitizedFailure(() => database.restore({ ...snapshot }, 0), /快照来源/);
  sanitizedFailure(
    () =>
      restoreSingletonFixture(snapshot, {
        version: 0,
        query: database.query,
        environment: {
          ...environment,
          API_TEST_COMPOSE_PROJECT: "mayday-check-20261005110000-a1b2c4",
        },
      }),
    /跨隔离项目/,
  );
  assert.equal(database.state.writes, 0);
});

test("写入连接换库在提交前守卫失败，元数据不被提交", () => {
  const database = mockDatabase();
  const snapshot = database.capture();
  database.advance();
  database.state.beforeWrite = (state) => {
    state.database = privateMarker;
  };
  sanitizedFailure(() => database.restore(snapshot, 2), /隔离 SQL 执行失败/);
  assert.equal(database.state.row.version, encoded(2));
});

test("查询异常、错误 ROW_COUNT 与不完整恢复输出都不泄露 SQL 或值", () => {
  sanitizedFailure(
    () =>
      captureSingletonFixture("udp_relay_config", {
        environment,
        query: () => {
          throw new Error(privateMarker + " jdbc:mysql:// UPDATE...");
        },
      }),
    /隔离 SQL 执行失败/,
  );
  for (const result of [
    "2\n",
    "0\n",
    "1\n" + privateMarker + "\n",
    "1\n31\n",
    "1\n31\n31\n",
  ]) {
    const database = mockDatabase();
    const snapshot = database.capture();
    database.advance();
    database.state.transactionResult = result;
    sanitizedFailure(
      () => database.restore(snapshot, 2),
      /修改行数|行返回|列编码/,
    );
  }
});
