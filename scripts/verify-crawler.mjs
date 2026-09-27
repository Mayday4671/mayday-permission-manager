/**
 * 图片采集隔离验收：随机命名的临时 MySQL、随机本机端口，导入唯一交付 SQL 后运行真实事务测试。
 * 外站响应由测试代码提供确定性夹具；不增加生产测试接口、不放开内网采集限制。
 */
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {verifyDatabaseComments} from './database-docs.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id=Date.now()+'-'+randomBytes(3).toString('hex');
const container='mayday-crawler-test-'+id;
const out=join(root,'.local','crawler-validation',id);mkdirSync(out,{recursive:true});
const password=randomBytes(24).toString('hex');
const result={status:'running',checks:[],startedAt:new Date().toISOString()};
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;}
const sql=input=>docker(['exec','-i',container,'sh','-c','MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -umayday_test mayday_crawler_test --default-character-set=utf8mb4 --batch --raw --skip-column-names'],input);
function mark(name){result.checks.push(name);console.log('通过：'+name);}
let created=false;
try{
  docker(['run','-d','--name',container,'-p','127.0.0.1::3306','-e','MYSQL_ROOT_PASSWORD='+password,'-e','MYSQL_DATABASE=mayday_crawler_test','-e','MYSQL_USER=mayday_test','-e','MYSQL_PASSWORD='+password,'mysql:8.4']);created=true;
  let ready=false;for(let i=0;i<90;i++){
    const r=spawnSync('docker',['exec',container,'sh','-c','MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h127.0.0.1 -umayday_test mayday_crawler_test -e "SELECT 1"'],{windowsHide:true,stdio:'ignore'});
    if(r.status===0){ready=true;break;}await delay(1000);
  }assert(ready,'临时数据库没有就绪');
  sql(readFileSync(join(root,'database/mayday.sql'),'utf8'));mark('唯一交付 SQL 在独立空库完整导入');
  const schema=verifyDatabaseComments(sql);result.schema={tables:schema.length,columns:schema.reduce((n,t)=>n+t.columns.length,0)};mark('表与字段的中文注释完整匹配');
  const port=docker(['port',container,'3306/tcp']).trim().split(':').at(-1);assert(/^\d+$/.test(port));
  const env={...process.env,CRAWLER_TEST_DB_PASSWORD:password,CRAWLER_TEST_DB_URL:`jdbc:mysql://127.0.0.1:${port}/mayday_crawler_test?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`};
  const command=process.platform==='win32'?'cmd.exe':'./mvnw';
  const args=['-B','-pl','mayday-application','-am','-Dtest=CrawlerIntegrationTest','-Dsurefire.failIfNoSpecifiedTests=false','test'];
  const r=spawnSync(command,process.platform==='win32'?['/d','/c','mvnw.cmd',...args]:args,{cwd:join(root,'backend'),env,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:16*1024*1024});
  writeFileSync(join(out,'integration.log'),(r.stdout??'')+(r.stderr??''));assert.equal(r.status,0,'集成测试失败，详见 '+join(out,'integration.log'));mark('真实 MySQL 双层分页、去重、停止恢复、失效租约、重试与权限回归');
  assert.equal(sql('SELECT COUNT(*) FROM crawl_task;').trim(),'0');assert.equal(sql('SELECT COUNT(*) FROM ops_file;').trim(),'0');mark('测试任务与图片完整清理');
  result.status='passed';
}catch(error){result.status='failed';result.error=error.message;console.error(error.message);process.exitCode=1;}
finally{
  if(created){assert(/^mayday-crawler-test-\d+-[a-f0-9]{6}$/.test(container));docker(['rm','-f','-v',container]);}
  result.finishedAt=new Date().toISOString();writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('采集验收记录：'+out);
}
