/** 在已通过的隔离副本中验证有业务数据时重启。专用记录保留到副本销毁，绝不连接日常 API。 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {loginWithCaptcha} from '../tests/support/captcha.mjs';
import {isDeepStrictEqual} from 'node:util';
const project=process.argv[2];assert(/^mayday-check-\d+-[a-f0-9]{6}$/.test(project??''));
const record=JSON.parse(readFileSync('.local/baseline/'+project.slice(13)+'/result.json','utf8'));
assert.equal(record.status,'passed');assert.equal(record.project,project);
const base='http://127.0.0.1:18081/api';
const password=readFileSync('.env','utf8').match(/^ADMIN_PASSWORD=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const suffix=Date.now().toString(36),prefix='persist_'+suffix;
async function api(path,token,method='GET',body){const r=await fetch(base+path,{method,headers:{Connection:'close','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,path+': '+data.message);return data.data;}
const login=async(username,secret)=>(await loginWithCaptcha(base,username,secret)).token;
const admin=await login('admin',password);
const role=await api('/system/roles',admin,'POST',{code:prefix,name:'重启验收角色',enabled:true,permissions:['dashboard:view','users:view','notices:view','notices:create','notices:update','requests:view','requests:create','messages:view'],dataScopes:{users:'SELF',notices:'SELF'}});
const user=await api('/system/users',admin,'POST',{username:prefix,nickname:'重启验收编辑',password:'Persistence_2026!',enabled:true,roleIds:[role.id]});
const editor=await login(prefix,'Persistence_2026!');
const category=(await api('/public/taxonomy')).categories[0];
const approvalCategory=(await api('/system/entries/approvalcategories',admin)).items[0];
const schema={fields:[{id:'memo',label:'说明',type:'TEXT',required:true,width:24}],nodes:[{id:'review',name:'审核',type:'APPROVAL',source:'USERS',assigneeIds:[1],mode:'ALL',next:'end',readable:['memo'],writable:[],actions:['APPROVE','REJECT','COMMENT'],conditions:[]},{id:'end',name:'结束',type:'END'}],startNodeId:'review',applicantType:'ALL',applicantIds:[],allowSelfApproval:false,allowRepeatApproval:false,allowWithdraw:true};
let definition=await api('/operations/workflows',admin,'POST',{name:'重启验收流程',code:prefix,categoryId:approvalCategory.id,businessType:'CONTENT',enabled:true,schema});
definition=await api('/operations/workflows/'+definition.id+'/publish',admin,'POST',{version:definition.version});
async function article(title,approval=true){return api('/content/notices',editor,'POST',{title:prefix+' '+title,categoryId:category.id,contentFormat:'HTML',content:'<p>重启后应保留的内容</p>',requiresApproval:approval});}
async function submit(content){return api('/operations/requests',editor,'POST',{definitionId:definition.id,versionId:definition.publishedVersionId,title:content.title,values:{memo:'重启验收'},businessId:content.id,businessRevisionId:content.revisionId,businessVersion:content.version});}
let live=await article('已完成内容');const done=await submit(live);
const action=await api('/operations/requests/'+done.id,admin);
await api('/operations/requests/'+done.id+'/decision',admin,'POST',{version:action.version,taskId:action.myTaskId,action:'APPROVE',comment:'同意'});
live=await api('/content/notices/'+live.id,editor);
live=await api('/content/notices/'+live.id+'/publish',admin,'POST',{version:live.version,revisionId:live.revisionId});
const pendingArticle=await article('待审内容');const pending=await submit(pendingArticle);
let scheduled=await article('排期内容',false);
scheduled=await api('/content/notices/'+scheduled.id+'/publish',admin,'POST',{version:scheduled.version,revisionId:scheduled.revisionId,publishAt:new Date(Date.now()+32*3600000).toISOString().slice(0,19)});
const deadline=Date.now()+12000;
let inbox;
do{inbox=await api('/operations/messages?keyword='+prefix,editor);if(inbox.total>0)break;await new Promise(r=>setTimeout(r,300));}while(Date.now()<deadline);
assert(inbox.total>0);const messageId=inbox.items[0].id;await api('/operations/messages/'+messageId+'/read',editor,'POST');
async function snapshot(){return {
  completed:await api('/operations/requests/'+done.id,editor),pending:await api('/operations/requests/'+pending.id,editor),
  versions:await api('/operations/workflows/'+definition.id+'/versions',admin),
  publication:await api('/content/notices/'+live.id+'/publications',admin),article:await api('/public/articles/'+live.id),
  schedule:await api('/content/notices/'+scheduled.id,admin),message:await api('/operations/messages/'+messageId,editor)
};}
const before=await snapshot();
const env={...process.env,VERIFY_DB_PASSWORD:'unused-restart-value',VERIFY_ADMIN_PASSWORD:'unused-restart-value'};
const compose=['compose','-p',project,'-f','compose.verify.yaml'];
mkdirSync('.local/persistence',{recursive:true});
for(const args of [['restart','backend-upgrade'],['start','--wait','--wait-timeout','180','backend-upgrade']]){
 const run=spawnSync('docker',[...compose,...args],{encoding:'utf8',env,windowsHide:true,timeout:210000});
 writeFileSync('.local/persistence/restart.log',(run.stdout??'')+(run.stderr??''));assert.equal(run.status,0);
}
// Java Set 的 JSON 顺序在不同进程间不保证一致；只规范集合字段，保留表单、节点、任务和历史的顺序。
function canonical(value,key='') {
 if(Array.isArray(value)){const next=value.map(v=>canonical(v));return ['actions','readable','writable','applicantIds','tagIds','attachmentIds'].includes(key)?next.sort((a,b)=>String(a).localeCompare(String(b))):next;}
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonical(v,k)]));return value;
}
const after=await snapshot();
writeFileSync('.local/persistence/before.json',JSON.stringify(before,null,2));writeFileSync('.local/persistence/after.json',JSON.stringify(after,null,2));
assert(isDeepStrictEqual(canonical(after),canonical(before)),'重启改变了业务记录，见 .local/persistence 前后快照');
const result={status:'passed',project,finishedAt:new Date().toISOString(),checks:['完成/待审申请与历史保持','流程版本保持','通知阅读状态保持','排期保持','线上文章与发布记录保持'],fixture:{username:prefix,userId:user.id,roleId:role.id,definitionId:definition.id,requestIds:[done.id,pending.id],articleIds:[live.id,pendingArticle.id,scheduled.id]}};
writeFileSync('.local/persistence/result.json',JSON.stringify(result,null,2));console.log('通过：有业务数据的重启一致性；记录 .local/persistence/result.json');
