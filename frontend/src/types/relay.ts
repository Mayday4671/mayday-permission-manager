/** 配置值持久保存，运行快照独立；所有计数来自 Java，不在浏览器推算收发成功数。 */
export interface RelayConfig {
  id: number;
  version: number;
  bindIp: string;
  bindPort: number;
  targetIp: string;
  targetPort: number;
  receiveBufferMiB: number;
  sendBufferMiB: number;
  pendingMemoryMiB: number;
  sendIp: string;
  sendPort: number;
  transportMode: "AUTO" | "NIO" | "EPOLL";
}
export interface RelayInterface {
  name: string;
  displayName: string;
  ip: string;
  prefixLength: number;
  mtu: number;
  up: boolean;
  loopback: boolean;
}
export interface RelayStats {
  runId: string;
  state: "STOPPED" | "RUNNING" | "FAILED";
  transport: string;
  startedAt: string | null;
  sampledAt: string;
  receivedPackets: number;
  forwardedPackets: number;
  receivedBytes: number;
  forwardedBytes: number;
  pendingPackets: number;
  pendingBytes: number;
  invalidPackets: number;
  overflowPackets: number;
  sendFailures: number;
  receiveErrors: number;
  kernelDrops: number | null;
  receiveMbps: number;
  forwardMbps: number;
  receivePps: number;
  forwardPps: number;
  peakForwardMbps: number;
  actualReceiveBuffer: number;
  actualSendBuffer: number;
  lastError: string;
  boundAddress: string;
  sendAddress: string;
  lastSender: string;
}
