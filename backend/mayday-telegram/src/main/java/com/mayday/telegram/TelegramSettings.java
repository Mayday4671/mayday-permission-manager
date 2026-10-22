package com.mayday.telegram;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Base64;
import java.util.Locale;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Telegram 凭据只从本机环境配置绑定；该类型不覆写 toString，避免意外把 apiHash 写入日志。
 * 配置缺失不会阻止平台启动，只有管理员主动开启模块后才显示安全的未就绪状态。
 */
@ConfigurationProperties(prefix = "mayday.telegram")
public class TelegramSettings
{
    private String apiId = "";
    private String apiHash = "";
    private String sessionEncryptionKey = "";
    private String searchBotUsername = "jisou";
    private boolean proxyEnabled;
    private String proxyType = "socks5";
    private String proxyHost = "";
    private int proxyPort;
    private String proxyUsername = "";
    private String proxyPassword = "";
    private String proxySecret = "";
    private Path dataDirectory = Paths.get("data", "telegram");
    private long maxMediaFileBytes = 50L * 1024 * 1024;
    private long maxStoredMediaBytes = 10L * 1024 * 1024 * 1024;
    private long minimumFreeDiskBytes = 1024L * 1024 * 1024;
    private int maxMediaWorkers = 2;
    private int mediaDownloadTimeoutSeconds = 600;
    private int mediaRetentionDays = 90;
    private String sevenZipPath = "7z";
    private String ffmpegPath = "ffmpeg";
    private String ffprobePath = "ffprobe";
    private long maxPreviewOutputBytes = 1024L * 1024 * 1024;
    private long maxPreviewDurationSeconds = 7200;
    private int previewTimeoutSeconds = 1800;

    /** 返回用于 TDLib 初始化的 API ID；调用方不得把该值放入普通 API 响应或日志。 */
    public String getApiId()
    {
        return apiId;
    }

    /** 绑定部署提供的 API ID；空值由模块状态检查解释，不阻止平台启动。 */
    public void setApiId(String apiId)
    {
        this.apiId = apiId == null ? "" : apiId.trim();
    }

    /** 返回用于 TDLib 初始化的 API Hash；仅限服务端客户端构造期间读取。 */
    public String getApiHash()
    {
        return apiHash;
    }

    /** 绑定部署提供的 API Hash；该字段永远不进入数据库或用户界面。 */
    public void setApiHash(String apiHash)
    {
        this.apiHash = apiHash == null ? "" : apiHash.trim();
    }

    /** 检查本机凭据是否齐全且 API ID 是正整数，不返回任何凭据内容。 */
    public boolean credentialsConfigured()
    {
        return apiId.matches("[1-9][0-9]{0,9}") && !apiHash.isBlank();
    }

    /**
     * 返回 TDLib 数据库加密密钥的字节副本；调用者负责在提交给 TDLib 后尽快清零，禁止记录或返回该值。
     */
    public byte[] sessionEncryptionKey()
    {
        if (sessionEncryptionKey.isBlank())
        {
            return new byte[0];
        }
        try
        {
            return Base64.getDecoder().decode(sessionEncryptionKey);
        } catch (IllegalArgumentException exception)
        {
            return new byte[0];
        }
    }

    /** 判断本机 TDLib 会话密钥是否为至少 256 位的有效 Base64 配置。 */
    public boolean sessionEncryptionKeyConfigured()
    {
        byte[] key = sessionEncryptionKey();
        try
        {
            return key.length >= 32;
        } finally
        {
            Arrays.fill(key, (byte) 0);
        }
    }

    /** 配置 TDLib 本地数据库加密密钥；建议以 Base64 保存至少 32 个随机字节。 */
    public void setSessionEncryptionKey(String sessionEncryptionKey)
    {
        this.sessionEncryptionKey = sessionEncryptionKey == null ? "" : sessionEncryptionKey.trim();
    }

    /**
     * Returns the deployment-selected public search bot; only this recipient can be
     * resolved by search actions.
     */
    public String getSearchBotUsername()
    {
        return searchBotUsername;
    }

    /**
     * Configures the public search bot username without an at-sign; it is still
     * verified against Telegram user metadata.
     */
    public void setSearchBotUsername(String searchBotUsername)
    {
        this.searchBotUsername = searchBotUsername == null || searchBotUsername.isBlank()
                ? "jisou"
                : searchBotUsername.trim();
    }

    /**
     * Reports whether TDLib should use the private deployment proxy settings.
     */
    public boolean isProxyEnabled()
    {
        return proxyEnabled;
    }

    /**
     * Enables or disables Telegram's native TDLib proxy independently of JVM
     * proxies.
     */
    public void setProxyEnabled(boolean proxyEnabled)
    {
        this.proxyEnabled = proxyEnabled;
    }

    /**
     * Returns the normalized proxy protocol name; it contains no proxy credentials.
     */
    public String getProxyType()
    {
        return switch (proxyType)
        {
            case "socks5", "http", "mtproto" -> proxyType;
            default -> "unknown";
        };
    }

    /**
     * Accepts only the proxy protocols supported by the selected TDLib release.
     */
    public void setProxyType(String proxyType)
    {
        this.proxyType = proxyType == null ? "" : proxyType.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Returns the server-side proxy host for TDLib initialization only.
     */
    public String getProxyHost()
    {
        return proxyHost;
    }

    /**
     * Binds the deployment proxy host without interpreting it as a URL.
     */
    public void setProxyHost(String proxyHost)
    {
        this.proxyHost = proxyHost == null ? "" : proxyHost.trim();
    }

    /**
     * Returns the TDLib proxy port for server-side initialization.
     */
    public int getProxyPort()
    {
        return proxyPort;
    }

    /**
     * Binds the proxy port; validation occurs before native TDLib is opened.
     */
    public void setProxyPort(int proxyPort)
    {
        this.proxyPort = proxyPort;
    }

    /**
     * Returns the private proxy username only to the TDLib adapter.
     */
    public String getProxyUsername()
    {
        return proxyUsername;
    }

    /**
     * Binds an optional proxy username from deployment secrets.
     */
    public void setProxyUsername(String proxyUsername)
    {
        this.proxyUsername = proxyUsername == null ? "" : proxyUsername;
    }

    /**
     * Returns the private proxy password only to the TDLib adapter.
     */
    public String getProxyPassword()
    {
        return proxyPassword;
    }

    /**
     * Binds an optional proxy password from deployment secrets.
     */
    public void setProxyPassword(String proxyPassword)
    {
        this.proxyPassword = proxyPassword == null ? "" : proxyPassword;
    }

    /**
     * Returns the MTProto proxy secret only to the TDLib adapter.
     */
    public String getProxySecret()
    {
        return proxySecret;
    }

    /**
     * Binds an MTProto secret without persisting or returning it to callers.
     */
    public void setProxySecret(String proxySecret)
    {
        this.proxySecret = proxySecret == null ? "" : proxySecret.trim();
    }

    /**
     * Checks proxy prerequisites without exposing the host or any authentication
     * data.
     */
    public boolean proxyConfigurationReady()
    {
        if (!proxyEnabled)
        {
            return true;
        }
        if (!proxyHost.matches("[A-Za-z0-9.:%_-]{1,253}") || proxyPort < 1 || proxyPort > 65535
                || !hasSafeLength(proxyUsername, 255) || !hasSafeLength(proxyPassword, 255))
        {
            return false;
        }
        return switch (proxyType)
        {
            case "socks5", "http" -> proxySecret.isBlank();
            case "mtproto" ->
                !proxySecret.isBlank() && hasSafeLength(proxySecret, 512) && proxySecret.matches("[A-Za-z0-9_-]+");
            default -> false;
        };
    }

    private boolean hasSafeLength(String value, int maximumLength)
    {
        return value.length() <= maximumLength && value.chars().noneMatch(Character::isISOControl);
    }

    /** 返回受控的 TDLib 数据根目录；每个账号仍会使用独立子目录。 */
    public Path getDataDirectory()
    {
        return dataDirectory;
    }

    /** 配置本地 Telegram 会话数据根目录；不接受空路径。 */
    public void setDataDirectory(Path dataDirectory)
    {
        if (dataDirectory != null && !dataDirectory.toString().isBlank())
        {
            this.dataDirectory = dataDirectory;
        }
    }

    /**
     * Returns the per-file binary limit used before and during a TDLib download.
     */
    public long getMaxMediaFileBytes()
    {
        return maxMediaFileBytes;
    }

    /**
     * Restricts operator configuration to a safe range of 1 MiB through 512 MiB.
     */
    public void setMaxMediaFileBytes(long maxMediaFileBytes)
    {
        this.maxMediaFileBytes = Math.max(1024L * 1024, Math.min(maxMediaFileBytes, 512L * 1024 * 1024));
    }

    /** Returns the aggregate storage budget reserved for Telegram media bytes. */
    public long getMaxStoredMediaBytes()
    {
        return maxStoredMediaBytes;
    }

    /** Restricts the media budget to a practical 100 MiB–2 TiB range. */
    public void setMaxStoredMediaBytes(long maxStoredMediaBytes)
    {
        this.maxStoredMediaBytes = Math.max(100L * 1024 * 1024,
                Math.min(maxStoredMediaBytes, 2L * 1024 * 1024 * 1024 * 1024));
    }

    /** Returns the disk space that must remain unused by media and archive work. */
    public long getMinimumFreeDiskBytes()
    {
        return minimumFreeDiskBytes;
    }

    /** Restricts the free-space reserve to 0 B–2 TiB. */
    public void setMinimumFreeDiskBytes(long minimumFreeDiskBytes)
    {
        this.minimumFreeDiskBytes = Math.max(0, Math.min(minimumFreeDiskBytes, 2L * 1024 * 1024 * 1024 * 1024));
    }

    /** Returns the bounded number of independent media downloads. */
    public int getMaxMediaWorkers()
    {
        return maxMediaWorkers;
    }

    /** Restricts media concurrency to 1–8 workers. */
    public void setMaxMediaWorkers(int maxMediaWorkers)
    {
        this.maxMediaWorkers = Math.max(1, Math.min(maxMediaWorkers, 8));
    }

    /** Returns the maximum wall-clock duration of one TDLib download attempt. */
    public int getMediaDownloadTimeoutSeconds()
    {
        return mediaDownloadTimeoutSeconds;
    }

    /** Restricts one download attempt to 30 seconds–1 hour. */
    public void setMediaDownloadTimeoutSeconds(int mediaDownloadTimeoutSeconds)
    {
        this.mediaDownloadTimeoutSeconds = Math.max(30, Math.min(mediaDownloadTimeoutSeconds, 3600));
    }

    /**
     * Returns the number of days after which completed Telegram media is eligible
     * for cleanup.
     */
    public int getMediaRetentionDays()
    {
        return mediaRetentionDays;
    }

    /**
     * Sets completed-media retention; zero explicitly disables automatic cleanup.
     */
    public void setMediaRetentionDays(int mediaRetentionDays)
    {
        this.mediaRetentionDays = Math.max(0, Math.min(mediaRetentionDays, 3650));
    }

    /**
     * Returns the deployment-selected 7-Zip executable used for RAR and 7z
     * archives.
     */
    public String getSevenZipPath()
    {
        return sevenZipPath;
    }

    /**
     * Configures an executable name or absolute path; no browser value reaches this
     * setting.
     */
    public void setSevenZipPath(String sevenZipPath)
    {
        this.sevenZipPath = sevenZipPath == null || sevenZipPath.isBlank() ? "7z" : sevenZipPath.trim();
    }

    /**
     * Indicates whether a regular 7-Zip executable can be found without starting a
     * process.
     */
    public boolean archiveToolAvailable()
    {
        return executableAvailable(sevenZipPath);
    }

    /** 返回部署提供的 FFmpeg 可执行文件名或绝对路径。 */
    public String getFfmpegPath()
    {
        return ffmpegPath;
    }

    /** 设置可信部署配置中的 FFmpeg 路径；浏览器和普通业务请求不能修改此值。 */
    public void setFfmpegPath(String ffmpegPath)
    {
        this.ffmpegPath = ffmpegPath == null || ffmpegPath.isBlank() ? "ffmpeg" : ffmpegPath.trim();
    }

    /** Indicates whether the configured FFmpeg executable can be found locally. */
    public boolean ffmpegAvailable()
    {
        return executableAvailable(ffmpegPath);
    }

    /** 返回部署提供的 FFprobe 可执行文件名或绝对路径。 */
    public String getFfprobePath()
    {
        return ffprobePath;
    }

    /** 设置可信部署配置中的 FFprobe 路径。 */
    public void setFfprobePath(String ffprobePath)
    {
        this.ffprobePath = ffprobePath == null || ffprobePath.isBlank() ? "ffprobe" : ffprobePath.trim();
    }

    /** Indicates whether the configured FFprobe executable can be found locally. */
    public boolean ffprobeAvailable()
    {
        return executableAvailable(ffprobePath);
    }

    /**
     * Checks a trusted deployment command or path without executing it. PATH lookup
     * is supported for the standard executable names used by the runtime image.
     */
    private boolean executableAvailable(String configuredCommand)
    {
        if (configuredCommand == null || configuredCommand.isBlank())
        {
            return false;
        }
        Path configuredPath;
        try
        {
            configuredPath = Path.of(configuredCommand);
        } catch (InvalidPathException exception)
        {
            return false;
        }
        if (configuredPath.isAbsolute() || configuredCommand.contains("/") || configuredCommand.contains("\\"))
        {
            return isRunnableFile(configuredPath);
        }
        String searchPath = System.getenv("PATH");
        if (searchPath == null || searchPath.isBlank())
        {
            return false;
        }
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("windows");
        String[] extensions = windows ? new String[]
        {"", ".exe", ".cmd", ".bat"} : new String[]
        {""};
        for (String directory : searchPath.split(java.util.regex.Pattern.quote(File.pathSeparator)))
        {
            if (directory.isBlank())
            {
                continue;
            }
            for (String extension : extensions)
            {
                if (isRunnableFile(Path.of(directory).resolve(configuredCommand + extension)))
                {
                    return true;
                }
            }
        }
        return false;
    }

    /** Applies platform-appropriate file checks without disclosing the path. */
    private boolean isRunnableFile(Path candidate)
    {
        return Files.isRegularFile(candidate) && (isWindows() || Files.isExecutable(candidate));
    }

    private boolean isWindows()
    {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("windows");
    }

    /** 返回单个预览任务可产生的 HLS 清单和分片总量上限。 */
    public long getMaxPreviewOutputBytes()
    {
        return maxPreviewOutputBytes;
    }

    /** 限制单任务的 HLS 输出空间在 16 MiB 至 4 GiB 之间。 */
    public void setMaxPreviewOutputBytes(long maxPreviewOutputBytes)
    {
        this.maxPreviewOutputBytes = Math.max(16L * 1024 * 1024,
                Math.min(maxPreviewOutputBytes, 4L * 1024 * 1024 * 1024));
    }

    /** 返回允许预览的最长视频时长秒数。 */
    public long getMaxPreviewDurationSeconds()
    {
        return maxPreviewDurationSeconds;
    }

    /** 限制单个视频最长处理时长，避免异常媒体长期占用转码能力。 */
    public void setMaxPreviewDurationSeconds(long maxPreviewDurationSeconds)
    {
        this.maxPreviewDurationSeconds = Math.max(60, Math.min(maxPreviewDurationSeconds, 24 * 60 * 60));
    }

    /** 返回 FFprobe 与 FFmpeg 合并处理任务的最长运行秒数。 */
    public int getPreviewTimeoutSeconds()
    {
        return previewTimeoutSeconds;
    }

    /** 限制单个探测/封装处理任务在 30 秒至两小时之间。 */
    public void setPreviewTimeoutSeconds(int previewTimeoutSeconds)
    {
        this.previewTimeoutSeconds = Math.max(30, Math.min(previewTimeoutSeconds, 7200));
    }

}
