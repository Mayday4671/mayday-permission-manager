import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject, VideoHTMLAttributes } from "react";
import {
  Check,
  Expand,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";

type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, "ref"> & {
  videoRef?: RefObject<HTMLVideoElement | null>;
};

/** Keep elapsed and total time readable for both clips and multi-hour videos. */
function formatTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(value % 60).padStart(2, "0")}`;
}

/** One overlay control surface shared by native and HLS playback. */
export function TelegramVideoPlayer({
  videoRef,
  onLoadedMetadata,
  onDurationChange,
  onRateChange,
  onTimeUpdate,
  onPlay,
  onPause,
  onEnded,
  onVolumeChange,
  onProgress,
  onWaiting,
  onPlaying,
  onSeeking,
  onSeeked,
  onCanPlay,
  onError,
  ...props
}: Props) {
  const ownVideo = useRef<HTMLVideoElement>(null);
  const video = videoRef ?? ownVideo;
  const container = useRef<HTMLDivElement>(null);
  const speedMenu = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const dragging = useRef(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [buffered, setBuffered] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateMenu, setRateMenu] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [webFullscreen, setWebFullscreen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState<string>();
  const canSeek = Number.isFinite(duration) && duration > 0;
  const elapsed = seekPreview ?? position;
  const showControls =
    !playing || controlsVisible || rateMenu || interacting || keyboardFocus;

  const revealControls = useCallback(() => {
    clearTimeout(idleTimer.current);
    setControlsVisible(true);
    if (playing && !rateMenu && !interacting && !keyboardFocus)
      idleTimer.current = setTimeout(() => setControlsVisible(false), 2500);
  }, [playing, rateMenu, interacting, keyboardFocus]);
  useEffect(() => {
    revealControls();
    return () => clearTimeout(idleTimer.current);
  }, [revealControls]);
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    if (!rateMenu) return;
    const outside = (event: PointerEvent) => {
      if (!speedMenu.current?.contains(event.target as Node))
        setRateMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [rateMenu]);
  useEffect(() => {
    if (!webFullscreen && !fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (rateMenu) {
        setRateMenu(false);
        return;
      }
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
  }, [webFullscreen, fullscreen, rateMenu]);

  function updateBuffer(element: HTMLVideoElement) {
    let end = 0;
    for (let index = 0; index < element.buffered.length; index++) {
      if (element.buffered.start(index) <= element.currentTime + 0.1)
        end = Math.max(end, element.buffered.end(index));
    }
    setBuffered(end);
  }

  function seekTo(seconds: number) {
    const element = video.current;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0)
      return;
    const target = Math.max(0, Math.min(element.duration, seconds));
    element.currentTime = target;
    setPosition(target);
    setSeekPreview(null);
    revealControls();
  }

  async function togglePlayback() {
    const element = video.current;
    if (!element) return;
    setNotice(undefined);
    if (!element.paused) element.pause();
    else {
      try {
        await element.play();
      } catch {
        setNotice("视频暂时无法播放，请稍后重试");
      }
    }
  }

  function changeVolume(value: number) {
    const element = video.current;
    if (!element) return;
    element.volume = value;
    element.muted = value === 0;
    setVolume(value);
    setMuted(element.muted);
  }

  function toggleMute() {
    const element = video.current;
    if (!element) return;
    if (element.volume === 0) {
      element.volume = 0.5;
      element.muted = false;
    } else element.muted = !element.muted;
    setVolume(element.volume);
    setMuted(element.muted);
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
      className={`telegram-video-player${webFullscreen ? " is-web-fullscreen" : ""}${showControls ? " has-controls" : " is-idle"}`}
      role="region"
      aria-label="视频播放器"
      tabIndex={0}
      onPointerMove={revealControls}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible"))
          setKeyboardFocus(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setKeyboardFocus(false);
      }}
      onKeyDown={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button, input, select, textarea",
          )
        )
          return;
        const key = event.key.toLowerCase();
        if (!["arrowleft", "arrowright", " ", "k", "m", "f"].includes(key))
          return;
        event.preventDefault();
        event.stopPropagation();
        revealControls();
        if (key === "arrowleft" || key === "arrowright")
          seekTo(
            (video.current?.currentTime ?? 0) +
              (key === "arrowleft" ? -10 : 10),
          );
        else if (key === "m") toggleMute();
        else if (key === "f") void toggleFullscreen();
        else void togglePlayback();
      }}
    >
      <video
        {...props}
        ref={video}
        controls={false}
        playsInline
        preload="metadata"
        onClick={() => {
          container.current?.focus({ preventScroll: true });
          void togglePlayback();
        }}
        onDoubleClick={() => void toggleFullscreen()}
        onLoadedMetadata={(event) => {
          onLoadedMetadata?.(event);
          const element = event.currentTarget;
          setDuration(element.duration);
          setPosition(element.currentTime);
          setVolume(element.volume);
          setMuted(element.muted);
          updateBuffer(element);
        }}
        onDurationChange={(event) => {
          setDuration(event.currentTarget.duration);
          onDurationChange?.(event);
        }}
        onTimeUpdate={(event) => {
          setPosition(event.currentTarget.currentTime);
          updateBuffer(event.currentTarget);
          onTimeUpdate?.(event);
        }}
        onProgress={(event) => {
          updateBuffer(event.currentTarget);
          onProgress?.(event);
        }}
        onRateChange={(event) => {
          setRate(event.currentTarget.playbackRate);
          onRateChange?.(event);
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
          onVolumeChange?.(event);
        }}
        onPlay={(event) => {
          setPlaying(true);
          onPlay?.(event);
        }}
        onPause={(event) => {
          setPlaying(false);
          setWaiting(false);
          onPause?.(event);
        }}
        onEnded={(event) => {
          setPlaying(false);
          setWaiting(false);
          onEnded?.(event);
        }}
        onWaiting={(event) => {
          setWaiting(true);
          onWaiting?.(event);
        }}
        onPlaying={(event) => {
          setWaiting(false);
          onPlaying?.(event);
        }}
        onSeeking={(event) => {
          setWaiting(true);
          onSeeking?.(event);
        }}
        onSeeked={(event) => {
          setWaiting(false);
          onSeeked?.(event);
        }}
        onCanPlay={(event) => {
          setWaiting(false);
          onCanPlay?.(event);
        }}
        onError={(event) => {
          setWaiting(false);
          onError?.(event);
        }}
      />
      {waiting && playing ? (
        <div
          className="telegram-video-center-loading"
          role="status"
          aria-label="视频缓冲中"
        >
          <LoaderCircle size={32} />
        </div>
      ) : !playing ? (
        <button
          type="button"
          className="telegram-video-center-play"
          aria-label="播放视频"
          onClick={() => void togglePlayback()}
        >
          <Play size={28} fill="currentColor" />
        </button>
      ) : null}
      <div
        className="telegram-video-controls"
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") setInteracting(true);
        }}
        onPointerLeave={() => setInteracting(false)}
      >
        <input
          type="range"
          className="telegram-video-progress"
          aria-label="播放进度"
          aria-valuetext={`${formatTime(elapsed)} / ${formatTime(duration)}`}
          min={0}
          max={canSeek ? duration : 1}
          step={0.1}
          value={canSeek ? Math.min(elapsed, duration) : 0}
          disabled={!canSeek}
          style={
            {
              "--played": `${canSeek ? Math.min(100, (elapsed / duration) * 100) : 0}%`,
              "--buffered": `${canSeek ? Math.min(100, (buffered / duration) * 100) : 0}%`,
            } as CSSProperties
          }
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            if (dragging.current) setSeekPreview(value);
            else seekTo(value);
          }}
          onPointerUp={(event) => {
            dragging.current = false;
            seekTo(Number(event.currentTarget.value));
          }}
          onPointerCancel={() => {
            dragging.current = false;
            setSeekPreview(null);
          }}
          onBlur={() => {
            dragging.current = false;
            setSeekPreview(null);
          }}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            event.stopPropagation();
            seekTo(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? duration
                  : (video.current?.currentTime ?? 0) +
                    (event.key === "ArrowLeft" ? -5 : 5),
            );
          }}
        />
        <div className="telegram-video-toolbar">
          <div className="telegram-video-tools">
            <button
              type="button"
              className="telegram-video-control"
              aria-label={playing ? "暂停" : "播放"}
              title={playing ? "暂停 (空格)" : "播放 (空格)"}
              onClick={() => void togglePlayback()}
            >
              {playing ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" />
              )}
            </button>
            {[-10, 10].map((seconds) => (
              <button
                key={seconds}
                type="button"
                className="telegram-video-control telegram-video-skip"
                disabled={!canSeek}
                aria-label={seconds < 0 ? "快退 10 秒" : "快进 10 秒"}
                title={seconds < 0 ? "快退 10 秒 (←)" : "快进 10 秒 (→)"}
                onClick={() =>
                  seekTo((video.current?.currentTime ?? 0) + seconds)
                }
              >
                {seconds < 0 ? <RotateCcw size={23} /> : <RotateCw size={23} />}
                <span aria-hidden="true">10</span>
              </button>
            ))}
            <div className="telegram-video-volume">
              <button
                type="button"
                className="telegram-video-control"
                aria-label={muted || !volume ? "取消静音" : "静音"}
                title="音量 (M)"
                onClick={toggleMute}
              >
                {muted || !volume ? (
                  <VolumeX size={21} />
                ) : (
                  <Volume2 size={21} />
                )}
              </button>
              <input
                type="range"
                aria-label="音量"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) =>
                  changeVolume(Number(event.currentTarget.value))
                }
              />
            </div>
            <span className="telegram-video-time">
              {formatTime(elapsed)}
              <span> / {formatTime(duration)}</span>
            </span>
          </div>
          <div className="telegram-video-tools">
            <div
              ref={speedMenu}
              className="telegram-video-speed"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setRateMenu(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && rateMenu) {
                  event.preventDefault();
                  event.stopPropagation();
                  setRateMenu(false);
                  speedMenu.current
                    ?.querySelector<HTMLButtonElement>(
                      ".telegram-video-control",
                    )
                    ?.focus();
                }
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  rateMenu
                ) {
                  event.preventDefault();
                  const items = Array.from(
                    speedMenu.current?.querySelectorAll<HTMLButtonElement>(
                      '[role="menuitemradio"]',
                    ) ?? [],
                  );
                  const current = items.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const next =
                    current < 0
                      ? event.key === "ArrowDown"
                        ? 0
                        : items.length - 1
                      : (current +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length;
                  items[next]?.focus();
                }
              }}
            >
              <button
                type="button"
                className="telegram-video-control telegram-video-rate"
                aria-label="播放速度"
                title="播放速度"
                aria-haspopup="menu"
                aria-expanded={rateMenu}
                onClick={() => setRateMenu((value) => !value)}
              >
                {rate}×
              </button>
              {rateMenu ? (
                <div
                  className="telegram-video-speed-menu"
                  role="menu"
                  aria-label="播放速度"
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                    <button
                      type="button"
                      key={value}
                      role="menuitemradio"
                      aria-checked={rate === value}
                      onClick={() => {
                        if (video.current) video.current.playbackRate = value;
                        setRate(value);
                        setRateMenu(false);
                        speedMenu.current
                          ?.querySelector<HTMLButtonElement>(
                            ".telegram-video-control",
                          )
                          ?.focus();
                      }}
                    >
                      {value}×{rate === value ? <Check size={14} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="telegram-video-control"
              aria-label={webFullscreen ? "退出网页全屏" : "网页全屏"}
              title={webFullscreen ? "退出网页全屏" : "网页全屏"}
              onClick={() => {
                setWebFullscreen((value) => !value);
                setNotice(undefined);
              }}
            >
              {webFullscreen ? (
                <Minimize size={20} />
              ) : (
                <RectangleHorizontal size={21} />
              )}
            </button>
            <button
              type="button"
              className="telegram-video-control"
              aria-label={fullscreen ? "退出全屏" : "全屏播放"}
              title={fullscreen ? "退出全屏" : "全屏播放 (F)"}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Maximize size={20} /> : <Expand size={20} />}
            </button>
          </div>
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
