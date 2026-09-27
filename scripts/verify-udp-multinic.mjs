/** 三张独立虚拟网卡、两个上游与一个下游的端到端验收。网络只在本机 Docker internal 内互通。 */
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id=Date.now().toString(),prefix='mayday-udp-nic-'+id;
const out=join(root,'.local','udp-multinic',id);mkdirSync(out,{recursive:true});
const target=join(root,'backend/mayday-netty/target');
const networks=[],containers=[],children=[];
const result={status:'running',startedAt:new Date().toISOString(),scope:'three isolated Docker internal networks, two upstream peers, one downstream peer',rounds:[]};
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,cwd:root,timeout:60000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function processIn(name,args,log){
  const profile=process.env.UDP_NIC_PROFILE==='1'&&args[args.indexOf('--role')+1]==='relay' ? ['--profile','true'] : [];
  const child=spawn('docker',['exec',name,'java','-cp','/work/test-classes:/work/classes:/work/dependency/*','com.mayday.netty.UdpMultiNicProbe',...args,...profile],{windowsHide:true,cwd:root,stdio:['ignore','pipe','pipe']});
  let text='';child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);
  const state={done:false,code:null};children.push(child);
  state.completion=new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>{state.done=true;state.code=code;writeFileSync(log,text);done(code);});});
  return state;
}
async function ready(file,process){
  for(let i=0;i<200;i++){if(existsSync(file))return;assert(!process.done,'测试进程提前退出，见对应日志');await delay(100);}
  throw new Error('等待测试进程超时');
}
try {
  for(let n=0;n<3;n++){const name=prefix+'-net'+n;docker(['network','create','--internal','--label','mayday.udp.validation='+id,name]);networks.push(name);}
  function hold(role,network){const name=prefix+'-'+role;
    docker(['run','--rm','-d','--name',name,'--network',network,'--mount',`type=bind,src=${target},dst=/work,readonly`,'--mount',`type=bind,src=${out},dst=/results`,'--entrypoint','sh','mayday-backend','-c','sleep 1200']);containers.push(name);return name;}
  const relay=hold('relay',networks[0]);docker(['network','connect',networks[1],relay]);docker(['network','connect',networks[2],relay]);
  const a=hold('source-a',networks[0]),b=hold('source-b',networks[1]),sink=hold('sink',networks[2]);
  const ips=name=>JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Networks}}',name]));
  const relayNics=ips(relay),sinkNics=ips(sink);
  result.addresses={receiveA:relayNics[networks[0]].IPAddress,receiveB:relayNics[networks[1]].IPAddress,send:relayNics[networks[2]].IPAddress,target:sinkNics[networks[2]].IPAddress};
  assert.equal(new Set(Object.values(relayNics).map(n=>n.IPAddress)).size,3);
  // 每一轮是新的 Java 进程，从首包开始计数，不预热、不跳过失败轮次。
  // 用户业务条件：100–1472 字节随机包长，200 Mbps；220 Mbps 作为额外压力。
  const cases=process.env.UDP_NIC_CASES?JSON.parse(process.env.UDP_NIC_CASES):[[1,'EPOLL',1472,200,100],[2,'NIO',1472,200,100],[3,'EPOLL',1472,220,100],[4,'NIO',1472,220,100],[5,'EPOLL',1472,200,100],[6,'EPOLL',1472,200,100,300]];
  const length=(seq,min,max)=>{if(min===max)return min;let v=(seq+0x9e3779b9)|0;v^=v>>>16;v=Math.imul(v,0x85ebca6b);v^=v>>>13;v=Math.imul(v,0xc2b2ae35);v^=v>>>16;return min+((v>>>0)%(max-min+1));};
  const plan=(offset,mbps,seconds,min,max)=>{let count=0,bytes=0;const budget=mbps*1e6/8*seconds;while(true){const n=length(offset+count,min,max);if(bytes+n>budget)break;bytes+=n;count++;assert(count<=20000000);}return {count,bytes};};
  for(const [index,mode,size,mbps,minSize=size,seconds=30] of cases) {
    const label='round-'+index,dir=join(out,label);mkdirSync(dir);
    const common=['--out','/results/'+label,'--seconds',String(seconds),'--size',String(size),'--min-size',String(minSize),'--max-size',String(size)];
    const planA=plan(0,mbps/2,seconds,minSize,size),planB=plan(planA.count,mbps/2,seconds,minSize,size);
    const count=planA.count,totalCount=count+planB.count;
    const receiver=processIn(sink,[...common,'--role','sink','--mbps',String(mbps),'--source',result.addresses.send,'--count',String(totalCount)],join(dir,'sink.log'));
    await ready(join(dir,'sink-ready'),receiver);
    const forwarding=processIn(relay,[...common,'--role','relay','--source',result.addresses.send,'--target',result.addresses.target,'--transport',mode],join(dir,'relay.log'));
    await ready(join(dir,'relay-ready'),forwarding);
    const startAt=Date.now()+5000;
    const sources=[processIn(a,[...common,'--role','source','--mbps',String(mbps/2),'--target',result.addresses.receiveA,'--offset','0','--start-at',String(startAt)],join(dir,'a.log')),
      processIn(b,[...common,'--role','source','--mbps',String(mbps/2),'--target',result.addresses.receiveB,'--offset',String(count),'--start-at',String(startAt)],join(dir,'b.log'))];
    const codes=await Promise.all(sources.map(p=>p.completion));
    await delay(2000);writeFileSync(join(dir,'relay-stop'),'stop');
    const relayCode=await forwarding.completion;
    writeFileSync(join(dir,'sink-stop'),'stop');const sinkCode=await receiver.completion;
    const load=name=>JSON.parse(readFileSync(join(dir,name),'utf8'));
    const round={index,mode,size,minSize,seconds,targetMbps:mbps,sourceA:load('source-0.json'),sourceB:load('source-'+count+'.json'),relay:load('relay.json'),sink:load('sink.json'),codes:[...codes,relayCode,sinkCode]};
    result.rounds.push(round);writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));
    assert(round.codes.every(c=>c===0),'进程验收失败，详见本轮结果');
    assert.equal(round.relay.receivedPackets,totalCount);assert.equal(round.relay.forwardedPackets,totalCount);assert.equal(round.sink.unique,totalCount);
    assert.equal(round.sink.bytes,planA.bytes+planB.bytes);assert.equal(round.relay.forwardedBytes,round.sink.bytes);
    assert.equal(round.sink.wrongSource,0);assert.equal(round.relay.transport,mode);
    assert.equal(round.relay.sendAddress,result.addresses.send+':19003');
    assert(round.sourceA.mbps+round.sourceB.mbps>=mbps*0.995);assert(round.sink.mbps>=mbps*0.995);
    console.log(`通过：三网卡第 ${index} 轮 ${mode}，${minSize}–${size} 字节，${totalCount} 包，${round.sink.mbps.toFixed(3)} Mbps，零缺失/错误，发送源正确。`);
  }
  result.status='passed';
} catch(error){result.status='failed';result.error=error.message;process.exitCode=1;console.error(error.message);}
finally {
  // 仅清理由本脚本明确创建、带唯一前缀的对象，不扫描或删除其他项目网络。
  for(const name of [...containers].reverse()){assert(name.startsWith(prefix+'-'));spawnSync('docker',['rm','-f',name],{windowsHide:true,stdio:'ignore'});}
  for(const name of [...networks].reverse()){assert(name.startsWith(prefix+'-'));spawnSync('docker',['network','rm',name],{windowsHide:true,stdio:'ignore'});}
  result.finishedAt=new Date().toISOString();writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('多网卡验收记录：'+out);
}
