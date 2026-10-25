import { useEffect, useRef, useState } from "react";
import type { RefObject, VideoHTMLAttributes } from "react";
import { Button } from "antd";
import {
  ArrowsAltOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";

type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, "ref"> & {
  videoRef?: RefObject<HTMLVideoElement | null>;
};

/** Shared native/HLS controls; expanding the player keeps the same video and playback position. */
export function TelegramVideoPlayer({
  videoRef,
  onLoadedMetadata,
  onDurationChange,
  onRateChange,
  ...props
}: Props) {
  const ownVideo = useRef<HTMLVideoElement>(null);
  const video = videoRef ?? ownVideo;
  const container = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [webFullscreen, setWebFullscreen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    if (!webFullscreen && !fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Consume Escape before the modal handler so leaving full screen does not close the preview.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (document.fullscreenElement === container.current)
        void document.exitFullscreen().catch(() => {});
      setWebFullscreen(false);
      setNotice(undefined);
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", escape, true);
    };
  }, [webFullscreen, fullscreen]);

  function seek(seconds: number) {
    const element = video.current;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0)
      return;
    element.currentTime = Math.max(
      0,
      Math.min(element.duration, element.currentTime + seconds),
    );
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === container.current)
        await document.exitFullscreen();
      else if (container.current?.requestFullscreen)
        await container.current.requestFullscreen();
      else throw new Error("Fullscreen unavailable");
      setNotice(undefined);
    } catch {
      setWebFullscreen(true);
      setNotice("当前浏览器未允许全屏，已切换网页全屏");
    }
  }

  return (
    <div
      ref={container}
      className={`telegram-video-player${webFullscreen ? " is-web-fullscreen" : ""}`}
      role="region"
      aria-label="视频播放器"
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button, input, select, textarea",
          )
        )
          return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          seek(event.key === "ArrowLeft" ? -10 : 10);
        }
      }}
    >
      <video
        {...props}
        ref={video}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
          onLoadedMetadata?.(event);
        }}
        onDurationChange={(event) => {
          setDuration(event.currentTarget.duration);
          onDurationChange?.(event);
        }}
        onRateChange={(event) => {
          setRate(event.currentTarget.playbackRate);
          onRateChange?.(event);
        }}
      />
      <div className="telegram-video-toolbar">
        <div className="telegram-video-tools">
          <Button
            type="text"
            size="small"
            disabled={!Number.isFinite(duration) || duration <= 0}
            onClick={() => seek(-10)}
            aria-label="快退 10 秒"
          >
            −10 秒
          </Button>
          <Button
            type="text"
            size="small"
            disabled={!Number.isFinite(duration) || duration <= 0}
            onClick={() => seek(10)}
            aria-label="快进 10 秒"
          >
            +10 秒
          </Button>
          <select
            aria-label="播放速度"
            value={rate}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (video.current) video.current.playbackRate = value;
              setRate(value);
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </div>
        <div className="telegram-video-tools">
          <Button
            type="text"
            size="small"
            aria-label={webFullscreen ? "退出网页全屏" : "网页全屏"}
            icon={webFullscreen ? <ShrinkOutlined /> : <ArrowsAltOutlined />}
            onClick={() => {
              setWebFullscreen((value) => !value);
              setNotice(undefined);
            }}
          >
            {webFullscreen ? "退出网页全屏" : "网页全屏"}
          </Button>
          <Button
            type="text"
            size="small"
            icon={
              fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />
            }
            aria-label={fullscreen ? "退出全屏" : "全屏播放"}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? "退出全屏" : "全屏播放"}
          </Button>
        </div>
      </div>
      {notice ? (
        <div className="telegram-video-notice" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
