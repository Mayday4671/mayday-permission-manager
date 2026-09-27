import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Spin } from "antd";
import { api, jsonBody } from "../lib/api";

interface Puzzle {
  challengeId: string;
  background: string;
  piece: string;
  width: number;
  height: number;
  pieceSize: number;
  y: number;
  expiresIn: number;
}
interface Props {
  open: boolean;
  username: string;
  onCancel: () => void;
  onVerified: (token: string) => void;
}

/**
 * 可复用的滑动验证弹窗。组件只移动服务端图片，答案与通过凭证由后端校验。
 * 使用原生 range 支持鼠标、触屏和键盘；尺寸按图片比例换算，不受窗口宽度/缩放影响。
 * 关闭、换图和重新打开会中止旧请求，并用序号忽略迟到响应，防止旧题覆盖当前状态。
 */
export function SlideCaptcha({ open, username, onCancel, onVerified }: Props) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [x, setX] = useState(0);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(0);
  const position = useRef(0);
  const submitting = useRef(false);
  const slider = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (keepError = false) => {
      const current = ++sequence.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setPuzzle(null);
      setX(0);
      position.current = 0;
      started.current = 0;
      setLoading(true);
      if (!keepError) setError("");
      try {
        const next = await api<Puzzle>("/auth/captcha/challenge", {
          method: "POST",
          body: jsonBody({ username }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (current === sequence.current) setPuzzle(next);
      } catch (e) {
        if (current === sequence.current && !controller.signal.aborted)
          setError(
            (e as Error).name === "TimeoutError"
              ? "验证图片加载超时，请重试"
              : (e as Error).message,
          );
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [username],
  );

  useEffect(() => {
    if (open) void load();
    return () => {
      ++sequence.current;
      abort.current?.abort();
      submitting.current = false;
      setVerifying(false);
    };
  }, [open, load]);
  useEffect(() => {
    if (puzzle) slider.current?.focus();
  }, [puzzle]);

  const verify = async () => {
    if (!puzzle || submitting.current || !started.current) return;
    submitting.current = true;
    setVerifying(true);
    const current = sequence.current;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await api<{ captchaToken: string }>(
        "/auth/captcha/verify",
        {
          method: "POST",
          body: jsonBody({
            challengeId: puzzle.challengeId,
            username,
            x: position.current,
            elapsedMs: Math.round(performance.now() - started.current),
          }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        },
      );
      if (current === sequence.current) onVerified(result.captchaToken);
    } catch (e) {
      if (current === sequence.current && !controller.signal.aborted) {
        setError(
          (e as Error).name === "TimeoutError"
            ? "验证超时，请重新拖动滑块"
            : (e as Error).message,
        );
        // 一次失败即换新题，不能连续猜测同一道题；保留明确错误提示。
        void load(true);
      }
    } finally {
      submitting.current = false;
      setVerifying(false);
    }
  };

  return (
    <Modal
      title="安全验证"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={384}
      centered
      destroyOnHidden
      className="slide-captcha-modal"
    >
      <p className="slide-captcha-instruction">拖动滑块，使拼图与缺口重合</p>
      {error && (
        <Alert
          type="error"
          title={error}
          showIcon
          className="slide-captcha-error"
        />
      )}
      <div
        className="slide-captcha-image"
        style={{
          aspectRatio: puzzle ? `${puzzle.width}/${puzzle.height}` : "2/1",
        }}
      >
        {puzzle ? (
          <>
            <img
              src={puzzle.background}
              alt="滑动验证背景，请找到拼图缺口"
              draggable={false}
            />
            <img
              className="slide-captcha-piece"
              src={puzzle.piece}
              alt=""
              draggable={false}
              style={{
                width: `${(puzzle.pieceSize / puzzle.width) * 100}%`,
                left: `${(x / puzzle.width) * 100}%`,
                top: `${(puzzle.y / puzzle.height) * 100}%`,
              }}
            />
          </>
        ) : (
          <div className="slide-captcha-placeholder">
            {loading ? <Spin /> : "图片未加载"}
          </div>
        )}
      </div>
      <div className="slide-captcha-track">
        <span aria-hidden="true">
          {verifying ? "正在验证…" : "向右拖动滑块"}
        </span>
        <input
          ref={slider}
          type="range"
          min={0}
          max={puzzle ? puzzle.width - puzzle.pieceSize : 272}
          step={1}
          value={x}
          disabled={!puzzle || loading || verifying}
          aria-label="滑动拼图验证"
          aria-describedby="slide-captcha-help"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            // 拖出轨道后松开仍接收本次结束事件，触屏取消则走下方重置逻辑。
            event.currentTarget.setPointerCapture(event.pointerId);
            started.current = performance.now();
          }}
          onChange={(e) => {
            position.current = Number(e.target.value);
            setX(position.current);
          }}
          onPointerUp={() => {
            void verify();
          }}
          onPointerCancel={() => {
            started.current = 0;
            position.current = 0;
            setX(0);
          }}
          onKeyDown={(e) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) &&
              !started.current
            )
              started.current = performance.now();
            if (e.key === "Enter") {
              e.preventDefault();
              void verify();
            }
          }}
        />
      </div>
      <div className="slide-captcha-footer">
        <span id="slide-captcha-help">键盘可用方向键移动，回车验证</span>
        <Button
          type="link"
          size="small"
          disabled={loading || verifying}
          onClick={() => {
            void load();
          }}
        >
          {puzzle ? "换一张" : "重新加载"}
        </Button>
      </div>
    </Modal>
  );
}
