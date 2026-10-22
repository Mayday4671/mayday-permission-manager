package com.mayday.telegram;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

import com.mayday.common.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 使用受控参数列表探测视频并生成有限大小的 HLS 点播资源。媒体文件来自本系统已保存对象； 用户不能提供命令、文件路径、播放列表或网络输入地址。
 */
@Component
@RequiredArgsConstructor
class TelegramVideoPreviewProcessor
{
    private static final long MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;
    private static final int MAX_SEGMENTS = 1200;
    private static final String ALLOWED_FORMATS = "mov,matroska,webm";
    private static final String ALLOWED_PROTOCOLS = "file,pipe";

    private final TelegramSettings settings;
    private final ObjectMapper json;

    /** 对本地临时源文件执行无网络探测，并拒绝非白名单容器、无视频和超时媒体。 */
    ProbeResult probe(Path input, Path workspace, Consumer<Process> processObserver, BooleanSupplier cancelled)
    {
        Path output = null;
        Path errors = null;
        try
        {
            requirePrivateRegularFile(input);
            output = Files.createTempFile(workspace, "ffprobe-", ".json");
            errors = Files.createTempFile(workspace, "ffprobe-", ".log");
            List<String> command = List.of(settings.getFfprobePath(), "-v", "error", "-protocol_whitelist",
                    ALLOWED_PROTOCOLS, "-format_whitelist", ALLOWED_FORMATS, "-show_entries",
                    "format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt", "-of", "json",
                    input.toString());
            run(command, workspace, output, errors, MAX_PROBE_OUTPUT_BYTES, processObserver, cancelled);
            return parseProbe(Files.readString(output, StandardCharsets.UTF_8));
        } catch (IOException exception)
        {
            throw new BusinessException("FFprobe 无法检查视频；请确认服务已安装并且源文件完整");
        } finally
        {
            deleteQuietly(output);
            deleteQuietly(errors);
        }
    }

    /** 根据实际编码选择无损封装或受限转码，再校验每个清单引用都指向本地产物。 */
    List<PreviewAsset> createHls(Path input, Path workspace, ProbeResult probe, Consumer<Process> processObserver,
            BooleanSupplier cancelled)
    {
        Path manifest = workspace.resolve("index.m3u8");
        Path segmentPattern = workspace.resolve("segment_%05d.ts");
        Path errors = null;
        try
        {
            requirePrivateRegularFile(input);
            errors = Files.createTempFile(workspace, "ffmpeg-", ".log");
            boolean transcode = !isBrowserCompatible(probe);
            List<String> command = new ArrayList<>(List.of(settings.getFfmpegPath(), "-nostdin", "-hide_banner",
                    "-loglevel", "error", "-protocol_whitelist", ALLOWED_PROTOCOLS, "-format_whitelist",
                    ALLOWED_FORMATS, "-threads", "2", "-i", input.toString(), "-map", "0:v:0", "-map", "0:a:0?", "-sn",
                    "-dn", "-max_muxing_queue_size", "256"));
            if (transcode)
            {
                int[] dimensions = boundedDimensions(probe.width(), probe.height());
                command.addAll(List.of("-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
                        "-vf", "scale=" + dimensions[0] + ":" + dimensions[1], "-c:a", "aac", "-b:a", "128k"));
            } else
            {
                command.addAll(List.of("-c:v", "copy", "-c:a", "copy"));
            }
            command.addAll(List.of("-threads", "2", "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
                    "-hls_flags", "independent_segments", "-hls_list_size", "0", "-hls_segment_filename",
                    segmentPattern.toString(), manifest.toString()));
            run(command, workspace, ProcessBuilder.Redirect.DISCARD, ProcessBuilder.Redirect.to(errors.toFile()),
                    settings.getMaxPreviewOutputBytes(), processObserver, cancelled, () -> outputSize(workspace));
            return validateManifest(manifest, workspace, settings.getMaxPreviewOutputBytes());
        } catch (IOException exception)
        {
            throw new BusinessException("HLS 预览生成失败；请检查服务器 FFmpeg 能力和视频编码");
        } finally
        {
            deleteQuietly(errors);
        }
    }

    /** 只接受服务器生成的普通文件清单和 MPEG-TS 分片名，拒绝外链/密钥/子清单。 */
    static List<PreviewAsset> validateManifest(Path manifest, Path workspace, long maximumOutputBytes)
            throws IOException
    {
        requirePrivateRegularFile(manifest);
        long manifestSize = Files.size(manifest);
        if (manifestSize < 1 || manifestSize > MAX_PROBE_OUTPUT_BYTES)
        {
            throw new BusinessException("HLS 播放清单大小无效");
        }
        List<String> lines = Files.readAllLines(manifest, StandardCharsets.UTF_8);
        if (lines.isEmpty() || !"#EXTM3U".equals(lines.getFirst().strip()))
        {
            throw new BusinessException("HLS 播放清单格式无效");
        }
        List<PreviewAsset> assets = new ArrayList<>();
        assets.add(new PreviewAsset("index.m3u8", "application/vnd.apple.mpegurl", manifest, manifestSize));
        long totalBytes = manifestSize;
        for (String line : lines)
        {
            String name = line.strip();
            if (name.isEmpty() || name.startsWith("#"))
            {
                if (name.regionMatches(true, 0, "#EXT-X-KEY", 0, "#EXT-X-KEY".length())
                        || name.regionMatches(true, 0, "#EXT-X-MAP", 0, "#EXT-X-MAP".length())
                        || name.regionMatches(true, 0, "#EXT-X-SESSION-KEY", 0, "#EXT-X-SESSION-KEY".length()))
                {
                    throw new BusinessException("HLS 清单含有不允许的外部密钥或初始化资源");
                }
                continue;
            }
            if (!name.matches("segment_[0-9]{5}\\.ts") || assets.size() > MAX_SEGMENTS)
            {
                throw new BusinessException("HLS 清单引用了非预期资源");
            }
            Path segment = workspace.resolve(name).normalize();
            if (!segment.getParent().equals(workspace) || !Files.isRegularFile(segment, LinkOption.NOFOLLOW_LINKS)
                    || Files.isSymbolicLink(segment))
            {
                throw new BusinessException("HLS 清单引用的分片不存在");
            }
            long size = Files.size(segment);
            if (size < 1 || size > maximumOutputBytes - totalBytes)
            {
                throw new BusinessException("HLS 分片总量超过服务端空间上限");
            }
            totalBytes += size;
            assets.add(new PreviewAsset(name, "video/mp2t", segment, size));
        }
        if (assets.size() < 2 || !lines.stream().anyMatch("#EXT-X-ENDLIST"::equals))
        {
            throw new BusinessException("HLS 点播清单缺少媒体分片或结束标记");
        }
        return List.copyOf(assets);
    }

    ProbeResult parseProbe(String output)
    {
        try
        {
            JsonNode root = json.readTree(output);
            String format = root.path("format").path("format_name").asString("");
            if (format.isBlank() || !List.of("mov", "matroska", "webm").contains(format.split(",")[0]))
            {
                throw new BusinessException("此视频容器不在安全预览白名单中");
            }
            double duration = root.path("format").path("duration").asDouble(Double.NaN);
            if (!Double.isFinite(duration) || duration <= 0 || duration > settings.getMaxPreviewDurationSeconds())
            {
                throw new BusinessException("视频时长无效或超过服务端预览上限");
            }
            JsonNode streams = root.path("streams");
            ProbeStream video = null;
            String audioCodec = null;
            for (JsonNode stream : streams)
            {
                String codec = safeCodec(stream.path("codec_name").asString(""));
                if ("video".equals(stream.path("codec_type").asString()))
                {
                    if (video == null)
                    {
                        video = new ProbeStream(codec, stream.path("width").asInt(0), stream.path("height").asInt(0),
                                stream.path("pix_fmt").asString(""));
                    }
                } else if ("audio".equals(stream.path("codec_type").asString()) && audioCodec == null)
                {
                    audioCodec = codec;
                }
            }
            if (video == null || video.codec().isBlank() || video.width() < 1 || video.height() < 1)
            {
                throw new BusinessException("文件中没有可预览的视频画面");
            }
            return new ProbeResult(java.math.BigDecimal.valueOf(duration), video.codec(), audioCodec, video.width(),
                    video.height(), video.pixelFormat());
        } catch (JacksonException exception)
        {
            throw new BusinessException("FFprobe 返回的视频信息无法识别");
        }
    }

    private boolean isBrowserCompatible(ProbeResult probe)
    {
        return "h264".equals(probe.videoCodec()) && (probe.audioCodec() == null || "aac".equals(probe.audioCodec()))
                && "yuv420p".equals(probe.pixelFormat()) && probe.width() <= 1280 && probe.height() <= 720;
    }

    private int[] boundedDimensions(int width, int height)
    {
        double ratio = Math.min(1d, Math.min(1280d / width, 720d / height));
        int scaledWidth = Math.max(2, ((int) Math.floor(width * ratio)) & ~1);
        int scaledHeight = Math.max(2, ((int) Math.floor(height * ratio)) & ~1);
        return new int[]
        {scaledWidth, scaledHeight};
    }

    private void run(List<String> command, Path workingDirectory, Path stdout, Path stderr, long outputLimit,
            Consumer<Process> observer, BooleanSupplier cancelled) throws IOException
    {
        run(command, workingDirectory, ProcessBuilder.Redirect.to(stdout.toFile()),
                ProcessBuilder.Redirect.to(stderr.toFile()), outputLimit, observer, cancelled, () -> fileSize(stdout));
    }

    private void run(List<String> command, Path workingDirectory, ProcessBuilder.Redirect stdout,
            ProcessBuilder.Redirect stderr, long outputLimit, Consumer<Process> observer, BooleanSupplier cancelled,
            SizeSupplier outputSize) throws IOException
    {
        ProcessBuilder builder = new ProcessBuilder(command).directory(workingDirectory.toFile()).redirectOutput(stdout)
                .redirectError(stderr);
        Process process;
        try
        {
            process = builder.start();
        } catch (IOException exception)
        {
            throw new BusinessException("视频预览组件未安装或无法启动");
        }
        observer.accept(process);
        long deadline = System.nanoTime() + Duration.ofSeconds(settings.getPreviewTimeoutSeconds()).toNanos();
        try
        {
            while (!process.waitFor(200, java.util.concurrent.TimeUnit.MILLISECONDS))
            {
                if (cancelled.getAsBoolean())
                {
                    throw new BusinessException("视频预览任务已取消");
                }
                if (System.nanoTime() >= deadline)
                {
                    throw new BusinessException("视频预览处理超时");
                }
                if (outputSize.get() > outputLimit)
                {
                    throw new BusinessException("视频预览输出超过服务端限制");
                }
            }
            if (process.exitValue() != 0)
            {
                throw new BusinessException("视频编码无法生成受支持的 HLS 预览");
            }
            if (outputSize.get() > outputLimit)
            {
                throw new BusinessException("视频预览输出超过服务端限制");
            }
        } catch (InterruptedException exception)
        {
            Thread.currentThread().interrupt();
            throw new BusinessException("视频预览处理已中断");
        } catch (IOException exception)
        {
            throw new BusinessException("无法读取视频预览处理结果");
        } finally
        {
            if (process.isAlive())
            {
                process.destroyForcibly();
            }
            observer.accept(null);
        }
    }

    private long outputSize(Path path)
    {
        try (var files = Files.list(path))
        {
            long total = 0;
            for (Path file : files.toList())
            {
                if (Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))
                {
                    total = Math.addExact(total, Files.size(file));
                }
                if (total > settings.getMaxPreviewOutputBytes())
                {
                    return total;
                }
            }
            return total;
        } catch (IOException | ArithmeticException exception)
        {
            return settings.getMaxPreviewOutputBytes() + 1;
        }
    }

    private long fileSize(Path path)
    {
        try
        {
            return Files.size(path);
        } catch (IOException exception)
        {
            return 0;
        }
    }

    private String safeCodec(String value)
    {
        return value.matches("[A-Za-z0-9_.-]{1,64}") ? value : "";
    }

    private static void requirePrivateRegularFile(Path path) throws IOException
    {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(path))
        {
            throw new IOException("输入不是受控普通文件");
        }
    }

    private static void deleteQuietly(Path path)
    {
        if (path != null)
        {
            try
            {
                Files.deleteIfExists(path);
            } catch (IOException ignored)
            {
                // Temporary probe output is random, private to this job, and never addressable
                // through an API.
            }
        }
    }

    /** 保存媒体探测结果，用于浏览器兼容性判断、预览参数校验和任务状态展示。 */
    record ProbeResult(java.math.BigDecimal durationSeconds, String videoCodec, String audioCodec, int width,
            int height, String pixelFormat) {
    }

    /** 描述已生成且位于隔离工作目录中的预览资源及其响应元数据。 */
    record PreviewAsset(String name, String contentType, Path path, long size) {
    }

    /** 保存探测输出中的单条媒体流信息，便于组合视频与音频探测结果。 */
    private record ProbeStream(String codec, int width, int height, String pixelFormat) {
    }

    /** 提供可能因文件系统状态变化而失败的输出目录大小读取操作。 */
    @FunctionalInterface
    private interface SizeSupplier
    {
        long get() throws IOException;
    }
}
