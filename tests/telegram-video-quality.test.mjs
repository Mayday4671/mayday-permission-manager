import assert from "node:assert/strict";
import test from "node:test";
import {
  videoQualityOptions,
  videoResolution,
} from "../frontend/src/pages/telegram/telegram-video-quality.ts";

const source = {
  id: "original",
  width: 640,
  height: 360,
  codec: "",
  size: 960727585,
};

test("低清源文件与同分辨率备用编码分别标明尺寸和大小，不补造4K选项", () => {
  const options = videoQualityOptions(
    [source, { ...source, id: "alt:1", codec: "h264", size: 957174115 }],
    {},
  );
  assert.deepEqual(
    options.map((item) => item.label),
    ["源文件 · 360p", "360p · H264"],
  );
  assert.match(options[0].description, /^640 × 360 · 916\.2 MB$/);
  assert.equal(options.length, 2);
});

test("浏览器解析尺寸纠正源元数据，未加载的备用版本仍保留API尺寸", () => {
  const options = videoQualityOptions(
    [source, { ...source, id: "alt:1", codec: "h264" }],
    { original: { width: 3840, height: 2160 } },
  );
  assert.equal(options[0].label, "源文件 · 2160p");
  assert.match(options[0].description, /^3840 × 2160/);
  assert.equal(options[1].label, "360p · H264");
});

test("竖屏4K和未知尺寸不会误标为0p或使用长边作为清晰度", () => {
  assert.equal(videoResolution({ width: 2160, height: 3840 }), "2160p");
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(videoResolution({ width, height: 1080 }), "分辨率未知");
});
