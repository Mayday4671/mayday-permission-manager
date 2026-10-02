/**
 * MySQL 端到端 API 回归测试。要求先启动本地后端；所有测试记录使用唯一前缀，并在 finally 中清理。
 * 测试通过 HTTP 调用真实认证过滤器、方法权限、事务与数据库，重点覆盖页面隐藏无法防住的越权。
 * 推荐由 scripts/verify-baseline.mjs 在独立数据库运行；清理顺序为内容软删除/彻底删除、用户、角色、部门。
 * 执行：node --test tests/api.test.mjs（API_BASE / ADMIN_PASSWORD 可通过环境变量覆盖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loginWithCaptcha} from './support/captcha.mjs';

const base = process.env.API_BASE ?? 'http://127.0.0.1:18080/api';
const prefix = `qa_${Date.now().toString(36)}`;
const password = 'QaOnly_Test2026!';
async function request(path, { token, method = 'GET', data, status = 200 } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(body)}`);
  if (status < 400) assert.equal(body.success, true);
  return body.data;
}
const put = (path, token, data, status) => request(path, { token, data, status, method: 'PUT' });
const post = (path, token, data, status) => request(path, { token, data, status, method: 'POST' });
const login = async (username, secret = password) => (await loginWithCaptcha(base, username, secret)).token;

test('真实 MySQL 权限与业务回归', async t => {
  const admin = await login('admin', process.env.ADMIN_PASSWORD ?? 'Mayday@2026');
  const created = { notices: [], users: [], roles: [], departments: [], dictionaries: [], dictionaryItems: [], posts: [], settings: [], notifications: [], files: [], categories: [], tags: [] };
  const entry = name => ({ name, code: `${prefix}_${name}`, enabled: true, sortOrder: 0 });
  const rolePayload = (name, scope, permissions) => ({ name, code: `${prefix}_${name}`, description: '自动回归测试临时记录', enabled: true, permissions, dataScopes: { users: scope, notices: scope } });
  const createRole = async (name, scope, permissions) => { const r = await post('/system/roles', admin, rolePayload(name, scope, permissions)); created.roles.push(r.id); return r; };
  const createUser = async (name, departmentId, role) => { const u = await post('/system/users', admin, { username: `${prefix}_${name}`, nickname: name, email: `${name}@test.example`, phone: '13000000000', enabled: true, roleIds: [role.id], departmentId, password }); created.users.push(u.id); return u; };
  const allUsers = token => request('/system/users?size=100', { token });
  let draft;
  try {
    const dept = await post('/system/entries/departments', admin, entry('root')); created.departments.push(dept.id);
    const child = await post('/system/entries/departments', admin, { ...entry('child'), parentId: dept.id }); created.departments.push(child.id);
    const outsider = await post('/system/entries/departments', admin, entry('outside')); created.departments.push(outsider.id);
    const basePermissions = ['dashboard:view', 'users:view', 'users:update', 'users:delete', 'notices:view', 'notices:create', 'notices:update', 'notices:delete'];
    let selfRole = await createRole('self', 'SELF', basePermissions);
    const departmentRole = await createRole('dept', 'DEPARTMENT', basePermissions);
    const treeRole = await createRole('tree', 'DEPARTMENT_TREE', basePermissions);
    const delegatorRole = await createRole('delegate', 'SELF', ['roles:view', 'roles:create', 'roles:update', 'roles:delete', 'roles:grant']);
    const self = await createUser('self', dept.id, selfRole);
    const colleague = await createUser('colleague', dept.id, departmentRole);
    const descendant = await createUser('descendant', child.id, selfRole);
    const treeUser = await createUser('tree', dept.id, treeRole);
    const outsideUser = await createUser('outside', outsider.id, selfRole);
    const delegate = await createUser('delegate', null, delegatorRole);
    const selfToken = await login(self.username); const deptToken = await login(colleague.username);
    const treeToken = await login(treeUser.username); const outsideToken = await login(outsideUser.username); const delegateToken = await login(delegate.username);

    await t.test('匿名不能读取用户列表', () => request('/system/users', { status: 401 }));
    await t.test('不接受伪造的会话令牌', () => request('/system/users', { token: 'invalid-token', status: 401 }));
    await t.test('UDP 转发匿名与普通成员不能读取配置、统计或控制监听', async () => {
      for(const path of ['/relay/config','/relay/stats','/relay/interfaces']) {
        await request(path,{status:401});await request(path,{token:selfToken,status:403});
      }
      await put('/relay/config',selfToken,{bindIp:'127.0.0.1',bindPort:19000,targetIp:'127.0.0.1',targetPort:19001,receiveBufferMiB:16,sendBufferMiB:16,pendingMemoryMiB:64,version:0},403);
      await post('/relay/start',selfToken,{version:0},403);await post('/relay/stop',selfToken,{runId:''},403);
    });
    await t.test('UDP 查看、配置与启停分别授权，版本与运行批次防止旧页面覆盖', async () => {
      const readerRole=await createRole('relay_reader','SELF',['relay:view']);
      const editorRole=await createRole('relay_editor','SELF',['relay:view','relay:configure']);
      const operatorRole=await createRole('relay_operator','SELF',['relay:view','relay:control']);
      const reader=await createUser('relay_reader',null,readerRole),editor=await createUser('relay_editor',null,editorRole),operator=await createUser('relay_operator',null,operatorRole);
      const readToken=await login(reader.username),editToken=await login(editor.username),operateToken=await login(operator.username);
      const original=await request('/relay/config',{token:admin});
      const payload=row=>({bindIp:row.bindIp,bindPort:row.bindPort,targetIp:row.targetIp,targetPort:row.targetPort,receiveBufferMiB:row.receiveBufferMiB,sendBufferMiB:row.sendBufferMiB,pendingMemoryMiB:row.pendingMemoryMiB,version:row.version,sendIp:row.sendIp,sendPort:row.sendPort,transportMode:row.transportMode});
      try {
        assert.equal((await request('/relay/stats',{token:readToken})).state,'STOPPED');
        await put('/relay/config',readToken,payload(original),403);
        await post('/relay/start',readToken,{version:original.version},403);
        await put('/relay/config',editToken,{...payload(original),targetIp:'0.0.0.0'},400);
        await put('/relay/config',editToken,{...payload(original),targetPort:original.bindPort},400);
        const nics=await request('/relay/interfaces',{token:readToken});assert(nics.some(n=>n.ip==='127.0.0.1'&&n.up));
        await put('/relay/config',editToken,{...payload(original),sendIp:'203.0.113.1'},400);
        await put('/relay/config',editToken,{...payload(original),transportMode:'INVALID'},400);
        let saved=await put('/relay/config',editToken,{...payload(original),bindIp:'127.0.0.1',bindPort:19002,sendIp:'127.0.0.1',sendPort:19003,transportMode:'NIO'});
        await put('/relay/config',editToken,payload(original),409);
        await post('/relay/start',editToken,{version:saved.version},403);
        await put('/relay/config',operateToken,payload(saved),403);
        await post('/relay/start',operateToken,{version:original.version},409);
        // 普通后台权限回归不能假设宿主机已调整 UDP 内核缓冲。仅接受精确的缓冲不足保护；
        // 端口冲突、其他 400/500、错误状态仍使测试失败，不把环境问题泛化为允许失败。
        const response=await fetch(`${base}/relay/start`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${operateToken}`},body:JSON.stringify({version:saved.version})});
        const body=await response.json();
        if(response.status===400 && /^UDP 监听启动失败：系统收发缓冲不足：/.test(body.message??'')) {
          assert.equal(body.success,false);
          const failed=await request('/relay/stats',{token:readToken});assert.equal(failed.state,'FAILED');
          assert(failed.actualReceiveBuffer<saved.receiveBufferMiB*1024*1024 || failed.actualSendBuffer<saved.sendBufferMiB*1024*1024);
          assert.equal(failed.receivedPackets,0);assert.equal(failed.pendingPackets,0);
          await post('/relay/stop',operateToken,{runId:'older-run'},400);
          t.diagnostic('系统 UDP 缓冲不足：已验证明确拒绝启动；本轮未验证成功启停。部署验收设置 API_TEST_REQUIRE_UDP_BUFFERS=true，禁止以此分支通过。');
          assert.notEqual(process.env.API_TEST_REQUIRE_UDP_BUFFERS,'true','严格 UDP 环境验收要求实际收发缓冲满足配置，请先调整系统参数');
        } else {
          assert.equal(response.status,200,`UDP 启动出现非预期失败：${JSON.stringify(body)}`);assert.equal(body.success,true);
          const run=body.data;assert.equal(run.state,'RUNNING');
          assert.equal(run.transport,'NIO');assert.equal(run.boundAddress,'127.0.0.1:19002');assert.equal(run.sendAddress,'127.0.0.1:19003');
          await put('/relay/config',editToken,payload(saved),400);
          await post('/relay/start',operateToken,{version:saved.version},400);
          await post('/relay/stop',operateToken,{runId:'older-run'},400);
          const stopped=await post('/relay/stop',operateToken,{runId:run.runId});assert.equal(stopped.state,'STOPPED');assert.equal(stopped.pendingPackets,0);
        }
        const menu=(await request('/system/navigation',{token:readToken})).find(m=>m.path==='/admin/udp-relay');assert.equal(menu.permission,'relay:view');
      } finally {
        const state=await request('/relay/stats',{token:admin});if(state.state==='RUNNING')await post('/relay/stop',admin,{runId:state.runId});
        const current=await request('/relay/config',{token:admin});await put('/relay/config',admin,{...payload(original),version:current.version});
      }
    });
    await t.test('本人范围仅返回本人，并隐藏敏感字段和密码散列', async () => {
      const list = await allUsers(selfToken); assert.deepEqual(list.items.map(x => x.id), [self.id]);
      assert.equal(list.items[0].email, null); assert.equal(list.items[0].phone, null); assert.equal('passwordHash' in list.items[0], false);
    });
    await t.test('本部门范围包含同事但不包含下级或其他部门', async () => {
      const ids = (await allUsers(deptToken)).items.map(x => x.id); assert(ids.includes(self.id)); assert(ids.includes(colleague.id)); assert(!ids.includes(descendant.id)); assert(!ids.includes(outsideUser.id));
    });
    await t.test('部门及下级范围包含子部门并排除其他组织', async () => {
      const ids = (await allUsers(treeToken)).items.map(x => x.id); assert(ids.includes(descendant.id)); assert(!ids.includes(outsideUser.id));
    });
    await t.test('人员选择器只返回范围内有效账号的最小字段', async () => {
      const options=await request('/system/options/users',{token:selfToken});
      assert.deepEqual(options.items,[{value:self.id,label:`self · ${self.username}`}]);
      assert.equal((await request(`/system/options/users?keyword=${outsideUser.username}`,{token:selfToken})).total,0);
      await request('/system/options/users',{token:delegateToken,status:403});
    });
    await t.test('独立字典项唯一、跨类型隔离、版本检查和启停即时生效',async()=>{
      let dictionary=await post('/system/entries/dictionaries',admin,entry('dictionary'));
      created.dictionaries.push(dictionary.id);
      const other=await post('/system/entries/dictionaries',admin,entry('dictionary_other'));
      created.dictionaries.push(other.id);
      const input={label:'允许',value:'yes',color:'success',sortOrder:2,enabled:true};
      let item=await post(`/system/dictionaries/${dictionary.id}/items`,admin,input);
      created.dictionaryItems.push({typeId:dictionary.id,id:item.id});
      const options=()=>request(`/system/dictionary-options/${dictionary.code}`,{token:selfToken});
      assert.deepEqual(await options(),[{value:'yes',label:'允许',color:'success'}]);
      await post(`/system/dictionaries/${dictionary.id}/items`,admin,input,409);
      await put(`/system/dictionaries/${other.id}/items/${item.id}`,admin,{...item,label:'跨类型'},400);
      await put(`/system/dictionaries/${dictionary.id}/items/${item.id}`,selfToken,{...item,label:'越权'},403);
      const old=item;
      item=await put(`/system/dictionaries/${dictionary.id}/items/${item.id}`,admin,{...item,label:'已批准',sortOrder:1});
      assert.equal((await options())[0].label,'已批准');
      await put(`/system/dictionaries/${dictionary.id}/items/${item.id}`,admin,{...old,label:'过期'},409);
      item=await put(`/system/dictionaries/${dictionary.id}/items/${item.id}`,admin,{...item,enabled:false});
      assert.deepEqual(await options(),[]);
      await put(`/system/dictionaries/${dictionary.id}/items/${item.id}`,admin,{...item,enabled:true});
      dictionary=await put(`/system/entries/dictionaries/${dictionary.id}`,admin,{...dictionary,enabled:false});
      assert.deepEqual(await options(),[]);
      await request(`/system/entries/dictionaries/${dictionary.id}`,{token:admin,method:'DELETE',status:400});
    });
    await t.test('用户统计使用用户范围及成功登录去重，无权角色不能读取',async()=>{
      await request('/system/user-statistics',{token:selfToken,status:403});
      const role=await createRole('statistics','SELF',['users:view','userstats:view']);
      const user=await createUser('statistics',dept.id,role);
      const token=await login(user.username);
      const stats=await request('/system/user-statistics?days=7',{token});
      assert.equal(stats.total,1); assert.equal(stats.enabled,1); assert.equal(stats.activeUsers,1);
      assert.equal(stats.disabled,0); assert.equal(stats.loginFailure,null); assert.equal(stats.trend.length,7);
      assert.equal(stats.loginSuccess,1);
      await login(user.username);
      const again=await request('/system/user-statistics?days=7',{token});
      assert.equal(again.activeUsers,1); assert.equal(again.loginSuccess,2);
      await request('/system/user-statistics?days=999',{token,status:400});
    });
    await t.test('登录与操作日志分开授权，详情导出不能绕过，清理保留最近30天',async()=>{
      const role=await createRole('login_auditor','SELF',['loginlogs:view']);
      const user=await createUser('login_auditor',dept.id,role); const token=await login(user.username);
      const logs=await request('/system/logs?loginOnly=true',{token}); assert(logs.items.length>0);
      assert(logs.items.every(log=>log.path==='/api/auth/login'));
      const id=logs.items[0].id;
      assert.equal((await request(`/system/logs/${id}?loginOnly=true`,{token})).id,id);
      await request('/system/logs',{token,status:403});
      await request(`/system/logs/${id}`,{token:admin,status:400});
      await request('/system/logs/export?loginOnly=true',{token,status:403});
      await request('/system/logs',{token,method:'DELETE',data:{loginOnly:true,before:'2000-01-01'},status:403});
      await request('/system/logs',{token:admin,method:'DELETE',data:{loginOnly:true,before:new Date().toISOString().slice(0,10)},status:400});
      const exported=await request('/system/logs/export?loginOnly=true',{token:admin});
      assert(exported.items.every(log=>log.path==='/api/auth/login'));
      assert((await request('/system/logs',{token:admin})).items.every(log=>log.path!=='/api/auth/login'));
    });
    await t.test('菜单路径权限成对登记，岗位引用禁止删除',async()=>{
      await post('/system/entries/menus',admin,{...entry('bad_menu'),path:'/admin/nonexistent',permission:'users:view'},400);
      await post('/system/entries/menus',admin,{...entry('wrong_menu'),path:'/admin/users',permission:'roles:view'},400);
      const postEntry=await post('/system/entries/posts',admin,entry('post')); created.posts.push(postEntry.id);
      const user=await createUser('posted',dept.id,selfRole);
      await put(`/system/users/${user.id}`,admin,{...user,postIds:[postEntry.id]});
      await request(`/system/entries/posts/${postEntry.id}`,{token:admin,method:'DELETE',status:400});
    });
    await t.test('参数类型与网站白名单统一校验，失败保存不改变公开配置',async()=>{
      const before=await request('/public/site');
      const value={...entry('typed_parameter'),groupName:'测试',valueType:'BOOLEAN',value:'true'};
      let setting=await post('/system/entries/settings',admin,value); created.settings.push(setting.id);
      await put(`/system/entries/settings/${setting.id}`,admin,{...setting,value:'yes'},400);
      setting=await put(`/system/entries/settings/${setting.id}`,admin,{...setting,valueType:'NUMBER',value:'12.5'});
      await put(`/system/entries/settings/${setting.id}`,admin,{...setting,value:'NaN'},400);
      setting=await put(`/system/entries/settings/${setting.id}`,admin,{...setting,valueType:'JSON',value:'{"test":true}'});
      await put(`/system/entries/settings/${setting.id}`,admin,{...setting,value:'{} false'},400);
      await put(`/system/entries/settings/${setting.id}`,admin,{...setting,value:'{bad'},400);
      assert.equal((await request('/system/entries/settings?groupName='+encodeURIComponent('测试'),{token:admin})).items.find(item=>item.id===setting.id).value,'{"test":true}');
      await post('/system/site-config/refresh',admin,{});
      assert.deepEqual(await request('/public/site'),before);
      const config=await request('/system/site-config',{token:admin});
      assert(config.fields.some(field=>field.key==='site.title'));
      await put('/system/site-config',admin,{'private.secret':{value:'denied'}},400);
      const name=config.entries.find(entry=>entry.code==='site.name');
      await put(`/system/entries/settings/${name.id}`,admin,{...name,code:'renamed.site'},400);
      await request(`/system/entries/settings/${name.id}`,{token:admin,method:'DELETE',status:400});
      await put('/system/site-config',admin,{'site.name':{value:'invalid partial update',version:name.version},'site.contact':{value:'invalid-email'}},400);
      assert.deepEqual(await request('/public/site'),before);
      await request('/system/site-config',{token:selfToken,status:403});
    });
    await t.test('指定部门只包含明确选择的部门，列表与导出范围一致', async () => {
      const custom = await post('/system/roles', admin, {
        ...rolePayload('custom', 'SELF', [...basePermissions, 'users:export']),
        dataScopes: { users: 'CUSTOM', notices: 'SELF' },
        scopeDepartments: [{ resource: 'users', departmentId: outsider.id }],
      });
      created.roles.push(custom.id);
      let user = await createUser('custom', dept.id, custom);
      const token = await login(user.username);
      assert.deepEqual((await allUsers(token)).items.map(item => item.id), [outsideUser.id]);
      assert.deepEqual((await request('/system/users/export', { token })).items.map(item => item.id), [outsideUser.id]);
      await put(`/system/users/${descendant.id}`, token, { ...descendant, nickname: '范围外修改' }, 403);
      // 把本人范围加入同一账号，合并后保留指定部门及本人，但不能获得整个所在部门。
      user = await put(`/system/users/${user.id}`, admin, { ...user, roleIds: [custom.id, selfRole.id] });
      assert.deepEqual((await allUsers(token)).items.map(item => item.id).sort(), [outsideUser.id, user.id].sort());
      const unrelated = await createRole('unrelated', 'ALL', ['dashboard:view']);
      user = await put(`/system/users/${user.id}`, admin, { ...user, roleIds: [...user.roleIds, unrelated.id] });
      assert.deepEqual((await allUsers(token)).items.map(item => item.id).sort(), [outsideUser.id, user.id].sort());
      const childGrant = await post('/system/roles', admin, {
        ...rolePayload('custom_child', 'SELF', ['users:view']), dataScopes: { users: 'CUSTOM' },
        scopeDepartments: [{ resource: 'users', departmentId: child.id }],
      });
      created.roles.push(childGrant.id);
      await put(`/system/users/${user.id}`, admin, { ...user, roleIds: [...user.roleIds, childGrant.id] });
      assert.deepEqual((await allUsers(token)).items.map(item => item.id).sort(), [outsideUser.id, user.id, descendant.id].sort());
    });
    await t.test('自定义范围拒绝空集合、非部门记录、非管理员委托', async () => {
      const custom = { ...rolePayload('invalid_custom', 'SELF', ['users:view']), dataScopes: { users: 'CUSTOM' } };
      await post('/system/roles', admin, custom, 400);
      await post('/system/roles', admin, { ...custom, scopeDepartments: [{ resource: 'users', departmentId: -1 }] }, 400);
      await post('/system/roles', admin, { ...custom, scopeDepartments: [null] }, 400);
      await post('/system/roles', delegateToken, { ...custom, scopeDepartments: [{ resource: 'users', departmentId: dept.id }] }, 403);
    });
    await t.test('邮箱与电话分别授权，写入和导出不能绕过字段限制', async () => {
      let fields = await createRole('fields', 'SELF', ['users:view', 'users:update', 'users:export', 'users:email-read']);
      const user = await createUser('fields', dept.id, fields);
      const token = await login(user.username);
      const visible = (await allUsers(token)).items[0];
      assert(visible.email); assert.equal(visible.phone, null);
      await put(`/system/users/${user.id}`, token, { ...visible, email: 'denied@test.example' }, 403);
      await put(`/system/users/${user.id}`, token, { ...visible, phone: '13999999999' }, 403);
      fields = await put(`/system/roles/${fields.id}`, admin, { ...fields, permissions: [...fields.permissions, 'users:email-write'] });
      const saved = await put(`/system/users/${user.id}`, token, { ...visible, email: 'allowed@test.example' });
      assert.equal(saved.email, 'allowed@test.example'); assert.equal(saved.phone, null);
      const exported = (await request('/system/users/export', { token })).items[0];
      assert.equal(exported.email, 'allowed@test.example'); assert.equal(exported.phone, null);
      assert.equal((await allUsers(admin)).items.find(item => item.id === user.id).phone, user.phone);
      await post('/system/roles', admin, rolePayload('invalid_field_write', 'SELF', ['users:view', 'users:email-write']), 400);
    });
    await t.test('直接猜测 ID 无法编辑或删除范围外用户', async () => {
      await put(`/system/users/${outsideUser.id}`, selfToken, { ...outsideUser, nickname: '越权修改' }, 403);
      await request(`/system/users/${outsideUser.id}`, { token: selfToken, method: 'DELETE', status: 403 });
    });
    await t.test('导出、敏感信息和重置密码分别授权', async () => {
      await request('/system/users/export', { token: selfToken, status: 403 });
      await put(`/system/users/${self.id}/password`, selfToken, { password: 'AnotherPass2026!' }, 403);
      assert((await allUsers(admin)).items.find(x => x.id === self.id).email);
    });
    await t.test('普通成员不能通过更新用户表单分配管理员角色', async () => {
      const adminRole = (await request('/system/roles?keyword=admin&size=100', { token: admin })).items.find(r => r.code === 'admin');
      assert(adminRole, '管理员角色应能按唯一编码检索到');
      await put(`/system/users/${self.id}`, selfToken, { ...self, roleIds: [adminRole.id] }, 403);
    });
    await t.test('批量启停逐项授权、版本冲突整批回滚并撤销被停用账号会话',async()=>{
      const first=await createUser('batch_a',dept.id,selfRole);
      const second=await createUser('batch_b',outsider.id,selfRole);
      const token=await login(first.username);
      const rows=[first,second].map(({id,version})=>({id,version}));
      await put('/system/users/status',selfToken,{enabled:false,rows},403);
      await put('/system/users/status',admin,{enabled:false,rows:[rows[0],{...rows[1],version:-1}]},409);
      assert((await allUsers(admin)).items.filter(u=>[first.id,second.id].includes(u.id)).every(u=>u.enabled));
      await request('/auth/me',{token});
      await put('/system/users/status',admin,{enabled:false,rows});
      assert((await allUsers(admin)).items.filter(u=>[first.id,second.id].includes(u.id)).every(u=>!u.enabled));
      await request('/auth/me',{token,status:401});
      const me=(await request('/auth/me',{token:admin})).user;
      await put('/system/users/status',admin,{enabled:false,rows:[{id:me.id,version:me.version}]},400);
    });
    await t.test('可以创建个人草稿且公开详情不泄露草稿', async () => {
      draft = await post('/content/notices', selfToken, { title: `${prefix} 100%_!\\ 私有草稿`, category: '公告', content: '只允许作者看到', summary: '自动测试', published: false });
      created.notices.push(draft.id); await request(`/public/articles/${draft.id}`, { status: 404 });
      const list = await request(`/public/articles?keyword=${prefix}`); assert.equal(list.total, 0);
    });
    await t.test('关键词中的下划线、百分号和转义符按普通文字检索', async () => {
      const search = async keyword => request(`/content/notices?keyword=${encodeURIComponent(keyword)}`, { token: selfToken });
      assert.deepEqual((await search(prefix)).items.map(item => item.id), [draft.id]);
      assert.deepEqual((await search('100%_!\\')).items.map(item => item.id), [draft.id]);
      assert.equal((await search('100AB')).total, 0);
      assert.deepEqual((await request(`/system/users?keyword=${self.username}`, { token: selfToken })).items.map(item => item.id), [self.id]);
    });
    await t.test('没有发布权限不能把草稿发布到前台', () => put(`/content/notices/${draft.id}`, selfToken, { ...draft, published: true }, 403));
    await t.test('其他部门无法修改作者草稿', () => put(`/content/notices/${draft.id}`, outsideToken, { ...draft, content: '越权正文' }, 403));
    await t.test('发布后前台可见，原作者无发布权不能改公开正文', async () => {
      draft = await put(`/content/notices/${draft.id}`, admin, { ...draft, published: true });
      assert.equal((await request(`/public/articles/${draft.id}`)).title, draft.title);
      assert.deepEqual((await request(`/public/articles?keyword=${encodeURIComponent('100%_!\\')}`)).items.map(item => item.id), [draft.id]);
      await put(`/content/notices/${draft.id}`, selfToken, { ...draft, content: '绕过发布检查' }, 403);
      await request(`/content/notices/${draft.id}`, { token: selfToken, method: 'DELETE', status: 403 });
    });
    await t.test('软删除内容从公开列表和详情消失，并进入回收站', async () => {
      await request(`/content/notices/${draft.id}`, { token: admin, method: 'DELETE' });
      await request(`/public/articles/${draft.id}`, { status: 404 });
      assert.equal((await request(`/public/articles?keyword=${prefix}`)).total, 0);
      assert.equal((await request(`/content/notices?keyword=${prefix}`, { token: admin })).total, 0);
      const recycled = await request(`/content/notices/recycle?keyword=${prefix}`, { token: admin });
      assert.equal(recycled.total, 1);
      draft = recycled.items[0];
      assert(draft.deletedAt);
    });
    await t.test('恢复需要独立权限且只恢复为草稿，过期版本不能覆盖', async () => {
      await post(`/content/notices/${draft.id}/restore`, selfToken, { version: draft.version }, 403);
      await post(`/content/notices/${draft.id}/restore`, admin, { version: draft.version - 1 }, 409);
      draft = await post(`/content/notices/${draft.id}/restore`, admin, { version: draft.version });
      assert.equal(draft.published, false);
      assert.equal(draft.deletedAt, null);
      await request(`/public/articles/${draft.id}`, { status: 404 });
      await request(`/content/notices/${draft.id}/purge`, { token: admin, method: 'DELETE', status: 400 });
    });
    await t.test('权限管理员不能授予自己没有的权限或范围', async () => {
      await post('/system/roles', delegateToken, rolePayload('escalate', 'SELF', ['users:view', 'users:assign']), 403);
      await post('/system/roles', delegateToken, rolePayload('scopeEscalate', 'ALL', ['roles:view']), 403);
      await post('/system/roles', admin, rolePayload('unknown', 'SELF', ['system:root']), 400);
    });
    await t.test('角色权限变化在现有会话下一次请求时生效', async () => {
      selfRole = await put(`/system/roles/${selfRole.id}`, admin, { ...selfRole, permissions: [...selfRole.permissions, 'users:export'] });
      const exported = await request('/system/users/export', { token: selfToken }); assert.equal(exported.total, 1); assert.equal(exported.items[0].email, null);
    });
    await t.test('乐观锁拒绝过期版本编辑，避免覆盖他人修改', async () => {
      const latest = (await allUsers(admin)).items.find(u => u.id === descendant.id);
      await put(`/system/users/${descendant.id}`, admin, { ...latest, nickname: '已更新' });
      await put(`/system/users/${descendant.id}`, admin, { ...latest, nickname: '过期覆盖' }, 409);
    });
    await t.test('组织结构拒绝循环以及跨资源 ID 更新', async () => {
      await put(`/system/entries/departments/${dept.id}`, admin, { ...dept, parentId: child.id }, 400);
      await put(`/system/entries/menus/${dept.id}`, admin, { ...dept, path: '/admin', permission: 'dashboard:view' }, 400);
    });
    await t.test('账号停用立即撤销已有会话', async () => {
      const latest = (await allUsers(admin)).items.find(u => u.id === outsideUser.id);
      await put(`/system/users/${outsideUser.id}`, admin, { ...latest, enabled: false });
      await request('/auth/me', { token: outsideToken, status: 401 });
    });
    await t.test('重置密码立即撤销会话，旧密码不再可用', async () => {
      await put(`/system/users/${self.id}/password`, admin, { password: 'ChangedPassword2026!' });
      await request('/auth/me', { token: selfToken, status: 401 });
      await loginWithCaptcha(base, self.username, password, 401);
      const renewed = await login(self.username, 'ChangedPassword2026!'); await request('/auth/me', { token: renewed });
    });
    await t.test('保护内置管理员及已被引用的角色', async () => {
      const me = await request('/auth/me', { token: admin });
      await request(`/system/users/${me.user.id}`, { token: admin, method: 'DELETE', status: 400 });
      await request(`/system/roles/${selfRole.id}`, { token: admin, method: 'DELETE', status: 400 });
    });
    await t.test('审计记录失败操作并且不记录密码或令牌', async () => {
      const logs = await request('/system/logs?success=false&size=100', { token: admin }); assert(logs.items.length > 0);
      assert(logs.items.some(log => log.status === 403)); const serialized = JSON.stringify(logs); assert(!serialized.includes(password)); assert(!serialized.includes(selfToken));
    });
    await t.test('公开配置严格白名单，不泄露全部系统参数', async () => {
      const site = await request('/public/site'); assert.deepEqual(Object.keys(site).sort(), ['address','categories','contact','copyright','description','icp','keywords','name','phone','seoTitle','theme']);
      assert.deepEqual(Object.keys(site.theme).sort(), ['borderRadius','compact','mode','primaryColor']);
    });
    await t.test('普通角色只获得显式授予的权限，不默认获得新模块权限', async () => {
      const current = await request('/auth/me', { token: deptToken });
      for (const permission of ['messages:view', 'requests:view', 'requests:create']) {
        assert(!current.permissions.includes(permission));
      }
    });
    await t.test('内容修订隔离线上正文、稳定分类标签、封面附件权限、回收站和统计真实生效',async()=>{
      const category=await post('/system/entries/categories',admin,entry('cms_category'));created.categories.push(category.id);
      const tag=await post('/system/entries/tags',admin,entry('cms_tag'));created.tags.push(tag.id);
      const uploadFile=async(name,bytes)=>{const body=new FormData();body.append('file',new Blob([bytes]),name);const response=await fetch(`${base}/operations/files`,{method:'POST',headers:{Authorization:`Bearer ${admin}`},body});assert.equal(response.status,200);const file=(await response.json()).data;created.files.push(file.id);return file;};
      const cover=await uploadFile(`${prefix}.png`,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));
      const attachment=await uploadFile(`${prefix}.txt`,'cms-public-attachment');
      const baseDraft={title:`${prefix} 内容版本`,categoryId:category.id,tagIds:[tag.id],summary:'摘要',content:'<p>版本一<strong>重点</strong><script>bad()</script></p>',contentFormat:'HTML',visibility:'PUBLIC',coverId:cover.id,attachmentIds:[attachment.id],recommended:true,pinned:true,sortOrder:5,seoTitle:'搜索标题',seoKeywords:'版本,内容',seoDescription:'搜索摘要',requiresApproval:false};
      let n=await post('/content/notices',admin,baseDraft);created.notices.push(n.id);assert.equal(n.revisionNumber,1);assert(!n.content.includes('script'));
      await request(`/public/articles/${n.id}`,{status:404});
      await request(`/public/articles/${n.id}/cover`,{status:404});
      await post(`/content/notices/${n.id}/publish`,admin,{version:n.version,revisionId:n.revisionId+99999},400);
      n=await post(`/content/notices/${n.id}/publish`,admin,{version:n.version,revisionId:n.revisionId});const firstRevision=n.revisionId;
      let live=await request(`/public/articles/${n.id}`);assert.equal(live.content,'<p>版本一<strong>重点</strong></p>');assert.equal(live.seoTitle,'搜索标题');assert.equal(live.coverUrl,`/api/public/articles/${n.id}/cover`);
      assert.equal('authorId' in live,false);assert.equal('departmentId' in live,false);assert.equal('revisionId' in live,false);
      let image=await fetch(`${base}/public/articles/${n.id}/cover`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('cache-control'),'no-store');
      let file=await fetch(`${base}/public/articles/${n.id}/files/${attachment.id}`);assert.equal(await file.text(),'cms-public-attachment');
      await request(`/public/articles/${n.id}/files/${cover.id}`,{status:404});
      const beforeViews=live.viewCount;await request(`/public/articles/${n.id}`);assert.equal((await request(`/public/articles/${n.id}`)).viewCount,beforeViews);
      assert.equal(await post(`/public/articles/${n.id}/view`),beforeViews+1);
      assert.equal((await request(`/public/articles?tagId=${tag.id}&recommended=true`)).items.some(article=>article.id===n.id),true);
      const renamedCategory=await put(`/system/entries/categories/${category.id}`,admin,{...category,name:`${prefix} 改名分类`});
      const renamedTag=await put(`/system/entries/tags/${tag.id}`,admin,{...tag,name:`${prefix} 改名标签`});
      live=await request(`/public/articles/${n.id}`);assert.equal(live.category,renamedCategory.name);assert.equal(live.tags[0].name,renamedTag.name);
      await request(`/system/entries/categories/${category.id}`,{token:admin,method:'DELETE',status:400});
      await request(`/system/entries/tags/${tag.id}`,{token:admin,method:'DELETE',status:400});
      await request(`/operations/files/${cover.id}`,{token:admin,method:'DELETE',status:400});
      const old=n;n=await put(`/content/notices/${n.id}`,admin,{...baseDraft,title:`${prefix} 新稿`,content:'<p>版本二</p>',version:n.version});
      assert.equal(n.revisionNumber,2);assert.equal(n.liveRevisionId,firstRevision);assert.equal(n.status,'DRAFT');assert.equal(n.published,true);
      assert.equal((await request(`/public/articles/${n.id}`)).content,'<p>版本一<strong>重点</strong></p>');
      assert.equal((await request(`/public/articles?keyword=${encodeURIComponent(`${prefix} 新稿`)}`)).total,0);
      assert.equal((await request(`/content/notices/${n.id}/revisions`,{token:admin})).length,2);
      await post(`/content/notices/${n.id}/publish`,admin,{version:old.version,revisionId:n.revisionId},409);
      n=await post(`/content/notices/${n.id}/publish`,admin,{version:n.version,revisionId:n.revisionId});
      assert.equal((await request(`/public/articles/${n.id}`)).content,'<p>版本二</p>');
      const published=await request(`/content/notices/${n.id}/publications`,{token:admin});assert.equal(published.total,2);assert.equal(published.items.filter(row=>!row.offlineAt).length,1);
      n=await put(`/content/notices/${n.id}`,admin,{...baseDraft,visibility:'INTERNAL',version:n.version});
      n=await post(`/content/notices/${n.id}/publish`,admin,{version:n.version,revisionId:n.revisionId});
      await request(`/public/articles/${n.id}`,{status:404});await request(`/public/articles/${n.id}/cover`,{status:404});await request(`/public/articles/${n.id}/files/${attachment.id}`,{status:404});
      await post(`/public/articles/${n.id}/view`,undefined,undefined,404);
      n=await post(`/content/notices/${n.id}/offline`,admin,{version:n.version});
      await request(`/content/notices/${n.id}`,{token:admin,method:'DELETE'});
      const deleted=(await request(`/content/notices/recycle?keyword=${prefix}`,{token:admin})).items.find(row=>row.id===n.id);
      n=await post(`/content/notices/${n.id}/restore`,admin,{version:deleted.version});assert.equal(n.status,'DRAFT');assert.equal(n.published,false);assert.equal(n.liveRevisionId,null);
      n=await put(`/content/notices/${n.id}`,admin,{...baseDraft,requiresApproval:true,version:n.version});
      await post(`/content/notices/${n.id}/publish`,admin,{version:n.version,revisionId:n.revisionId},400);
      await put(`/content/notices/${n.id}`,admin,{...baseDraft,coverId:attachment.id,version:n.version},400);
    });
    await t.test('内容排期持久保存、自动上线与下线；编辑新稿取消旧排期',async()=>{
      const category=(await request('/public/taxonomy')).categories[0];
      const input={title:`${prefix} 排期内容`,categoryId:category.id,content:'<p>排期正文</p>',contentFormat:'HTML',visibility:'PUBLIC'};
      let n=await post('/content/notices',admin,input);created.notices.push(n.id);
      const wall=milliseconds=>new Date(Date.now()+8*3600000+milliseconds).toISOString().slice(0,19);
      n=await post(`/content/notices/${n.id}/publish`,admin,{version:n.version,revisionId:n.revisionId,publishAt:wall(2000),offlineAt:wall(14000)});assert.equal(n.status,'SCHEDULED');
      await request(`/public/articles/${n.id}`,{status:404});
      const until=Date.now()+11000;let visible=false;
      while(Date.now()<until){const response=await fetch(`${base}/public/articles/${n.id}`);if(response.status===200){visible=true;break;}await new Promise(resolve=>setTimeout(resolve,700));}
      assert(visible,'定时器应在窗口内发布');
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,until+4000-Date.now())));
      await request(`/public/articles/${n.id}`,{status:404});
      // 公开入口按到期时间即时关闭；再等待异步工作器提交下线状态，避免与它合法地争用旧版本。
      const settled=Date.now()+9000;
      do { n=await request(`/content/notices/${n.id}`,{token:admin});if(n.status==='OFFLINE')break;await new Promise(resolve=>setTimeout(resolve,300)); } while(Date.now()<settled);
      assert.equal(n.status,'OFFLINE');
      n=await put(`/content/notices/${n.id}`,admin,{...input,version:n.version});
      n=await post(`/content/notices/${n.id}/publish`,admin,{version:n.version,revisionId:n.revisionId,publishAt:wall(60000)});
      n=await put(`/content/notices/${n.id}`,admin,{...input,content:'<p>更新正文</p>',version:n.version});assert.equal(n.scheduledPublishAt,null);assert.equal(n.status,'DRAFT');
    });
    await t.test('内容编辑可撰写独立草稿，发布权撤销后既有排期不能继续上线',async()=>{
      let role=await createRole('cms_publisher','SELF',['notices:view','notices:create','notices:update','notices:publish']);
      const actor=await createUser('cms_publisher',dept.id,role);const token=await login(actor.username);
      const category=(await request('/public/taxonomy')).categories[0];
      const input={title:`${prefix} 权限排期`,categoryId:category.id,content:'第一版',visibility:'PUBLIC'};
      let n=await post('/content/notices',token,input);created.notices.push(n.id);
      n=await post(`/content/notices/${n.id}/publish`,token,{version:n.version,revisionId:n.revisionId});
      role=await put(`/system/roles/${role.id}`,admin,{...role,permissions:role.permissions.filter(p=>p!=='notices:publish')});
      n=await put(`/content/notices/${n.id}`,token,{...input,content:'第二版',version:n.version});
      assert.equal((await request(`/public/articles/${n.id}`)).content,'<p>第一版</p>');
      await post(`/content/notices/${n.id}/publish`,token,{version:n.version,revisionId:n.revisionId},403);
      n=await post(`/content/notices/${n.id}/offline`,admin,{version:n.version});
      role=await put(`/system/roles/${role.id}`,admin,{...role,permissions:[...role.permissions,'notices:publish']});
      const publishAt=new Date(Date.now()+8*3600000+2000).toISOString().slice(0,19);
      n=await post(`/content/notices/${n.id}/publish`,token,{version:n.version,revisionId:n.revisionId,publishAt});
      await put(`/system/roles/${role.id}`,admin,{...role,permissions:role.permissions.filter(p=>p!=='notices:publish')});
      const deadline=Date.now()+9000;
      while(Date.now()<deadline){n=await request(`/content/notices/${n.id}`,{token:admin});if(n.scheduleError)break;await new Promise(resolve=>setTimeout(resolve,700));}
      assert.match(n.scheduleError??'',/权限已失效/);assert.equal(n.scheduledPublishAt,null);
      await request(`/public/articles/${n.id}`,{status:404});
    });
    await t.test('通知草稿、发布、收件隔离、阅读幂等、撤回及业务附件权限形成闭环',async()=>{
      const senderRole=await createRole('sender','DEPARTMENT',['users:view','messages:view','notifications:view','notifications:create','notifications:update','notifications:publish','notifications:withdraw','notifications:delete','files:view','files:create','files:download','files:delete']);
      const readerRole=await createRole('reader','SELF',['messages:view']);
      const sender=await createUser('sender',dept.id,senderRole);
      const reader=await createUser('reader',dept.id,readerRole);
      const other=await createUser('reader_outside',outsider.id,readerRole);
      const senderToken=await login(sender.username),readerToken=await login(reader.username),otherToken=await login(other.username);
      const input={title:`${prefix} 通知`,summary:'接口验收',content:'<p onclick="alert(1)">正文<strong>重点</strong><img src="https://invalid.example/x"><script>alert(1)</script></p>',type:'NOTICE',recipientType:'USERS',recipientIds:[reader.id],attachmentIds:[]};
      await post('/operations/notifications',readerToken,input,403);
      await post('/operations/notifications',senderToken,{...input,recipientIds:[other.id]},403);
      await post('/operations/notifications',senderToken,{...input,recipientType:'ALL',recipientIds:[]},403);
      const form=new FormData();form.append('file',new Blob(['notification-attachment-proof'],{type:'text/plain'}),`${prefix}.txt`);
      const upload=await fetch(`${base}/operations/files`,{method:'POST',headers:{Authorization:`Bearer ${senderToken}`},body:form});assert.equal(upload.status,200);
      const file=(await upload.json()).data;created.files.push(file.id);
      input.attachmentIds=[file.id];
      let record=await post('/operations/notifications',senderToken,input);created.notifications.push(record.id);
      assert.equal(record.status,'DRAFT');assert.equal(record.content,'<p>正文<strong>重点</strong></p>');
      assert.equal((await request(`/operations/messages?keyword=${prefix}`,{token:readerToken})).total,0);
      await request(`/operations/notifications/${record.id}`,{token:readerToken,status:403});
      await request(`/operations/files/${file.id}`,{token:senderToken,method:'DELETE',status:400});
      const old=record;record=await put(`/operations/notifications/${record.id}`,senderToken,{...input,title:`${prefix} 已修改`,version:record.version});
      await post(`/operations/notifications/${record.id}/publish`,senderToken,{version:old.version},409);
      record=await post(`/operations/notifications/${record.id}/publish`,senderToken,{version:record.version});
      assert.equal(record.recipientCount,1);assert.equal(record.status,'PUBLISHED');
      const repeated=await post(`/operations/notifications/${record.id}/publish`,senderToken,{version:old.version});assert.equal(repeated.recipientCount,1);
      await put(`/operations/notifications/${record.id}`,senderToken,{...input,version:record.version},400);
      await request(`/operations/notifications/${record.id}`,{token:senderToken,method:'DELETE',status:400});
      const inbox=await request(`/operations/messages?keyword=${prefix}`,{token:readerToken});assert.equal(inbox.total,1);
      const delivery=inbox.items[0];assert.equal('content' in delivery,false);
      assert.equal(await request('/operations/messages/unread',{token:readerToken}),1);
      await request(`/operations/messages/${delivery.id}`,{token:otherToken,status:403});
      await post(`/operations/messages/${delivery.id}/read`,otherToken,undefined,403);
      const detail=await request(`/operations/messages/${delivery.id}`,{token:readerToken});assert.equal(detail.content,record.content);assert.equal(detail.attachments[0].id,file.id);
      const download=()=>fetch(`${base}/operations/messages/${delivery.id}/attachments/${file.id}`,{headers:{Authorization:`Bearer ${readerToken}`}});
      let response=await download();assert.equal(response.status,200);assert.equal(await response.text(),'notification-attachment-proof');assert.equal(response.headers.get('cache-control'),'no-store');
      await request(`/operations/files/${file.id}/download`,{token:readerToken,status:403});
      await Promise.all([post(`/operations/messages/${delivery.id}/read`,readerToken),post(`/operations/messages/${delivery.id}/read`,readerToken)]);
      const readAt=(await request(`/operations/messages/${delivery.id}`,{token:readerToken})).delivery.readAt;assert(readAt);
      await post(`/operations/messages/${delivery.id}/read`,readerToken);assert.equal((await request(`/operations/messages/${delivery.id}`,{token:readerToken})).delivery.readAt,readAt);
      assert.equal(await request('/operations/messages/unread',{token:readerToken}),0);
      assert.equal((await request(`/operations/notifications/${record.id}`,{token:senderToken})).readCount,1);
      record=await post(`/operations/notifications/${record.id}/withdraw`,senderToken,{version:record.version});
      await post(`/operations/notifications/${record.id}/withdraw`,senderToken,{version:old.version});
      assert.equal((await request(`/operations/messages?keyword=${prefix}`,{token:readerToken})).total,0);
      await request(`/operations/messages/${delivery.id}`,{token:readerToken,status:403});
      response=await download();assert.equal(response.status,403);
      const copied=await post(`/operations/notifications/${record.id}/copy`,senderToken);created.notifications.push(copied.id);assert.equal(copied.status,'DRAFT');assert.equal(copied.recipientCount,0);assert.equal(copied.expiresAt,null);
      const outsiderManagerRole=await createRole('sender_other','SELF',['users:view','notifications:view','notifications:create']);
      const outsiderManager=await createUser('sender_other',outsider.id,outsiderManagerRole);const managerToken=await login(outsiderManager.username);
      assert.equal((await request(`/operations/notifications?keyword=${prefix}`,{token:managerToken})).total,0);
      await request(`/operations/notifications/${record.id}`,{token:managerToken,status:403});
      await post(`/operations/notifications/${record.id}/copy`,managerToken,undefined,403);
    });
    await t.test('通知按部门、角色、全部用户解析并冻结名单；到期正文附件和未读数同步关闭',async()=>{
      const readerRole=await createRole('audience_reader','SELF',['messages:view']);
      let one=await createUser('audience_one',child.id,readerRole);const two=await createUser('audience_two',child.id,readerRole);
      const oneToken=await login(one.username),twoToken=await login(two.username);
      const input={title:`${prefix} 接收范围`,summary:'',content:'<p>测试通知</p>',type:'REMINDER',recipientType:'DEPARTMENTS',recipientIds:[child.id],attachmentIds:[]};
      let byDept=await post('/operations/notifications',admin,input);created.notifications.push(byDept.id);
      byDept=await post(`/operations/notifications/${byDept.id}/publish`,admin,{version:byDept.version});
      assert.equal(byDept.recipientCount,3); // 原有测试账号 descendant，加本用例的两名成员。
      one=await put(`/system/users/${one.id}`,admin,{...one,departmentId:outsider.id});
      assert.equal((await request(`/operations/messages?keyword=${prefix}`,{token:oneToken})).total,1);
      let byRole=await post('/operations/notifications',admin,{...input,recipientType:'ROLES',recipientIds:[readerRole.id]});created.notifications.push(byRole.id);
      byRole=await post(`/operations/notifications/${byRole.id}/publish`,admin,{version:byRole.version});assert.equal(byRole.recipientCount,2);
      let all=await post('/operations/notifications',admin,{...input,recipientType:'ALL',recipientIds:[]});created.notifications.push(all.id);
      all=await post(`/operations/notifications/${all.id}/publish`,admin,{version:all.version});
      const enabled=(await request('/system/users?enabled=true&size=100',{token:admin})).total;assert.equal(all.recipientCount,enabled);
      assert.equal(await request('/operations/messages/unread',{token:twoToken}),3);
      assert.equal(await post('/operations/messages/read-all',twoToken),3);assert.equal(await post('/operations/messages/read-all',twoToken),0);
      assert.equal(await request('/operations/messages/unread',{token:twoToken}),0);assert.equal(await request('/operations/messages/unread',{token:oneToken}),3);
      // 应用统一使用 Asia/Shanghai。本地墙上时间必须显式转换，避免测试机时区影响过期断言。
      const expiresAt=new Date(Date.now()+8*3600000+4500).toISOString().slice(0,19);
      let expiring=await post('/operations/notifications',admin,{...input,recipientType:'USERS',recipientIds:[two.id],expiresAt});created.notifications.push(expiring.id);
      expiring=await post(`/operations/notifications/${expiring.id}/publish`,admin,{version:expiring.version});
      assert.equal(await request('/operations/messages/unread',{token:twoToken}),1);
      const delivery=(await request(`/operations/messages?keyword=${prefix}&read=false`,{token:twoToken})).items[0];
      await new Promise(resolve=>setTimeout(resolve,4700));
      assert.equal(await request('/operations/messages/unread',{token:twoToken}),0);
      await request(`/operations/messages/${delivery.id}`,{token:twoToken,status:403});
      assert.equal((await request(`/operations/notifications/${expiring.id}`,{token:admin})).status,'EXPIRED');
    });
  } finally {
    // 仅清理本次成功创建并登记的 ID。一个清理失败后仍继续清理其余记录，最后统一报告。
    // 内容只做软删除会残留作者/部门引用，必须先彻底清除测试内容，再清理其依赖对象。
    const cleanupErrors = [];
    const cleanup = async action => { try { await action(); } catch (error) { cleanupErrors.push(error); } };
    for(const id of created.notifications.reverse()) await cleanup(async()=>{
      const latest=await request(`/operations/notifications/${id}`,{token:admin});
      if(['PUBLISHED','EXPIRED'].includes(latest.status)) await post(`/operations/notifications/${id}/withdraw`,admin,{version:latest.version});
      await request(`/operations/notifications/${id}`,{token:admin,method:'DELETE'});
    });
    for(const item of created.dictionaryItems.reverse()) await cleanup(()=>request(`/system/dictionaries/${item.typeId}/items/${item.id}`,{token:admin,method:'DELETE'}));
    for(const id of created.dictionaries.reverse()) await cleanup(()=>request(`/system/entries/dictionaries/${id}`,{token:admin,method:'DELETE'}));
    for(const id of created.settings.reverse()) await cleanup(()=>request(`/system/entries/settings/${id}`,{token:admin,method:'DELETE'}));
    for (const id of created.notices.reverse()) await cleanup(async () => {
      await request(`/content/notices/${id}`, { token: admin, method: 'DELETE' });
      await request(`/content/notices/${id}/purge`, { token: admin, method: 'DELETE' });
    });
    for (const id of created.users.reverse()) await cleanup(() => request(`/system/users/${id}`, { token: admin, method: 'DELETE' }));
    for(const id of created.files.reverse()) await cleanup(()=>request(`/operations/files/${id}`,{token:admin,method:'DELETE'}));
    for(const id of created.tags.reverse()) await cleanup(()=>request(`/system/entries/tags/${id}`,{token:admin,method:'DELETE'}));
    for(const id of created.categories.reverse()) await cleanup(()=>request(`/system/entries/categories/${id}`,{token:admin,method:'DELETE'}));
    for (const id of created.posts.reverse()) await cleanup(() => request(`/system/entries/posts/${id}`, { token: admin, method: 'DELETE' }));
    for (const id of created.roles.reverse()) await cleanup(() => request(`/system/roles/${id}`, { token: admin, method: 'DELETE' }));
    for (const id of created.departments.reverse()) await cleanup(() => request(`/system/entries/departments/${id}`, { token: admin, method: 'DELETE' }));
    await cleanup(() => post('/auth/logout', admin));
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, '测试记录清理失败，请检查独立验证库');
  }
});


