package com.mayday.netty;

/**
 * 可复现的变长包计划，仅供打流工具使用。序号决定长度，因此两端可独立校验，不能靠接收端回显来判定。
 * 速率预算按实际 UDP 字节累计；不同长度不能仍用固定 PPS 计时。前八字节保持业务协议约定。
 */
record ProbePacketPlan(int offset,int count,long bytes,int minSize,int maxSize) {
  static int length(long sequence,int min,int max) {
    if(min==max)return min;
    int value=(int)sequence+0x9e3779b9;
    value^=value>>>16;value*=0x85ebca6b;value^=value>>>13;value*=0xc2b2ae35;value^=value>>>16;
    return min+(int)(Integer.toUnsignedLong(value)%(max-min+1));
  }
  static ProbePacketPlan create(int offset,double mbps,int seconds,int min,int max) {
    if(offset<0||min<16||max>65507||min>max||mbps<1||mbps>1000||seconds<1||seconds>600)
      throw new IllegalArgumentException("变长测试范围无效");
    long budget=(long)(mbps*1e6/8*seconds),bytes=0;int count=0;
    while(true) {
      int next=length((long)offset+count,min,max);
      if(bytes+next>budget)break;
      bytes+=next;count++;
      if(count>20_000_000||offset+(long)count>Integer.MAX_VALUE)throw new IllegalArgumentException("单轮序号范围过大");
    }
    return new ProbePacketPlan(offset,count,bytes,min,max);
  }
}
