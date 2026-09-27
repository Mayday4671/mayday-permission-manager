package com.mayday.netty;

import java.net.*;
import java.nio.*;
import java.nio.channels.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import java.util.concurrent.locks.LockSupport;

/**
 * 本机验收工具，固定回环地址，绝不向第三方打流。不是 HTTP 接口或默认启动任务。
 * 数据包第 9–16 字节为测试序号（不占业务指定的前 8 字节），对端逐包验证全部其他字节。
 * --external true 时由后台启动转发，本工具只做源端与接收端，可共享后台容器网络运行。
 */
public final class UdpRelayBenchmark {
  public static void main(String[] args) throws Exception {
    Map<String,String> options=new HashMap<>();for(int i=0;i<args.length;i+=2)options.put(args[i],args[i+1]);
    int seconds=Integer.parseInt(options.getOrDefault("--seconds","20"));
    int size=Integer.parseInt(options.getOrDefault("--size","1472"));
    int minSize=Integer.parseInt(options.getOrDefault("--min-size",String.valueOf(size)));
    int maxSize=Integer.parseInt(options.getOrDefault("--max-size",String.valueOf(size)));
    double mbps=Double.parseDouble(options.getOrDefault("--mbps","250"));
    boolean external=Boolean.parseBoolean(options.getOrDefault("--external","false"));
    int input=Integer.parseInt(options.getOrDefault("--input","19000"));
    int output=Integer.parseInt(options.getOrDefault("--output","19001"));
    if(seconds<1||seconds>600||size<16||size>65507||mbps<1||mbps>1000)throw new IllegalArgumentException("测试参数超出本机验收范围");
    var plan=ProbePacketPlan.create(0,mbps,seconds,minSize,maxSize);int count=plan.count();
    AtomicInteger arrived=new AtomicInteger(),corrupt=new AtomicInteger();AtomicLong lastReceived=new AtomicLong(),uniqueBytes=new AtomicLong();
    BitSet ids=new BitSet(count);AtomicInteger duplicate=new AtomicInteger(),outOfOrder=new AtomicInteger();
    AtomicReference<Throwable> receiverFailure=new AtomicReference<>();
    try(var sink=DatagramChannel.open(StandardProtocolFamily.INET);var source=DatagramChannel.open(StandardProtocolFamily.INET);var relay=new UdpRelay()) {
      sink.setOption(StandardSocketOptions.SO_RCVBUF,16*1024*1024).bind(new InetSocketAddress("127.0.0.1",output));
      source.setOption(StandardSocketOptions.SO_SNDBUF,16*1024*1024).connect(new InetSocketAddress("127.0.0.1",input));
      if(!external)relay.start(new RelayConfig("127.0.0.1",input,"127.0.0.1",output,16,16,64,"127.0.0.1",0,options.getOrDefault("--transport","AUTO")));
      Thread receiver=new Thread(() -> {
        ByteBuffer buffer=ByteBuffer.allocateDirect(65536);long previous=-1;
        try {
          while(sink.isOpen()) {
            buffer.clear();sink.receive(buffer);int length=buffer.position();long seq=length>=16?buffer.getLong(8):-1;
            boolean good=seq>=0&&seq<count&&length==ProbePacketPlan.length(seq,minSize,maxSize);
            if(good) for(int j=0;j<length;j++) {
              if(j>=8&&j<16)continue;
              byte expected=(byte)(j==2?3:j==3?1:j*31+7);
              if(buffer.get(j)!=expected) { good=false;break; }
            }
            if(!good)corrupt.incrementAndGet();
            else { if(ids.get((int)seq))duplicate.incrementAndGet();else uniqueBytes.addAndGet(length);ids.set((int)seq);if(seq<previous)outOfOrder.incrementAndGet();previous=seq; }
            lastReceived.set(System.nanoTime());arrived.incrementAndGet();
          }
        } catch(AsynchronousCloseException ignored) { }
        catch(Throwable error) { receiverFailure.set(error); }
      },"benchmark-sink");receiver.start();
      ByteBuffer packet=ByteBuffer.allocateDirect(maxSize);for(int j=0;j<maxSize;j++)packet.put((byte)(j*31+7));
      double interval=8*1000.0/mbps;long started=System.nanoTime(),sentBytes=0;
      for(int seq=0;seq<count;seq++) {
        int length=ProbePacketPlan.length(seq,minSize,maxSize);
        long due=started+(long)(sentBytes*interval),remaining;
        while((remaining=due-System.nanoTime())>0) { if(remaining>200_000)LockSupport.parkNanos(remaining-100_000);else Thread.onSpinWait(); }
        packet.clear().limit(length);packet.putLong(8,seq);if(source.write(packet)!=length)throw new IllegalStateException("测试发送端未完整写入");sentBytes+=length;
      }
      long sentAt=System.nanoTime();long deadline=sentAt+3_000_000_000L;
      while(arrived.get()<count&&System.nanoTime()<deadline&&receiverFailure.get()==null)Thread.sleep(10);
      if(!external)relay.stop();sink.close();receiver.join(5000);
      int unique=ids.cardinality();double actual=sentBytes*8.0/((sentAt-started)/1e9)/1e6;
      double delivered=uniqueBytes.get()*8.0/(Math.max(1,lastReceived.get()-started)/1e9)/1e6;
      System.out.printf(Locale.ROOT,"{\"sent\":%d,\"received\":%d,\"unique\":%d,\"missing\":%d,\"duplicate\":%d,\"corrupt\":%d,\"outOfOrder\":%d,\"packetBytes\":%d,\"minPacketBytes\":%d,\"maxPacketBytes\":%d,\"sentBytes\":%d,\"seconds\":%d,\"targetMbps\":%.3f,\"sendMbps\":%.3f,\"receiveMbps\":%.3f,\"transport\":\"%s\",\"relay\":%s}%n",
          count,arrived.get(),unique,count-unique,duplicate.get(),corrupt.get(),outOfOrder.get(),minSize==maxSize?minSize:0,minSize,maxSize,sentBytes,seconds,mbps,actual,delivered,external?"EXTERNAL":relay.snapshot().transport(),external?"null":UdpMultiNicProbe.json(relay.snapshot()));
      if(receiverFailure.get()!=null)throw new IllegalStateException("测试接收端异常",receiverFailure.get());
      if(unique!=count||duplicate.get()!=0||corrupt.get()!=0||actual<mbps*0.995||delivered<mbps*0.995)throw new IllegalStateException("未达到目标速率（0.5% 计时容差）、完整收包与精确字节替换验收条件");
      if(!external) {
        var s=relay.snapshot();
        if(s.receivedPackets()!=count||s.forwardedPackets()!=count||s.pendingPackets()!=0||s.invalidPackets()!=0
            ||s.overflowPackets()!=0||s.sendFailures()!=0||s.receiveErrors()!=0||(s.kernelDrops()!=null&&s.kernelDrops()!=0))
          throw new IllegalStateException("转发器计数与端点不一致");
      }
    }
  }
}
