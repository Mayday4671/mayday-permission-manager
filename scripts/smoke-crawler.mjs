/** 公开采集演示站的真实网络冒烟；最多 2 列表、2 详情、5 图片，结束清理本次任务及其文件。 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {loginWithCaptcha} from '../tests/support/captcha.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.API_BASE??'http://127.0.0.1:18080/api';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'仅测试本机服务');
const settings=Object.fromEntries(readFileSync(join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).trim().replace(/^(["'])(.*)\1$/,'$2')];}));
const out=join(root,'.local','crawler-network',Date.now().toString());mkdirSync(out,{recursive:true});
const result={status:'running',site:'https://books.toscrape.com/',checks:[]};
const token=(await loginWithCaptcha(base,'admin',settings.ADMIN_PASSWORD)).token;
async function api(path,method='GET',data){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.data;}
let task;const files=new Set();
try{
  const page={mode:'NEXT',format:'HTML',selector:'.next a',template:'',start:1,step:1,maxPages:2,nextPointer:'',detailsPointer:'',imagesPointer:'',urlPointer:''};
  const rules={entryUrl:result.site,enterDetails:true,list:page,detail:{...page,mode:'SINGLE',maxPages:1},detailSelector:'h3 a',imageSelector:'img',imageAttributes:['src'],imageHosts:[],maxDetails:2,maxImages:5,intervalMs:1000,
    article:{enabled:true,title:'.product_main h1',content:'#product_description + p',author:'',publishedAt:''}};
  const preview=await api('/crawler/tasks/preview','POST',rules);assert(preview.details.length>0 && preview.pages.length>0);result.checks.push('真实列表解析出详情与下一页地址');
  task=await api('/crawler/tasks','POST',{name:'采集网络验收 '+Date.now(),rules});
  await api(`/crawler/tasks/${task.id}/start`,'POST',{version:task.version});
  for(let i=0;i<75;i++){await delay(2000);task=await api('/crawler/tasks/'+task.id);if(!['QUEUED','RUNNING'].includes(task.status))break;}
  const items=(await api(`/crawler/tasks/${task.id}/items?size=100`)).items;
  items.filter(i=>i.fileId).forEach(i=>files.add(i.fileId));
  result.task={status:task.status,pageCount:task.pageCount,imageCount:task.imageCount,failedCount:task.failedCount,totalBytes:task.totalBytes};
  result.errors=items.filter(i=>i.error).map(i=>({url:i.url,error:i.error}));
  // 网站详情还可能包含站点装饰图片；img 规则应保留所有匹配结果，只断言至少两张且不超过配置上限。
  assert.equal(task.status,'COMPLETED');assert.equal(task.pageCount,4);assert(task.imageCount>=2 && task.imageCount<=5);assert.equal(task.failedCount,0);result.checks.push('列表翻页、进入详情并将匹配的不同图片保存到 MySQL');
  const articles=await api(`/crawler/tasks/${task.id}/articles`);assert.equal(articles.total,2);
  result.articles=[];
  for(const article of articles.items){
    const detail=await api(`/crawler/tasks/${task.id}/articles/${article.id}`);
    assert(article.title && article.coverItemId);assert.equal(article.pageCount,1);assert(detail.pages[0].body.length>20);assert(detail.images.length>0);
    assert.equal(detail.truncated,false);result.articles.push({title:article.title,bodyCharacters:detail.pages[0].body.length,imageCount:detail.images.length});
  }
  result.checks.push('两篇文章卡片、准确正文选择器与配图关联通过');
  result.images=items.filter(i=>i.fileId).map(i=>({url:i.url,bytes:i.bytes}));
  for(const item of items.filter(i=>i.fileId)){
    const response=await fetch(`${base}/crawler/tasks/${task.id}/items/${item.id}/image?download=true`,{headers:{Authorization:'Bearer '+token}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\//);assert.equal((await response.arrayBuffer()).byteLength,item.bytes);
  }result.checks.push('鉴权下载字节数与入库记录一致');result.status='passed';
}catch(error){result.status='failed';result.error=error.message;process.exitCode=1;}
finally{
  if(task){task=await api('/crawler/tasks/'+task.id);if(['QUEUED','RUNNING'].includes(task.status))await api(`/crawler/tasks/${task.id}/stop`,'POST',{version:task.version});
    (await api(`/crawler/tasks/${task.id}/items?size=100`)).items.filter(i=>i.fileId).forEach(i=>files.add(i.fileId));await api('/crawler/tasks/'+task.id,'DELETE');}
  for(const id of files)await api('/operations/files/'+id,'DELETE');
  result.checks.push('本次临时任务和采集图片已清理');writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));console.log('网络采集验收：'+out);
}
