package com.mayday.netty;

import java.net.InetSocketAddress;
import java.nio.file.*;
import java.util.*;

/**
 * 只读当前监听 socket 的 /proc 记录，不使用整机 Udp InErrors 冒充本转发器的丢包。
 */
final class LinuxUdpDrops {
    private final String local;
    private final Path table;

    LinuxUdpDrops(InetSocketAddress address) {
        byte[] bytes = address.getAddress().getAddress();
        StringBuilder value = new StringBuilder();
        // /proc/net/udp[6] 的地址按本机 32 位字序显示；支持常见 Linux x86/ARM 小端平台。
        for (int i = 0; i < bytes.length; i += 4)
            for (int j = 3; j >= 0; j--) value.append(String.format(Locale.ROOT, "%02X", bytes[i + j] & 255));
        local = value + String.format(Locale.ROOT, ":%04X", address.getPort());
        table = Path.of(bytes.length == 4 ? "/proc/net/udp" : "/proc/net/udp6");
    }

    Long read() {
        if (!System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("linux")
                || java.nio.ByteOrder.nativeOrder() != java.nio.ByteOrder.LITTLE_ENDIAN) return null;
        try {
            for (String line : Files.readAllLines(table)) {
                String[] parts = line.trim().split("\\s+");
                if (parts.length >= 13 && parts[1].equalsIgnoreCase(local))
                    return Long.parseLong(parts[parts.length - 1]);
            }
        } catch (Exception ignored) { /* 权限不足或系统不支持时返回未知，绝不填零。 */ }
        return null;
    }
}
