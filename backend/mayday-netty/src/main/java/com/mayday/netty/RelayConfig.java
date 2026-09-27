package com.mayday.netty;

import io.netty.util.NetUtil;

import java.net.*;

/**
 * 单路单目标 UDP 配置。缓冲区是申请值，系统实际授予值从运行快照读取；不假定申请必定生效。
 */
public record RelayConfig(String bindIp, int bindPort, String targetIp, int targetPort,
                          int receiveBufferMiB, int sendBufferMiB, int pendingMemoryMiB,
                          String sendIp, int sendPort, String transportMode) {
    /**
     * 兼容已有七参数接入；接收 IP 与发送源 IP 独立，空源 IP 由操作系统选择。
     */
    public RelayConfig(String bindIp, int bindPort, String targetIp, int targetPort,
                       int receiveBufferMiB, int sendBufferMiB, int pendingMemoryMiB) {
        this(bindIp, bindPort, targetIp, targetPort, receiveBufferMiB, sendBufferMiB, pendingMemoryMiB, "", 0, "AUTO");
    }

    public RelayConfig {
        sendIp = sendIp == null ? "" : sendIp.trim();
        transportMode = transportMode == null ? "AUTO" : transportMode.toUpperCase(java.util.Locale.ROOT);
        if (!java.util.Set.of("AUTO", "NIO", "EPOLL").contains(transportMode))
            throw new IllegalArgumentException("传输模式仅支持 AUTO、NIO、EPOLL");
        ip(bindIp);
        ip(targetIp);
        if (!sendIp.isEmpty()) ip(sendIp);
        if (bindPort < 1024 || bindPort > 65535 || targetPort < 1 || targetPort > 65535
                || (sendPort != 0 && (sendPort < 1024 || sendPort > 65535)))
            throw new IllegalArgumentException("接收端口需为 1024–65535；目标 1–65535；发送源端口为 0（自动）或 1024–65535");
        if (receiveBufferMiB < 1 || receiveBufferMiB > 64 || sendBufferMiB < 1 || sendBufferMiB > 64
                || pendingMemoryMiB < 1 || pendingMemoryMiB > 256)
            throw new IllegalArgumentException("收发缓冲需为 1–64 MiB，待发送内存需为 1–256 MiB");
        InetAddress bind = address(bindIp), target = address(targetIp);
        if (bind.isMulticastAddress() || target.isMulticastAddress() || target.isAnyLocalAddress()
                || targetIp.equals("255.255.255.255"))
            throw new IllegalArgumentException("仅支持单播目标，目标不能为通配、广播或组播地址");
        if (bind.getAddress().length != target.getAddress().length)
            throw new IllegalArgumentException("接收地址和目标地址需使用相同的 IPv4 或 IPv6 地址族");
        try {
            local(bind, true);
            if (!sendIp.isEmpty()) {
                InetAddress source = address(sendIp);
                local(source, false);
                if (source.getAddress().length != target.getAddress().length)
                    throw new IllegalArgumentException("发送源 IP 与目标需使用相同地址族");
            }
            if (bindPort == targetPort && (target.isLoopbackAddress() || NetworkInterface.getByInetAddress(target) != null))
                throw new IllegalArgumentException("目标不能回到本机同一接收端口，避免转发循环");
            if (sendPort == bindPort && (bind.isAnyLocalAddress() || sendIp.isEmpty() || bind.equals(address(sendIp))))
                throw new IllegalArgumentException("接收与发送通道不能占用相同的本地地址和端口");
        } catch (SocketException e) {
            throw new IllegalArgumentException("无法读取服务器网卡", e);
        }
    }

    private static void local(InetAddress value, boolean allowWildcard) throws SocketException {
        if (allowWildcard && value.isAnyLocalAddress()) return;
        NetworkInterface nic = NetworkInterface.getByInetAddress(value);
        if (value.isAnyLocalAddress() || nic == null || !nic.isUp())
            throw new IllegalArgumentException("本地 IP 必须属于服务器已启用的网卡");
    }

    private static void ip(String value) {
        if (value == null || value.contains("%") || (!NetUtil.isValidIpV4Address(value) && !NetUtil.isValidIpV6Address(value)))
            throw new IllegalArgumentException("请输入完整 IP 地址，不使用域名、URL 或带 scope 的 IPv6 地址");
    }

    static InetAddress address(String value) {
        try {
            return InetAddress.getByAddress(NetUtil.createByteArrayFromIpAddressString(value));
        } catch (UnknownHostException e) {
            throw new IllegalArgumentException("IP 地址无效", e);
        }
    }

    public InetSocketAddress bindAddress() {
        return new InetSocketAddress(address(bindIp), bindPort);
    }

    public InetSocketAddress targetAddress() {
        return new InetSocketAddress(address(targetIp), targetPort);
    }

    /**
     * 只绑定本地源 IP，不替代路由/策略路由，更不把源地址绑定宣称为物理出口网卡锁定。
     */
    public InetSocketAddress sendAddress() {
        String value = sendIp.isEmpty() ? (address(bindIp).getAddress().length == 4 ? "0.0.0.0" : "::") : sendIp;
        return new InetSocketAddress(address(value), sendPort);
    }
}
