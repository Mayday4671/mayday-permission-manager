/** 真实 HTTP 验收：新模块必须经过统一登录、授权、任务归属及参数验证，不执行第三方采集。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loginWithCaptcha} from './support/captcha.mjs';
const base=process.env.API_BASE??'http://127.0.0.1:18080/api';
const prefix='crawl_'+Date.now().toString(36),password='CrawlerQa_2026!';
const page={mode:'SINGLE',format:'HTML',selector:'a.next',template:'{url}?page={page}',start:1,step:1,maxPages:3,nextPointer:'/next',detailsPointer:'/items',imagesPointer:'/images',urlPointer:'/url'};
const rules={entryUrl:'https://example.com/gallery',enterDetails:true,list:page,detail:page,detailSelector:'a.detail',imageSelector:'article img',imageAttributes:['data-src','src'],imageHosts:[],maxDetails:10,maxImages:20,intervalMs:1000};
async function request(path,token,method='GET',data,status=200){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const body=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(body)}`);return body.data;
}
test('图片采集接口权限与规则校验',async t=>{
  const admin=(await loginWithCaptcha(base,'admin',process.env.ADMIN_PASSWORD??'Mayday@2026')).token;
  const created={tasks:[],users:[],roles:[]};
  const perms=['crawler:view','crawler:create','crawler:update','crawler:delete','crawler:run','crawler:stop','crawler:download'];
  const role=async(name,permissions)=>{const r=await request('/system/roles',admin,'POST',{name,code:prefix+name,permissions,enabled:true,dataScopes:{}});created.roles.push(r.id);return r;};
  const user=async(name,r)=>{const u=await request('/system/users',admin,'POST',{username:prefix+name,nickname:name,password,enabled:true,roleIds:[r.id]});created.users.push(u.id);return (await loginWithCaptcha(base,u.username,password)).token;};
  try{
    const r=await role('operator',perms);const owner=await user('owner',r),outsider=await user('other',r);
    const view=await user('viewer',await role('read',['crawler:view']));
    let task=await request('/crawler/tasks',owner,'POST',{name:prefix,rules});created.tasks.push(task.id);
    await t.test('匿名拒绝访问',()=>request('/crawler/tasks',null,'GET',undefined,401));
    await t.test('默认跨任务卡片入口需要登录且遵循当前所有者权限',async()=>{
      await request('/crawler/tasks/articles',null,'GET',undefined,401);
      const cards=await request('/crawler/tasks/articles',outsider);assert.equal(cards.total,0);assert.deepEqual(cards.items,[]);
    });
    await t.test('普通账号只看到自己的任务',async()=>{
      assert((await request('/crawler/tasks',owner)).items.some(x=>x.id===task.id));assert.equal((await request('/crawler/tasks',outsider)).total,0);
      await request('/crawler/tasks/'+task.id,outsider,'GET',undefined,403);
      await request(`/crawler/tasks/${task.id}/items`,outsider,'GET',undefined,403);
      await request(`/crawler/tasks/${task.id}/articles`,outsider,'GET',undefined,403);
      await request(`/crawler/tasks/${task.id}/articles/1`,outsider,'GET',undefined,403);
      await request('/crawler/tasks/'+task.id,outsider,'DELETE',undefined,403);
    });
    await t.test('只读权限不能创建或预览访问外站',async()=>{
      await request('/crawler/tasks',view,'POST',{name:'无权',rules},403);
      await request('/crawler/tasks/preview',view,'POST',rules,403);
    });
    await t.test('运行还必须拥有文件上传权限',()=>request(`/crawler/tasks/${task.id}/start`,owner,'POST',{version:task.version},403));
    await t.test('编辑版本冲突和隐藏执行租约字段',async()=>{
      const old=task;task=await request('/crawler/tasks/'+task.id,owner,'PUT',{...task,name:prefix+'updated'});
      assert.equal('leaseToken' in task,false);assert.equal('rulesJson' in task,false);assert.deepEqual(task.rules,rules);
      await request('/crawler/tasks/'+task.id,owner,'PUT',{...old,name:'过期'},409);
    });
    await t.test('关闭进入详情后可以保存尚未填完的详情规则',async()=>{
      task=await request('/crawler/tasks/'+task.id,owner,'PUT',{...task,rules:{...rules,enterDetails:false,detail:{...page,mode:'CURSOR',format:'HTML',template:''}}});
      assert.equal(task.rules.enterDetails,false);
    });
    await t.test('拒绝本机入口、自定义端口和登录凭证 URL',async()=>{
      for(const url of ['http://localhost/a','http://example.com:8080/a','https://user:pass@example.com/a'])
        await request('/crawler/tasks',owner,'POST',{name:'非法',rules:{...rules,entryUrl:url}},400);
    });
    await t.test('拒绝内网地址的真实网络预览',()=>request('/crawler/tasks/preview',owner,'POST',{...rules,entryUrl:'http://127.0.0.1/'},400));
    await t.test('拒绝超限参数和脚本协议图片域名',async()=>{
      for(const extra of [{maxImages:501},{intervalMs:0},{imageHosts:['*.example.com']},{list:{...page,mode:'CURSOR',format:'HTML'}}])
        await request('/crawler/tasks',owner,'POST',{name:'非法',rules:{...rules,...extra}},400);
    });
    await t.test('未采集图片不可通过猜测 ID 下载',()=>request(`/crawler/tasks/${task.id}/items/999999/image`,owner,'GET',undefined,400));
    await t.test('文章结果受任务隔离，空任务不暴露其他任务文章',async()=>{
      assert.equal((await request(`/crawler/tasks/${task.id}/articles`,owner)).total,0);
      await request(`/crawler/tasks/${task.id}/articles/999999`,owner,'GET',undefined,400);
    });
    await t.test('撤销查看权限后已有会话即时失效',async()=>{
      await request('/system/roles/'+r.id,admin,'PUT',{...r,permissions:[]});
      await request('/crawler/tasks/'+task.id,owner,'GET',undefined,403);
    });
  }finally{
    for(const id of created.tasks.reverse())await request('/crawler/tasks/'+id,admin,'DELETE');
    for(const id of created.users.reverse())await request('/system/users/'+id,admin,'DELETE');
    for(const id of created.roles.reverse())await request('/system/roles/'+id,admin,'DELETE');
  }
});
