/**
 * 基线验收入口：备份当前 MySQL，在两个独立容器库中验证保留数据升级与空库安装。
 * 不向日常数据库写入、不重置其数据卷、不打印密码或原始用户数据。
 * 命令全部以参数数组执行，数据库凭证由容器环境读取，SQL 不经过宿主机 shell 插值。
 * 成功/失败都会保存日志和结果，再销毁本次生成的验证环境；备份与摘要留在 .local。
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {readDatabaseMetadata, verifyDatabaseComments, structuralColumns} from './database-docs.mjs';
import {snapshotFields, readCrawlerMenu, verifyCrawlerMenuRename} from './migration-snapshot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runId = new Date().toISOString().replace(/[^0-9]/g, '') + '-' + randomBytes(3).toString('hex');
const project = `mayday-check-${runId}`;
// 页面验收可显式保留成功环境；失败一律清理。保留的仅为随机生成的隔离副本。
const keepForPreview = process.argv.includes('--keep-for-preview');
const output = join(root, '.local', 'baseline', runId);
mkdirSync(output, { recursive: true });
const settings = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
  }));
assert(settings.ADMIN_PASSWORD, '.env 缺少 ADMIN_PASSWORD');
const environment = {
  ...process.env,
  VERIFY_DB_PASSWORD: randomBytes(24).toString('hex'),
  VERIFY_ADMIN_PASSWORD: settings.ADMIN_PASSWORD,
};
const sourceCompose = ['compose', '--project-directory', root, '-f', join(root, 'compose.yaml')];
const checkCompose = ['compose', '--project-directory', root, '-p', project, '-f', join(root, 'compose.verify.yaml')];
const result = { runId, project, startedAt: new Date().toISOString(), status: 'running', checks: [] };

function execute(command, args, { input, env = environment, log, allowFailure = false } = {}) {
  const response = spawnSync(command, args, {
    cwd: root, env, input, encoding: 'utf8', windowsHide: true,
    maxBuffer: 128 * 1024 * 1024, timeout: 600_000,
  });
  if (log) writeFileSync(join(output, log), (response.stdout ?? '') + (response.stderr ?? ''), 'utf8');
  if (!allowFailure && (response.error || response.status !== 0)) {
    if (!log) {
      log = 'command-failure.log';
      writeFileSync(join(output, log), response.stderr ?? response.error?.message ?? '未返回错误详情', 'utf8');
    }
    // 输出仅指出本地日志位置，避免把可能含原始业务记录的命令输出直接展示。
    throw new Error(`${command} 执行失败${log ? `，见 ${join(output, log)}` : ''}`, { cause: response.error });
  }
  return response;
}
function docker(args, options) { return execute('docker', args, options).stdout; }
function query(compose, service, sql) {
  return docker([...compose, 'exec', '-T', service, 'sh', '-c',
    'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --raw --skip-column-names',
  ], { input: sql });
}
function mark(name, detail) {
  result.checks.push({ name, status: 'passed', detail });
  console.log(`通过：${name}`);
}
const digest = value => createHash('sha256').update(value).digest('hex');

// 显式列清单只比较迁移前已存在的业务字段。新增字段不影响旧记录一致性判断。
// sys_entry 只比较原有 ID，允许增量迁移为内容补建分类等新记录。
const columns = {
  sys_user: 'id,username,password_hash,nickname,email,phone,department_id,enabled,created_at,updated_at,version',
  sys_role: 'id,code,name,description,enabled,created_at,updated_at,version',
  sys_role_permission: 'role_id,permission',
  sys_role_scope: 'role_id,resource,data_scope',
  sys_user_role: 'user_id,role_id',
  sys_entry: 'id,kind,name,code,value,description,permission,path,parent_id,sort_order,enabled,created_at,updated_at,version',
  cms_notice: 'id,title,category,summary,content,published,author_id,department_id,author_name,created_at,updated_at,version',
};
function snapshot(compose, service, entryLimit) {
  return Object.fromEntries(Object.entries(columns).map(([table, fields]) => {
    const predicate = table === 'sys_entry' ? ` WHERE id <= ${entryLimit}` : '';
    const order = fields.startsWith('id,') ? 'id' : fields;
    return [table, digest(query(compose, service, `SELECT ${snapshotFields(table,fields)} FROM ${table}${predicate} ORDER BY ${order};`))];
  }));
}
function migrations(compose, service) {
  return query(compose, service, 'SELECT version, checksum, success FROM flyway_schema_history ORDER BY installed_rank;').trim();
}
// 业务回归还应清理迁移后新增表和所有新增基础资料，不能仅比较原始 ID 范围。
// 日志及会话有正常测试活动，不纳入静态业务快照；所有测试账号删除时必须撤销其会话。
function verificationSnapshot(service) {
  const tables={sys_entry:'id',sys_dictionary_item:'id',sys_role_scope_department:'role_id,resource,department_id',sys_user_post:'user_id,post_id',cms_notice:'id',cms_notice_tag:'notice_id,tag',cms_revision:'id',cms_revision_tag:'revision_id,tag_id',cms_revision_file:'revision_id,file_id',cms_publication:'id',ops_notification:'id',ops_notification_target:'notification_id,target_id',ops_notification_file:'notification_id,file_id',ops_delivery:'id',ops_file:'id',ops_file_payload:'id'};
  Object.assign(tables,{ops_flow_definition:'id',ops_flow_step:'definition_id,step_index',ops_flow_version:'id',ops_flow_request:'id',ops_request_step:'request_id,step_index',ops_request_file:'request_id,file_id',ops_flow_task:'id',ops_flow_decision:'id',ops_event:'id',ops_job:'id',ops_job_execution:'id'});
  Object.assign(tables,{crawl_task:'id',crawl_item:'id',crawl_article:'id',crawl_article_image:'id'});
  return Object.fromEntries(Object.entries(tables)
    .map(([table,order]) => [table,digest(query(checkCompose,service,`SELECT * FROM ${table} ORDER BY ${order};`))]));
}
function apiSuite(label, port) {
  // TAP 保留子进程退出码及完整断言位置，避免终端精简报告只留下 test failed 而无法定位。
  execute(process.execPath, ['--test','--test-reporter=tap','--test-concurrency=1', 'tests/api.test.mjs','tests/workflow.test.mjs','tests/security.test.mjs','tests/theme.test.mjs','tests/captcha.test.mjs','tests/crawler.test.mjs'], {
    env: { ...environment, API_BASE: `http://127.0.0.1:${port}/api`, ADMIN_PASSWORD: settings.ADMIN_PASSWORD,API_TEST_COMPOSE_PROJECT:project,API_TEST_DATABASE:label==='upgrade'?'upgrade-db':'fresh-db' },
    log: `api-${label}.log`,
  });
  mark(`${label}：真实 MySQL 接口回归`);
}

let createdEnvironment = false;
try {
  console.log(`验收记录：${output}`);
  const sourceVersions = migrations(sourceCompose, 'mysql');
  const sourceSchema = readDatabaseMetadata(sql=>query(sourceCompose,'mysql',sql));
  // 保留采集任务和旧图片关联的真实值；比较源库已有列，不把本次新增文章列误判为数据改动。
  for(const table of sourceSchema.filter(t=>t.name.startsWith('crawl_'))) columns[table.name]=table.columns.map(c=>c.name).join(',');
  if (query(sourceCompose, 'mysql', "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='sys_role_scope_department';").trim() === '1') {
    columns.sys_role_scope_department = 'role_id,resource,department_id';
  }
  if (query(sourceCompose, 'mysql', "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='sys_dictionary_item';").trim() === '1') {
    columns.sys_dictionary_item='id,dictionary_id,label,value,color,sort_order,enabled,created_at,updated_at,version';
  }
  if (query(sourceCompose, 'mysql', "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sys_entry' AND column_name='leader_id';").trim() === '1') {
    columns.sys_entry+=',leader_id,icon';
  }
  writeFileSync(join(output, 'source-migrations.txt'), sourceVersions, 'utf8');
  const entryLimit = Number(query(sourceCompose, 'mysql', 'SELECT COALESCE(MAX(id),0) FROM sys_entry;').trim());
  assert(Number.isSafeInteger(entryLimit) && entryLimit >= 0);
  const before = snapshot(sourceCompose, 'mysql', entryLimit);
  const oldCrawlerMenu = readCrawlerMenu(sql=>query(sourceCompose,'mysql',sql));
  const dump = docker([...sourceCompose, 'exec', '-T', 'mysql', 'sh', '-c',
    'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --user="$MYSQL_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF --skip-comments --skip-add-locks --hex-blob "$MYSQL_DATABASE"',
  ]);
  assert(dump.includes('flyway_schema_history'), '备份未包含迁移记录');
  const backup = join(output, 'source.sql');
  writeFileSync(backup, dump, 'utf8');
  result.backup = { path: backup, sha256: digest(dump), bytes: Buffer.byteLength(dump) };
  mark('原数据库一致性快照与 SQL 备份');

  docker([...checkCompose, 'build', 'backend-upgrade'], { log: 'docker-build.log' });
  createdEnvironment = true;
  docker([...checkCompose, 'up', '-d', '--wait', '--wait-timeout', '180', 'upgrade-db', 'fresh-db'], { log: 'database-start.log' });
  // 导入目标由脚本创建的独立 upgrade-db；从不使用日常 compose 执行导入。
  query(checkCompose, 'upgrade-db', dump);
  assert.deepEqual(snapshot(checkCompose, 'upgrade-db', entryLimit), before, '备份恢复与源数据不一致');
  mark('备份已在独立数据库成功恢复');

  docker([...checkCompose, 'up', '-d', '--wait', '--wait-timeout', '180', 'backend-upgrade', 'backend-fresh'], { log: 'backend-start.log' });
  const upgradeVersions = migrations(checkCompose, 'upgrade-db');
  const freshVersions = migrations(checkCompose, 'fresh-db');
  writeFileSync(join(output, 'upgrade-migrations.txt'), upgradeVersions, 'utf8');
  writeFileSync(join(output, 'fresh-migrations.txt'), freshVersions, 'utf8');
  assert.equal(upgradeVersions, freshVersions, '升级和空库安装的迁移结果不一致');
  assert(upgradeVersions.split('\n').every(line => line.endsWith('\t1')), '存在失败迁移');
  assert.deepEqual(snapshot(checkCompose, 'upgrade-db', entryLimit), before, '升级更改了原有账号、角色权限、组织或内容');
  verifyCrawlerMenuRename(oldCrawlerMenu,readCrawlerMenu(sql=>query(checkCompose,'upgrade-db',sql)));
  mark('升级与空库安装迁移一致，原业务记录与角色授权不变');

  const upgradeSchema=verifyDatabaseComments(sql=>query(checkCompose,'upgrade-db',sql));
  const freshSchema=verifyDatabaseComments(sql=>query(checkCompose,'fresh-db',sql));
  // 对源库每个已有字段逐一核对类型/NULL/默认值/自增/排序规则；允许后续迁移新增字段，不能删除或改变旧字段。
  if(sourceVersions.split('\n').some(line=>line.startsWith('11\t')))
    assert.deepEqual(structuralColumns(sourceSchema.map(old=>{
      const current=upgradeSchema.find(t=>t.name===old.name);assert(current,'升级删除了原有表 '+old.name);
      return {...current,columns:current.columns.filter(column=>old.columns.some(c=>c.name===column.name))};
    })),structuralColumns(sourceSchema),'升级改变或删除了原有字段定义');
  assert.deepEqual(structuralColumns(upgradeSchema),structuralColumns(freshSchema),'空库与升级库结构不一致');
  result.databaseDocumentation={tables:freshSchema.length,columns:freshSchema.reduce((n,t)=>n+t.columns.length,0)};
  mark('所有业务表和字段的中文 COMMENT 完整且一致，原有字段定义保持不变',result.databaseDocumentation);
  assert.equal(query(checkCompose,'fresh-db','SELECT COUNT(*) FROM sys_user;').trim(),'1');
  assert.equal(query(checkCompose,'fresh-db','SELECT COUNT(*) FROM sys_role;').trim(),'1');
  assert.equal(query(checkCompose,'fresh-db','SELECT COUNT(*) FROM cms_notice;').trim(),'0');
  assert.equal(query(checkCompose,'fresh-db',"SELECT COUNT(*) FROM sys_entry WHERE kind='departments';").trim(),'0');
  mark('纯净初始化仅创建管理员及必要基础资料，不创建演示组织、人员或文章');

  const upgradePort = environment.VERIFY_UPGRADE_PORT ?? '18081';
  const freshPort = environment.VERIFY_FRESH_PORT ?? '18082';
  const beforeUpgradeTests=verificationSnapshot('upgrade-db');
  const beforeFreshTests=verificationSnapshot('fresh-db');
  apiSuite('upgrade', upgradePort);
  apiSuite('fresh', freshPort);
  assert.deepEqual(verificationSnapshot('upgrade-db'),beforeUpgradeTests,'升级库测试数据没有完整清理');
  assert.deepEqual(verificationSnapshot('fresh-db'),beforeFreshTests,'空库测试数据没有完整清理');
  assert.deepEqual(snapshot(checkCompose, 'upgrade-db', entryLimit), before, '测试未完整清理临时数据或修改了原有记录');
  mark('接口回归结束后，原业务快照完全一致');

  docker([...checkCompose, 'restart', 'backend-upgrade'], { log: 'backend-restart.log' });
  docker([...checkCompose, 'up', '-d', '--wait', '--wait-timeout', '180', 'backend-upgrade'], { log: 'backend-restart-health.log' });
  assert.equal(migrations(checkCompose, 'upgrade-db'), upgradeVersions);
  assert.deepEqual(snapshot(checkCompose, 'upgrade-db', entryLimit), before);
  mark('重启未重复初始化或改变迁移、原业务数据');
  assert.equal(migrations(sourceCompose, 'mysql'), sourceVersions);
  assert.deepEqual(snapshot(sourceCompose, 'mysql', entryLimit), before);
  mark('日常运行数据库未被本次验证更改');
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (createdEnvironment) {
    execute('docker', [...checkCompose, 'logs', '--no-color'], { log: 'containers.log', allowFailure: true });
    // 只清理由本进程随机生成且校验前缀的项目；绝不对 mayday 主项目执行 down 或删除卷。
    assert(/^mayday-check-\d+-[a-f0-9]{6}$/.test(project));
    if (keepForPreview && result.status === 'passed') {
      result.cleanup = 'retained-for-preview';
      result.preview = { upgradeApi: 'http://127.0.0.1:' + (environment.VERIFY_UPGRADE_PORT ?? '18081'), freshApi: 'http://127.0.0.1:' + (environment.VERIFY_FRESH_PORT ?? '18082') };
      console.log(`已保留页面验收环境：${project}；验收结束后须按此项目名清理容器与卷。`);
    } else {
      const cleanup = execute('docker', [...checkCompose, 'down', '--volumes', '--remove-orphans'], { log: 'cleanup.log', allowFailure: true });
      result.cleanup = cleanup.status === 0 ? 'passed' : 'failed';
      if (cleanup.status !== 0) { result.status = 'failed'; process.exitCode = 1; }
    }
  }
  result.finishedAt = new Date().toISOString();
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`验收结果：${result.status}，${join(output, 'result.json')}`);
}
