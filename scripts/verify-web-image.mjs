/**
 * 前端镜像交付检查：先确认 Compose 前端容器与实际镜像，再验证 Nginx 路由、资源和 Java 代理。
 * 全部请求仅访问本机，不读取口令、不登录、不修改业务数据；Vite 开发服务不能代替容器证据。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertLocalDockerEndpoint } from "./runtime-environment.mjs";

assertLocalDockerEndpoint();
const origin = new URL(
  process.env.WEB_IMAGE_ORIGIN ?? "http://127.0.0.1:15173",
);
assert(
  origin.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(origin.hostname) &&
    origin.pathname === "/" &&
    !origin.username &&
    !origin.password &&
    !origin.search &&
    !origin.hash,
  "前端镜像检查只允许不含凭证的本机地址",
);

/** Docker 参数固定；不执行页面内容、配置值或业务数据拼出的命令。 */
function docker(argumentsList) {
  const checked = spawnSync("docker", argumentsList, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  assert(!checked.error && checked.status === 0, "前端交付容器检查失败");
  return checked.stdout.trim();
}
const container = docker(["compose", "ps", "-q", "frontend"]);
assert(/^[a-f0-9]{12,64}$/.test(container), "需要本项目唯一运行中的前端容器");
const image = docker(["inspect", "--format", "{{.Image}}", container]);
assert(/^sha256:[a-f0-9]{64}$/.test(image), "前端容器缺少实际镜像摘要");
assert.equal(
  docker(["inspect", "--format", "{{.State.Running}}", container]),
  "true",
  "前端交付容器必须仍在运行",
);

/** 有限时的只读请求，错误只描述检查位置，不输出响应正文或配置内容。 */
async function request(path, expectedStatus = 200) {
  const response = await fetch(new URL(path, origin), {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(
    response.status,
    expectedStatus,
    "前端镜像路径状态不正确：" + path,
  );
  return response;
}
const home = await request("/");
assert.match(home.headers.get("content-type") ?? "", /text\/html/);
assert.equal(home.headers.get("x-frame-options"), "DENY");
assert.match(
  home.headers.get("content-security-policy") ?? "",
  /frame-ancestors 'none'/,
);
assert.equal(home.headers.get("x-content-type-options"), "nosniff");
const markup = await home.text();
assert.match(markup, /<div[^>]+id="root"/);
const script = /<script[^>]+src="(\/assets\/[^"?#]+\.js)"/.exec(markup)?.[1];
assert(script, "生产入口需要真实带摘要的脚本资源");
const javascript = await request(script);
assert.match(javascript.headers.get("content-type") ?? "", /javascript/);
assert.match(javascript.headers.get("cache-control") ?? "", /max-age=31536000/);
assert((await javascript.text()).length > 0, "入口脚本不能是空文件");
assert.equal(await (await request("/channels/guides")).text(), markup);
assert.equal(await (await request("/admin")).text(), markup);
const missing = await request("/assets/qa-missing-module.js", 404);
assert(
  !(await missing.text()).includes('id="root"'),
  "不存在的模块不能回退为入口 HTML",
);
const publicSite = await (await request("/api/public/site")).json();
assert(
  publicSite.success === true && publicSite.data,
  "Nginx 必须代理真实公开 Java 接口",
);
const protectedUsers = await request("/api/system/users", 401);
assert.match(protectedUsers.headers.get("content-type") ?? "", /json/);
assert(
  (await protectedUsers.json()).success === false,
  "匿名后台请求必须保留 Java 鉴权拒绝",
);
console.log(
  "前端镜像检查通过：容器、资源、深链接、缓存、安全头、公开代理及匿名鉴权；镜像 " +
    image,
);
