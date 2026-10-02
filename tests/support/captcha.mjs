/**
 * 本项目本机 HTTP 验收辅助：读取实际 PNG，匹配拼图像素，完成真实验证后再登录。
 * 不关闭验证码、不在生产服务添加固定答案/测试口令。此简单自托管拼图可被图像算法识别，
 * 因此只作为基础自动化门槛；密码限流仍必须保留，高风险系统应接专业风控/MFA。
 */
import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

function png(dataUrl) {
  const source = Buffer.from(dataUrl.split(",")[1], "base64");
  assert.equal(source.subarray(1, 4).toString(), "PNG");
  let width, height, channels;
  const compressed = [];
  for (let offset = 8; offset < source.length;) {
    const length = source.readUInt32BE(offset),
      type = source.toString("ascii", offset + 4, offset + 8),
      body = source.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8);
      assert([2, 6].includes(body[9]));
      assert.equal(body[12], 0);
      channels = body[9] === 6 ? 4 : 3;
    }
    if (type === "IDAT") compressed.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(compressed)),
    stride = width * channels,
    pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert(filter >= 0 && filter <= 4);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? pixels[y * stride + i - channels] : 0,
        b = y ? pixels[(y - 1) * stride + i] : 0,
        c = y && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      const predict = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][
        filter
      ];
      pixels[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + predict) & 255;
    }
  }
  return { width, height, channels, pixels };
}

export function puzzleOffset(puzzle) {
  const background = png(puzzle.background),
    piece = png(puzzle.piece);
  const outline = [];
  for (let y = 0; y < piece.height; y++)
    for (let x = 0; x < piece.width; x++) {
      const i = (y * piece.width + x) * piece.channels;
      if (
        piece.pixels[i] > 250 &&
        piece.pixels[i + 1] > 250 &&
        piece.pixels[i + 2] > 250 &&
        piece.pixels[i + 3] > 250
      )
        outline.push([x, y]);
    }
  let best = { x: 0, error: Infinity };
  // 仅取拼图内部，避开白色轮廓和半透明抗锯齿边缘；还原缺口暗色叠加后的像素。
  for (let x = 0; x <= puzzle.width - puzzle.pieceSize; x++) {
    let error = 0;
    for (let py = 18; py < 38; py += 2)
      for (let px = 16; px < 33; px += 2)
        for (let c = 0; c < 3; c++) {
          const expected =
            piece.pixels[(py * piece.width + px) * piece.channels + c] *
              (105 / 255) +
            [20, 30, 40][c] * (150 / 255);
          const actual =
            background.pixels[
              ((puzzle.y + py) * background.width + x + px) *
                background.channels +
                c
            ];
          error += (expected - actual) ** 2;
        }
    // 平坦区域的纹理可能近似，额外匹配实际 PNG 的拼图轮廓，避免仅匹配中心色块。
    for (const [px, py] of outline)
      for (let c = 0; c < 3; c++) {
        const actual =
          background.pixels[
            ((puzzle.y + py) * background.width + x + px) *
              background.channels +
              c
          ];
        error += 2 * (235 - actual) ** 2;
      }
    if (error < best.error) best = { x, error };
  }
  return best.x;
}

export async function captchaRequest(base, path, data, status = 200) {
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname),
    "验证码回归仅用于本机开发/隔离验收服务",
  );
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  assert.equal(
    response.status,
    status,
    `${path} expected ${status}, received ${response.status}`,
  );
  return body.data;
}
export const challenge = (base, username) =>
  captchaRequest(base, "/auth/captcha/challenge", { username });
export async function captchaToken(base, username) {
  const puzzle = await challenge(base, username);
  await delay(350);
  return (
    await captchaRequest(base, "/auth/captcha/verify", {
      challengeId: puzzle.challengeId,
      username,
      x: puzzleOffset(puzzle),
      elapsedMs: 350,
    })
  ).captchaToken;
}
export async function loginWithCaptcha(base, username, password, status = 200) {
  const proof = await captchaToken(base, username);
  return captchaRequest(
    base,
    "/auth/login",
    { username, password, captchaToken: proof },
    status,
  );
}
