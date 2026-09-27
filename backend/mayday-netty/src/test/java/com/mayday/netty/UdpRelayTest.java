package com.mayday.netty;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import java.net.*;
import java.util.*;

class UdpRelayTest {
  static int freePort() throws Exception { try(var socket=new DatagramSocket(0,InetAddress.getLoopbackAddress())) { return socket.getLocalPort(); } }
  static RelayConfig config(int bind,int target) { return new RelayConfig("127.0.0.1",bind,"127.0.0.1",target,4,4,16); }
  @Test void exactVersionAndConfigBoundaries() throws Exception {
    io.netty.util.Version.identify().values().forEach(v -> assertEquals("4.1.105.Final",v.artifactVersion()));
    assertThrows(IllegalArgumentException.class,()->config(19000,19000));
    assertThrows(IllegalArgumentException.class,()->new RelayConfig("127.0.0.1",19000,"0.0.0.0",19001,4,4,16));
    assertThrows(IllegalArgumentException.class,()->new RelayConfig("https://host/",19000,"127.0.0.1",19001,4,4,16));
    assertThrows(IllegalArgumentException.class,()->new RelayConfig("127.0.0.1",19000,"224.0.0.1",19001,4,4,16));
    assertThrows(IllegalArgumentException.class,()->new RelayConfig("127.0.0.1",19000,"127.0.0.1",19001,4,4,1000));
  }
  @Test void patchesOnlyThirdAndFourthBytesAndNeverTruncatesLargeDatagrams() throws Exception {
    try(var sink=new DatagramSocket(0,InetAddress.getLoopbackAddress());var sender=new DatagramSocket();var relay=new UdpRelay()) {
      sink.setSoTimeout(5000);sink.setReceiveBufferSize(4*1024*1024);
      int port=freePort();var cfg=config(port,sink.getLocalPort());relay.start(cfg);
      assertThrows(IllegalStateException.class,()->relay.start(cfg));
      sender.send(new DatagramPacket(new byte[7],7,InetAddress.getLoopbackAddress(),port));
      long bytes=7;
      for(int size:new int[]{8,1472,65507}) {
        byte[] payload=new byte[size];new Random(size).nextBytes(payload);bytes+=size;
        sender.send(new DatagramPacket(payload,size,InetAddress.getLoopbackAddress(),port));
        var packet=new DatagramPacket(new byte[65536],65536);sink.receive(packet);
        payload[2]=3;payload[3]=1;
        assertEquals(size,packet.getLength());assertArrayEquals(payload,Arrays.copyOf(packet.getData(),packet.getLength()));
      }
      var result=relay.stop();
      assertEquals("STOPPED",result.state());assertEquals(4,result.receivedPackets());assertEquals(3,result.forwardedPackets());
      assertEquals(bytes,result.receivedBytes());assertEquals(bytes-7,result.forwardedBytes());
      assertEquals(1,result.invalidPackets());assertEquals(0,result.pendingPackets());assertEquals(0,result.sendFailures());
      assertEquals(result.receivedPackets(),result.forwardedPackets()+result.invalidPackets()+result.overflowPackets()+result.sendFailures());
      String run=result.runId();relay.start(cfg);assertNotEquals(run,relay.snapshot().runId());assertEquals(0,relay.snapshot().receivedPackets());
    }
  }
  @Test void occupiedPortFailsAndResourcesCanBeStartedAgain() throws Exception {
    int port;
    try(var relay=new UdpRelay()) {
      try(var occupied=new DatagramSocket(0,InetAddress.getLoopbackAddress())) {
        port=occupied.getLocalPort();
        assertThrows(IllegalStateException.class,()->relay.start(config(port,freePort())));
        assertEquals("FAILED",relay.snapshot().state());
      }
      relay.start(config(port,freePort()));assertEquals("RUNNING",relay.snapshot().state());
      relay.stop();relay.stop();assertEquals("STOPPED",relay.snapshot().state());
    }
  }
  @Test void separateSourceBindingAndReceiveFromMultiplePeersOnBothTransports() throws Exception {
    assertTrue(LocalInterfaces.list().stream().anyMatch(n -> n.ip().equals("127.0.0.1") && n.up()));
    for(String mode:io.netty.channel.epoll.Epoll.isAvailable()?new String[]{"NIO","EPOLL"}:new String[]{"NIO"}) {
      try(var sink=new DatagramSocket(0,InetAddress.getLoopbackAddress());var senderA=new DatagramSocket();var senderB=new DatagramSocket();var relay=new UdpRelay()) {
        sink.setSoTimeout(5000);int port=freePort(),sourcePort=freePort();
        var config=new RelayConfig("0.0.0.0",port,"127.0.0.1",sink.getLocalPort(),4,4,16,"127.0.0.1",sourcePort,mode);
        relay.start(config);
        // 接收端没有 connect 到转发目标，不会过滤掉两个不同上游来源端口。
        for(var sender:List.of(senderA,senderB)) {
          byte[] bytes=new byte[523];new Random(sender.getLocalPort()).nextBytes(bytes);
          sender.send(new DatagramPacket(bytes,bytes.length,InetAddress.getLoopbackAddress(),port));
          var packet=new DatagramPacket(new byte[1024],1024);sink.receive(packet);bytes[2]=3;bytes[3]=1;
          assertArrayEquals(bytes,Arrays.copyOf(packet.getData(),packet.getLength()));
          assertEquals(sourcePort,packet.getPort());assertEquals("127.0.0.1",packet.getAddress().getHostAddress());
        }
        var result=relay.stop();assertEquals(mode,result.transport());assertEquals(2,result.forwardedPackets());
        assertEquals("127.0.0.1:"+sourcePort,result.sendAddress());assertFalse(result.lastSender().isEmpty());
      }
    }
    assertThrows(IllegalArgumentException.class,()->new RelayConfig("0.0.0.0",19000,"127.0.0.1",19001,4,4,16,"203.0.113.1",0,"AUTO"));
    assertThrows(IllegalArgumentException.class,()->new RelayConfig("0.0.0.0",19000,"127.0.0.1",19001,4,4,16,"127.0.0.1",19000,"AUTO"));
  }
}
