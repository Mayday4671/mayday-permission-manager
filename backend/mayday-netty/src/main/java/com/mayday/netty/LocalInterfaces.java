package com.mayday.netty;

import java.net.*;
import java.util.*;

/**
 * 只读服务器网卡地址，不修改路由、防火墙或反向路径检查。由宿主授权后再向管理页面返回。
 */
public final class LocalInterfaces {
    private LocalInterfaces() {
    }

    public record Address(String name, String displayName, String ip, int prefixLength, int mtu, boolean up,
                          boolean loopback) {
    }

    public static List<Address> list() {
        List<Address> result = new ArrayList<>();
        try {
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                for (InterfaceAddress binding : nic.getInterfaceAddresses()) {
                    InetAddress address = binding.getAddress();
                    // 带 scope 的链路本地 IPv6 暂不支持，避免丢掉 zone 后错误选择另一个接口。
                    if (address.getHostAddress().contains("%") || address.isLinkLocalAddress()) continue;
                    result.add(new Address(nic.getName(), nic.getDisplayName(), address.getHostAddress(),
                            binding.getNetworkPrefixLength(), nic.getMTU(), nic.isUp(), nic.isLoopback()));
                }
            }
        } catch (SocketException error) {
            throw new IllegalStateException("读取服务器网卡失败", error);
        }
        result.sort(Comparator.comparing(Address::name).thenComparing(Address::ip));
        return List.copyOf(result);
    }
}
