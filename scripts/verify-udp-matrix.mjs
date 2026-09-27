/** 多轮全新 JVM 打流，所有尝试均记录，不在成功后删除失败样本。仅本机回环；长测放在三网卡脚本中。 */
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id=Date.now().toString(),out=join(root,'.local','udp-matrix',id);mkdirSync(out,{recursive:true});
const target=join(root,'backend/mayday-netty/target');
const results={status:'running',startedAt:new Date().toISOString(),rounds:[]};
const cases=[
  ...Array.from({length:3},(_,i)=>({platform:'linux',mode:'EPOLL',minSize:100,size:1472,mbps:i===1?220:200,seconds:30})),
  ...Array.from({length:3},(_,i)=>({platform:'linux',mode:'NIO',minSize:100,size:1472,mbps:i===1?220:200,seconds:30})),
  ...Array.from({length:3},(_,i)=>({platform:'windows',mode:'NIO',minSize:100,size:1472,mbps:i===1?220:200,seconds:30})),
];
function run(command,args) {return new Promise(resolve=>{
  const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  child.once('error',e=>resolve({code:-1,output:output+e.message}));child.once('close',code=>resolve({code,output}));
});}
try {
  for(const [index,item] of cases.entries()) {
    const parameters=['com.mayday.netty.UdpRelayBenchmark','--seconds',String(item.seconds),'--size',String(item.size),'--min-size',String(item.minSize),'--max-size',String(item.size),'--mbps',String(item.mbps),'--transport',item.mode,'--input','19010','--output','19011'];
    let command,args;
    if(item.platform==='linux') {
      command='docker';args=['run','--rm','--name',`mayday-udp-matrix-${id}-${index}`,'--network','none','--mount',`type=bind,src=${target},dst=/work,readonly`,'--entrypoint','java','mayday-backend','-cp','/work/test-classes:/work/classes:/work/dependency/*',...parameters];
    }else {
      command=join(process.env.JAVA_HOME||'D:/Soft/JDK21','bin/java.exe');args=['-cp',`${target}/test-classes;${target}/classes;${target}/dependency/*`,...parameters];
    }
    const started=Date.now(),response=await run(command,args);
    writeFileSync(join(out,`round-${index+1}.log`),response.output);
    let benchmark;try{benchmark=JSON.parse(response.output.split(/\r?\n/).find(line=>line.startsWith('{')));}catch{}
    results.rounds.push({...item,index:index+1,startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),code:response.code,benchmark});
    writeFileSync(join(out,'result.json'),JSON.stringify(results,null,2));
    console.log(`${response.code===0?'通过':'失败'}：第 ${index+1} 轮 ${item.platform}/${item.mode}，${item.minSize}–${item.size} 字节，${item.seconds} 秒，${benchmark?.receiveMbps??'未知'} Mbps，缺包 ${benchmark?.missing??'未知'}。`);
  }
  results.status=results.rounds.every(r=>r.code===0)?'passed':'failed';
  if(results.status!=='passed')process.exitCode=1;
}catch(error){results.status='failed';results.error=error.message;process.exitCode=1;}
finally {results.finishedAt=new Date().toISOString();writeFileSync(join(out,'result.json'),JSON.stringify(results,null,2)+'\n');console.log('持续打流记录：'+out);}
