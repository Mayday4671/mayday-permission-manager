/**
 * 权限边界专项回归：通过真实 HTTP 接口验证数据越权及权限撤销。
 * 必须使用 compose.verify.yaml 创建的独立数据库，禁止在日常数据库上运行。
 * 不记录口令或会话令牌；所有临时记录按依赖顺序清理。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loginWithCaptcha} from './support/captcha.mjs';
import {spawnSync} from 'node:child_process';

const isolated = /^mayday-check-\d+-[a-f0-9]{6}$/.test(process.env.API_TEST_COMPOSE_PROJECT ?? '')
  && ['fresh-db', 'upgrade-db'].includes(process.env.API_TEST_DATABASE)
  && process.env.API_BASE && process.env.ADMIN_PASSWORD;
const base = process.env.API_BASE;
const prefix = `sec_${Date.now().toString(36)}`;
const password = 'Security_Test_2026!';
async function api(path, token, method = 'GET', data, status = 200) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  // 错误消息不输出成功响应（登录成功响应含令牌）。
  assert.equal(response.status, status, `${method} ${path}: expected ${status}, received ${response.status}`);
  return body.data;
}
const login = async (username, secret = password) => (await loginWithCaptcha(base, username, secret)).token;

test('隔离数据库权限专项回归', { skip: !isolated }, async t => {
  const admin = await login('admin', process.env.ADMIN_PASSWORD);
  const created = { users: [], roles: [], departments: [], workflows: [], jobs: [] };
  const entry = name => ({ name, code: `${prefix}_${name}`, enabled: true, sortOrder: 0 });
  const basePermissions = ['users:view', 'sessions:view', 'sessions:revoke', 'requests:view', 'requests:approve'];
  const role = async (name, scope, permissions = basePermissions) => {
    const value = await api('/system/roles', admin, 'POST', { ...entry(name), permissions, dataScopes: { users: scope, notices: 'SELF' } });
    created.roles.push(value.id); return value;
  };
  const person = async (name, departmentId, assignedRole) => {
    const value = await api('/system/users', admin, 'POST', {
      username: `${prefix}_${name}`, nickname: name, password, enabled: true, departmentId,
      roleIds: [assignedRole.id], email: `${name}@security.example`, phone: '13000000000',
    });
    created.users.push(value.id); return value;
  };
  const sessions = (token, keyword = '') => api(`/operations/sessions?size=100&keyword=${encodeURIComponent(keyword)}`, token);
  try {
    const dept = await api('/system/entries/departments', admin, 'POST', entry('inside')); created.departments.push(dept.id);
    const outside = await api('/system/entries/departments', admin, 'POST', entry('outside')); created.departments.push(outside.id);
    const selfRole = await role('self', 'SELF');
    const operator = await person('operator', dept.id, selfRole);
    const victim = await person('victim', outside.id, selfRole);
    const colleague = await person('colleague', dept.id, selfRole);
    const operatorToken = await login(operator.username);
    let victimToken = await login(victim.username);
    const colleagueToken = await login(colleague.username);

    await t.test('匿名及伪造令牌不能访问系统、文件、通知和审批接口', async () => {
      for (const path of ['/system/users', '/system/roles', '/operations/sessions', '/operations/files', '/operations/notifications', '/operations/requests', '/operations/workflows']) {
        await api(path, null, 'GET', undefined, 401);
        await api(path, 'invalid-token', 'GET', undefined, 401);
      }
    });
    await t.test('已登录但没有授权的账号不能读取各管理模块及摘要接口', async () => {
      const emptyRole = await role('empty_permissions', 'SELF', []);
      const user = await person('empty_permissions', dept.id, emptyRole);
      const token = await login(user.username);
      for (const path of [
        '/dashboard', '/system/users', '/system/users/export', '/system/roles', '/system/roles/permissions',
        '/system/entries/departments', '/system/entries/posts', '/system/entries/menus',
        '/system/entries/settings', '/system/entries/dictionaries', '/system/entries/categories',
        '/system/entries/tags', '/system/entries/approvalcategories', '/system/user-statistics',
        '/system/site-config', '/system/logs', '/system/logs?loginOnly=true',
        '/system/options/users', '/system/options/categories', '/system/options/approvalcategories',
        '/content/notices', '/content/notices/recycle', '/operations/sessions', '/operations/people',
        '/operations/files', '/operations/notifications', '/operations/messages', '/operations/messages/unread',
        '/operations/workflows', '/operations/workflows/roles', '/operations/requests',
        '/operations/monitor', '/operations/scheduler', '/operations/job-logs',
      ]) await api(path, token, 'GET', undefined, 403);
      assert.deepEqual(await api('/system/navigation', token), []);
      assert.deepEqual(await api('/system/lookups', token), { departments: [], roles: [], posts: [] });
    });
    await t.test('任务调度检查及历史结果不能泄露未授权的全站用户总数', async () => {
      const schedulerRole = await role('scheduler_only', 'SELF', ['scheduler:view', 'scheduler:create', 'scheduler:execute']);
      const user = await person('scheduler_only', dept.id, schedulerRole);
      const token = await login(user.username);
      await api('/system/users', token, 'GET', undefined, 403);
      const job = await api('/operations/scheduler', token, 'POST', {
        name: `${prefix}_database_check`, handler: 'DATABASE_CHECK', cron: '0 0 0 * * *', enabled: false,
      });
      created.jobs.push(job.id);
      const execution = await api(`/operations/scheduler/${job.id}/run`, token, 'POST');
      assert.equal(execution.result, '数据库连接正常');
      const history = await api(`/operations/job-logs?keyword=${prefix}`, token);
      assert.equal(history.total, 1);
      assert.equal(history.items[0].result, '数据库连接正常');
    });
    await t.test('本人范围会话列表及总数不得泄露其他账号、IP或设备', async () => {
      const result = await sessions(operatorToken);
      assert.equal(result.total, 1);
      assert.deepEqual(result.items.map(v => v.username), [operator.username]);
      assert.equal(result.items[0].current, true);
      assert.equal('tokenHash' in result.items[0], false);
      assert.equal((await sessions(operatorToken, victim.username)).total, 0);
    });
    await t.test('已知会话 UUID 不能撤销数据范围外同权限用户的会话', async () => {
      const target = (await sessions(admin, victim.username)).items[0];
      await api(`/operations/sessions/${target.id}`, operatorToken, 'DELETE', undefined, 403);
      await api('/auth/me', victimToken);
    });
    // 基线存在漏洞时前一用例可能已撤销目标会话；重新登录，避免后续结果依赖该失败。
    victimToken = await login(victim.username);
    await t.test('本部门管理员只能查看本部门会话，可撤销范围内且可管理的账号', async () => {
      const managerRole = await role('department_manager', 'DEPARTMENT');
      const manager = await person('manager', dept.id, managerRole);
      const token = await login(manager.username);
      const result = await sessions(token);
      assert(result.items.some(v => v.username === colleague.username));
      assert(!result.items.some(v => v.username === victim.username || v.username === 'admin'));
      const target = result.items.find(v => v.username === colleague.username);
      await api(`/operations/sessions/${target.id}`, token, 'DELETE');
      await api('/auth/me', colleagueToken, 'GET', undefined, 401);
      await api('/auth/me', victimToken);
    });
    await t.test('无用户查看权限的会话操作员只能管理本人的会话', async () => {
      const sessionRole = await role('session_only', 'ALL', ['sessions:view', 'sessions:revoke']);
      const user = await person('session_only', dept.id, sessionRole);
      const token = await login(user.username);
      const result = await sessions(token);
      assert.deepEqual(result.items.map(v => v.username), [user.username]);
      await api(`/operations/sessions/${result.items[0].id}`, token, 'DELETE');
      await api('/auth/me', token, 'GET', undefined, 401);
    });
    await t.test('管理员会话不能被低权限账号撤销', async () => {
      const target = (await sessions(admin, 'admin')).items.find(v => v.username === 'admin');
      await api(`/operations/sessions/${target.id}`, operatorToken, 'DELETE', undefined, 403);
      await api('/auth/me', admin);
    });
    await t.test('收紧用户范围后，已有会话立即采用新范围', async () => {
      let scopedRole = await role('dynamic', 'ALL');
      const user = await person('dynamic', dept.id, scopedRole);
      const token = await login(user.username);
      assert((await sessions(token)).items.some(v => v.username === victim.username));
      scopedRole = await api(`/system/roles/${scopedRole.id}`, admin, 'PUT', { ...scopedRole, dataScopes: { users: 'SELF', notices: 'SELF' } });
      assert.deepEqual((await sessions(token)).items.map(v => v.username), [user.username]);
      await api(`/system/roles/${scopedRole.id}`, admin, 'PUT', { ...scopedRole, enabled: false });
      await api('/operations/sessions', token, 'GET', undefined, 403);
    });
    await t.test('指定部门与多角色并集不会扩展到未指定的部门', async () => {
      const custom = await api('/system/roles', admin, 'POST', {
        ...entry('custom_session'), permissions: basePermissions,
        dataScopes: { users: 'CUSTOM', notices: 'SELF' },
        scopeDepartments: [{ resource: 'users', departmentId: outside.id }],
      });
      created.roles.push(custom.id);
      let user = await person('custom', dept.id, custom);
      user = await api(`/system/users/${user.id}`, admin, 'PUT', { ...user, roleIds: [custom.id, selfRole.id] });
      const token = await login(user.username);
      const result = await sessions(token);
      assert.deepEqual(new Set(result.items.map(v => v.username)), new Set([user.username, victim.username]));
      const target = (await sessions(admin, operator.username)).items[0];
      await api(`/operations/sessions/${target.id}`, token, 'DELETE', undefined, 403);
      await api('/auth/me', operatorToken);
    });
    await t.test('编辑本人正在使用的角色不能把新权限或新范围用于自我提权', async () => {
      const ownRole = await role('own_role', 'SELF', ['roles:view', 'roles:update', 'roles:grant']);
      const user = await person('own_role', dept.id, ownRole);
      const token = await login(user.username);
      await api(`/system/roles/${ownRole.id}`, token, 'PUT', { ...ownRole, permissions: [...ownRole.permissions, 'files:view', 'files:all'] }, 403);
      await api(`/system/roles/${ownRole.id}`, token, 'PUT', { ...ownRole, dataScopes: { users: 'ALL', notices: 'SELF' } }, 403);
      await api(`/system/roles/${ownRole.id}`, token, 'PUT', { ...ownRole, code: 'admin' }, 400);
      const me = await api('/auth/me', token);
      assert.equal(me.admin, false);
      assert.deepEqual(new Set(me.permissions), new Set(ownRole.permissions));
    });

    const designerRole = await role('designer', 'SELF', [...basePermissions, 'workflows:view', 'workflows:create']);
    const designer = await person('designer', dept.id, designerRole);
    const designerToken = await login(designer.username);
    const schema = {
      fields: [], startNodeId: 'review', applicantType: 'ALL', applicantIds: [],
      allowSelfApproval: false, allowRepeatApproval: false, allowWithdraw: true,
      nodes: [{ id: 'review', name: '审核', type: 'APPROVAL', source: 'USERS', assigneeIds: [victim.id], mode: 'ALL', next: 'end', readable: [], writable: [], actions: ['APPROVE', 'REJECT'] }, { id: 'end', name: '结束', type: 'END' }],
    };
    await t.test('流程模拟不能借指定人员枚举范围外用户', async () => {
      await api('/operations/workflows/simulate', designerToken, 'POST', { schema, values: {} }, 403);
    });
    await t.test('流程模拟不能借角色解析枚举范围外用户', async () => {
      const byRole = { ...schema, nodes: [{ ...schema.nodes[0], source: 'ROLES', assigneeIds: [selfRole.id] }, schema.nodes[1]] };
      await api('/operations/workflows/simulate', designerToken, 'POST', { schema: byRole, values: {} }, 403);
    });
    await t.test('流程模拟不能借部门负责人解析绕过人员范围', async () => {
      const departments = await api('/system/entries/departments?size=100', admin);
      const current = departments.items.find(d => d.id === dept.id);
      await api(`/system/entries/departments/${dept.id}`, admin, 'PUT', { ...current, leaderId: victim.id });
      try {
        const byLeader = { ...schema, nodes: [{ ...schema.nodes[0], source: 'DEPARTMENT_LEADER', assigneeIds: [] }, schema.nodes[1]] };
        await api('/operations/workflows/simulate', designerToken, 'POST', { schema: byLeader, values: {} }, 403);
      } finally {
        const latest = (await api('/system/entries/departments?size=100', admin)).items.find(d => d.id === dept.id);
        await api(`/system/entries/departments/${dept.id}`, admin, 'PUT', { ...latest, leaderId: null });
      }
    });
    await t.test('没有用户查看权的流程查看者不能使用模拟作为人员查询接口', async () => {
      const viewerRole = await role('flow_viewer', 'ALL', ['workflows:view']);
      const user = await person('flow_viewer', dept.id, viewerRole);
      const token = await login(user.username);
      await api('/operations/workflows/simulate', token, 'POST', { schema, values: {} }, 403);
    });
    await t.test('流程定义人员回显与用户选择器遵守同一数据范围', async () => {
      const categories = await api('/system/entries/approvalcategories?size=100', admin);
      const flow = await api('/operations/workflows', designerToken, 'POST', { ...entry('lookup_probe'), categoryId: categories.items[0].id, businessType: 'GENERAL', schema });
      created.workflows.push(flow.id);
      assert.deepEqual(flow.personOptions, []);
      const detail = await api(`/operations/workflows/${flow.id}`, designerToken);
      assert.deepEqual(detail.personOptions, []);
      const administratorView = await api(`/operations/workflows/${flow.id}`, admin);
      assert(administratorView.personOptions.some(v => v.value === victim.id));
    });
    await t.test('合法范围内流程模拟仍能返回审批路径和人员', async () => {
      const result = await api('/operations/workflows/simulate', admin, 'POST', { schema, values: {} });
      assert(result.path.some(n => n.approvers?.some(p => p.id === victim.id)));
    });
    await t.test('工作台不能将操作日志权限扩展成登录日志权限，统计也须同范围', async () => {
      const auditorRole = await role('operation_auditor', 'SELF', ['dashboard:view', 'logs:view']);
      const user = await person('operation_auditor', dept.id, auditorRole);
      const token = await login(user.username);
      await api('/system/logs?loginOnly=true', token, 'GET', undefined, 403);
      const dashboard = await api('/dashboard', token);
      assert(dashboard.recentLogs.every(item => item.path !== '/api/auth/login'));
      for (const point of dashboard.trend) {
        const list = await api(`/system/logs?from=${point.date}&to=${point.date}&size=1`, token);
        assert.equal(point.count, list.total);
      }
    });
    await t.test('仅有工作台权限不能读取任何审计记录或资源数据', async () => {
      const dashboardRole = await role('dashboard_only', 'ALL', ['dashboard:view']);
      const user = await person('dashboard_only', dept.id, dashboardRole);
      const token = await login(user.username);
      const dashboard = await api('/dashboard', token);
      assert.deepEqual(dashboard.recentLogs, []);
      assert.deepEqual(dashboard.trend, []);
      assert.deepEqual(dashboard.recentNotices, []);
      for (const resource of ['users', 'roles', 'departments', 'notices']) assert.equal(dashboard[resource], null);
    });
    await t.test('个人资料批量字段注入不能修改部门、角色或管理员身份', async () => {
      const before = await api('/auth/me', operatorToken);
      await api('/auth/profile', operatorToken, 'PUT', {
        nickname: '资料注入检查', email: 'profile@security.example', phone: '13000000000',
        username: 'admin', departmentId: outside.id, roleIds: [1], enabled: false, admin: true,
      });
      const after = await api('/auth/me', operatorToken);
      assert.equal(after.admin, false);
      assert.equal(after.user.username, operator.username);
      assert.equal(after.user.departmentId, before.user.departmentId);
      assert.deepEqual(after.permissions, before.permissions);
    });
  } finally {
    // 调度历史没有产品删除入口；仅在已验证的隔离项目中按本测试创建的精确 job_id 清理。
    if (created.jobs.length) {
      assert(created.jobs.every(Number.isSafeInteger));
      const cleaned = spawnSync('docker', ['compose', '-p', process.env.API_TEST_COMPOSE_PROJECT, '-f', 'compose.verify.yaml',
        'exec', '-T', process.env.API_TEST_DATABASE, 'sh', '-c',
        'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE"'], {
        input: `DELETE FROM ops_job_execution WHERE job_id IN (${created.jobs.join(',')});`, encoding: 'utf8', windowsHide: true,
      });
      assert.equal(cleaned.status, 0, '隔离调度历史清理失败');
      for (const id of created.jobs) await api(`/operations/scheduler/${id}`, admin, 'DELETE');
    }
    for (const id of created.workflows.reverse()) await api(`/operations/workflows/${id}`, admin, 'DELETE');
    for (const id of created.users.reverse()) await api(`/system/users/${id}`, admin, 'DELETE');
    for (const id of created.roles.reverse()) await api(`/system/roles/${id}`, admin, 'DELETE');
    for (const id of created.departments.reverse()) await api(`/system/entries/departments/${id}`, admin, 'DELETE');
    await api('/auth/logout', admin, 'POST');
  }
});
