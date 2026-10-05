import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";

// 使用真实 Ant 表单交互验证认证边界，合成请求不会接触实际身份提供商或日常数据库。
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLBodyElement",
  "HTMLHtmlElement",
  "Document",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "Element",
  "SVGElement",
  "ShadowRoot",
  "Node",
  "MutationObserver",
  "localStorage",
  "sessionStorage",
  "Event",
  "MouseEvent",
  "StorageEvent",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
globalThis.innerWidth = 1366;
globalThis.innerHeight = 800;
globalThis.scrollX = 0;
globalThis.scrollY = 0;
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
    queueMicrotask(() => {
      this.port1.unref();
      this.port2.unref();
    });
  }
};
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
});
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const React = await import("react");
const { render, screen, within, waitFor, cleanup, act } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router-dom");
const { AuthProvider, useAuth } = await import("../src/lib/auth");
const { IdentityMfaVerify } =
  await import("../src/components/IdentityMfaVerify");
const { IdentitySecurityPanel } =
  await import("../src/components/IdentitySecurityPanel");
const { IdentityResetMfa } = await import("../src/components/IdentityResetMfa");
const { OidcCallbackPage } = await import("../src/pages/OidcCallbackPage");
type IdentityProvider = import("../src/lib/identity").IdentityProvider;
type IdentityBinding = import("../src/lib/identity").IdentityBinding;
const originalFetch = globalThis.fetch;
const calls: { path: string; body?: Record<string, unknown> }[] = [];
const clients: InstanceType<typeof QueryClient>[] = [];
let enabled = false,
  rejectVerification = false;
let identityProviders: IdentityProvider[] = [
  { id: "company", name: "公司身份" },
];
let identityBindings: IdentityBinding[] = [];
const recoveryCodes = [
  "11111111-22222222-33333333-44444444",
  "55555555-66666666-77777777-88888888",
];
const enrollment = {
  challengeId: "enrollment-challenge",
  secret: "JBSWY3DPEHPK3PXP",
  provisioningUri:
    "otpauth://totp/Mayday:synthetic?secret=JBSWY3DPEHPK3PXP&issuer=Mayday",
};
globalThis.fetch = async (input, options) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    "http://localhost",
  );
  const raw =
    typeof options?.body === "string"
      ? options.body
      : input instanceof Request && input.method !== "GET"
        ? await input.clone().text()
        : "";
  const body = raw ? JSON.parse(raw) : undefined;
  calls.push({ path: url.pathname, body });
  let data: unknown;
  if (url.pathname === "/api/auth/me")
    data = {
      user: { id: 101, nickname: "测试成员" },
      permissions: [],
      dataScopes: {},
      scopeDepartments: {},
    };
  else if (url.pathname === "/api/auth/login")
    data = { token: null, mfaRequired: true, challengeId: "primary-challenge" };
  else if (url.pathname === "/api/auth/identity/mfa")
    data = {
      available: true,
      enabled,
      recoveryCodesRemaining: enabled ? 10 : 0,
    };
  else if (url.pathname === "/api/auth/identity/providers")
    data = identityProviders;
  else if (url.pathname === "/api/auth/identity/bindings")
    data = identityBindings;
  else if (url.pathname === "/api/auth/identity/oidc/complete")
    data = {
      bound: false,
      login: {
        token: null,
        mfaRequired: true,
        challengeId: "enterprise-challenge",
      },
    };
  else if (url.pathname === "/api/auth/identity/mfa/enroll") data = enrollment;
  else if (
    url.pathname === "/api/auth/identity/mfa/confirm" ||
    url.pathname === "/api/auth/identity/mfa/recovery"
  )
    data = recoveryCodes;
  else if (url.pathname === "/api/auth/identity/mfa/verify") {
    if (rejectVerification)
      return Response.json(
        { success: false, message: "验证码错误或已使用" },
        { status: 400 },
      );
    data = {
      token: "synthetic-complete-session",
      mfaRequired: false,
      challengeId: null,
    };
  } else if (url.pathname === "/api/auth/identity/users/202/mfa/reset")
    data = null;
  else throw new Error("未登记的身份组件请求：" + url.pathname);
  return Response.json({ success: true, data });
};
function mount(children: React.ReactNode, session = false) {
  if (session)
    sessionStorage.setItem("mayday.session", "synthetic-current-session");
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <MemoryRouter>
            <AuthProvider>{children}</AuthProvider>
          </MemoryRouter>
        </App>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}
afterEach(async () => {
  cleanup();
  // 等 React Query 的批量观察者通知撤销订阅，再清理缓存及其 GC 定时器。
  await new Promise((resolve) => setTimeout(resolve, 50));
  clients.splice(0).forEach((client) => client.clear());
  sessionStorage.clear();
  localStorage.clear();
  calls.length = 0;
  enabled = false;
  rejectVerification = false;
  identityProviders = [{ id: "company", name: "公司身份" }];
  identityBindings = [];
  window.history.replaceState(null, "", "/");
});

/** 已有绑定使用可读名称快照，测试不伪造外部 subject 或其他账号的绑定关系。 */
function boundProvider(
  providerId: string,
  providerName: string,
): IdentityBinding {
  return {
    id: "binding-" + providerId,
    providerId,
    providerName,
    createdAt: "2026-10-05T00:00:00Z",
  };
}

test("全部企业方式已绑定时保留解除入口，不展示无选项的新增绑定弹窗", async () => {
  identityBindings = [boundProvider("company", "公司身份")];
  mount(<IdentitySecurityPanel />, true);
  await screen.findByText("公司身份");
  assert(screen.getByRole("button", { name: "解除绑定" }));
  assert.equal(screen.queryByRole("button", { name: "绑定登录方式" }), null);
  assert.equal(screen.queryByRole("dialog", { name: "绑定企业身份" }), null);
  assert(!calls.some((call) => call.path.endsWith("/oidc/bind")));
});

for (const change of ["提供方停用", "其他会话完成绑定"] as const)
  test(`绑定弹窗随${change}刷新选项，清除失效选择并在无选项时关闭`, async () => {
    identityProviders = [
      { id: "company", name: "公司身份" },
      { id: "division", name: "分部身份" },
      { id: "partner", name: "合作身份" },
    ];
    identityBindings = [boundProvider("company", "公司身份")];
    const user = userEvent.setup();
    mount(<IdentitySecurityPanel />, true);
    await user.click(
      await screen.findByRole("button", { name: "绑定登录方式" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "绑定企业身份" });
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "分部身份" }));
    assert.equal(screen.queryByRole("option", { name: "公司身份" }), null);
    await user.type(
      within(dialog).getByLabelText("当前本地密码"),
      "SyntheticPassword_2026!",
    );
    const client = clients.at(-1)!;
    await act(async () => {
      if (change === "提供方停用")
        client.setQueryData(
          ["identity-providers"],
          identityProviders.filter((provider) => provider.id !== "division"),
        );
      else
        client.setQueryData(
          ["identity-bindings"],
          [...identityBindings, boundProvider("division", "分部身份")],
        );
      // React Query 在宏任务中批量通知观察者；让真实通知完成后再断言 Ant 表单变化。
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await waitFor(() =>
      assert.equal(within(dialog).queryByText("分部身份"), null),
    );
    await user.click(within(dialog).getByRole("button", { name: /确\s*认/ }));
    await within(dialog).findByText("请选择企业登录方式");
    assert(!calls.some((call) => call.path.endsWith("/oidc/bind")));
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "合作身份" }));
    await act(async () => {
      client.setQueryData(
        ["identity-bindings"],
        identityProviders.map((provider) =>
          boundProvider(provider.id, provider.name),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await waitFor(() =>
      assert.equal(
        screen.queryByRole("dialog", { name: "绑定企业身份" }),
        null,
      ),
    );
    assert.equal(screen.queryByRole("button", { name: "绑定登录方式" }), null);
    await act(async () => {
      client.setQueryData(
        ["identity-providers"],
        [...identityProviders, { id: "new-company", name: "新企业身份" }],
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await user.click(
      await screen.findByRole("button", { name: "绑定登录方式" }),
    );
    const reopened = await screen.findByRole("dialog", {
      name: "绑定企业身份",
    });
    assert.equal(
      (within(reopened).getByLabelText("当前本地密码") as HTMLInputElement)
        .value,
      "",
    );
    await user.click(within(reopened).getByRole("combobox"));
    assert(await screen.findByRole("option", { name: "新企业身份" }));
    assert(!calls.some((call) => call.path.endsWith("/oidc/bind")));
  });
after(async () => {
  globalThis.fetch = originalFetch;
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

test("首因素完成只得到短期挑战，不建立会话，完整 MFA 证明后才接纳令牌", async () => {
  let begin: (() => Promise<unknown>) | undefined,
    complete:
      | ((value: { token: string; mfaRequired: boolean }) => Promise<void>)
      | undefined;
  function Harness() {
    const auth = useAuth();
    begin = () =>
      auth.login("synthetic", "SyntheticPassword_2026!", "captcha-proof");
    complete = auth.completeLogin;
    return <span>{auth.session ? "已登录" : "未登录"}</span>;
  }
  mount(<Harness />);
  await waitFor(() => assert(begin));
  const first = await begin!();
  assert.deepEqual(first, {
    token: null,
    mfaRequired: true,
    challengeId: "primary-challenge",
  });
  assert.equal(sessionStorage.getItem("mayday.session"), null);
  await assert.rejects(
    complete!({ token: "must-not-store", mfaRequired: true }),
    /身份验证尚未完成/,
  );
  assert.equal(sessionStorage.getItem("mayday.session"), null);
  await act(async () => {
    await complete!({
      token: "synthetic-complete-session",
      mfaRequired: false,
    });
  });
  await screen.findByText("已登录");
  assert.equal(
    sessionStorage.getItem("mayday.session"),
    "synthetic-complete-session",
  );
});

test("二次验证提交挑战与因素，错误保留输入且不触发登录成功", async () => {
  rejectVerification = true;
  let verified = 0,
    cancelled = 0;
  const user = userEvent.setup();
  mount(
    <IdentityMfaVerify
      challengeId="primary-challenge"
      onVerified={async () => {
        verified++;
      }}
      onCancel={() => {
        cancelled++;
      }}
    />,
  );
  await user.type(screen.getByLabelText("身份验证码或恢复码"), "123456");
  await user.click(screen.getByRole("button", { name: "验证并登录" }));
  await screen.findByText("验证码错误或已使用");
  assert.equal(verified, 0);
  assert.equal(
    (screen.getByLabelText("身份验证码或恢复码") as HTMLInputElement).value,
    "123456",
  );
  assert.deepEqual(
    calls.find((call) => call.path.endsWith("/mfa/verify"))?.body,
    { challengeId: "primary-challenge", factor: "123456" },
  );
  rejectVerification = false;
  await user.click(screen.getByRole("button", { name: "验证并登录" }));
  await waitFor(() => assert.equal(verified, 1));
  await user.click(screen.getByRole("button", { name: "重新登录" }));
  assert.equal(cancelled, 1);
});

test("认证器开通分两阶段，恢复码仅在当前弹窗显示，确认保管后清除旧会话", async () => {
  const user = userEvent.setup();
  mount(<IdentitySecurityPanel />, true);
  await user.click(
    await screen.findByRole("button", { name: "开通认证器验证" }),
  );
  const proof = await screen.findByRole("dialog", { name: "开通多因素认证" });
  await user.type(
    within(proof).getByLabelText("当前本地密码"),
    "SyntheticPassword_2026!",
  );
  await user.click(within(proof).getByRole("button", { name: /确\s*认/ }));
  const scan = await screen.findByRole("dialog", { name: "扫描并确认开通" });
  assert(!calls.some((call) => call.path.endsWith("/mfa/confirm")));
  assert(within(scan).getByText("手动密钥：" + enrollment.secret));
  await user.type(within(scan).getByLabelText("6 位动态验证码"), "123456");
  await user.click(within(scan).getByRole("button", { name: "确认开通" }));
  const saved = await screen.findByRole("dialog", { name: "保存一次性恢复码" });
  assert.deepEqual(
    calls.find((call) => call.path.endsWith("/mfa/confirm"))?.body,
    { challengeId: enrollment.challengeId, factor: "123456" },
  );
  assert(saved.textContent?.includes(recoveryCodes[0]));
  assert(
    !JSON.stringify({ ...sessionStorage, ...localStorage }).includes(
      enrollment.secret,
    ),
  );
  assert(
    !JSON.stringify({ ...sessionStorage, ...localStorage }).includes(
      recoveryCodes[0],
    ),
  );
  assert.equal(
    sessionStorage.getItem("mayday.session"),
    "synthetic-current-session",
  );
  await user.click(
    within(saved).getByRole("button", { name: "已安全保存，重新登录" }),
  );
  await waitFor(() =>
    assert.equal(sessionStorage.getItem("mayday.session"), null),
  );
});

test("管理员恢复使用管理者自己的 MFA 证明和理由，目标账号由路径指定", async () => {
  enabled = true;
  const user = userEvent.setup();
  mount(
    <IdentityResetMfa
      user={{ id: 202, nickname: "目标成员" } as import("../src/types").User}
    />,
    true,
  );
  await user.click(screen.getByRole("button", { name: "恢复多因素认证" }));
  const dialog = await screen.findByRole("dialog", {
    name: "恢复 目标成员 的多因素认证",
  });
  await user.type(
    within(dialog).getByLabelText("你的当前密码"),
    "SyntheticPassword_2026!",
  );
  await user.type(
    await within(dialog).findByLabelText("你的认证器验证码或恢复码"),
    "123456",
  );
  await user.type(
    within(dialog).getByLabelText("恢复理由"),
    "已确认遗失认证器并核实身份",
  );
  await user.click(within(dialog).getByRole("button", { name: "确认恢复" }));
  await waitFor(() =>
    assert(calls.some((call) => call.path.endsWith("/202/mfa/reset"))),
  );
  assert.deepEqual(
    calls.find((call) => call.path.endsWith("/202/mfa/reset"))?.body,
    {
      password: "SyntheticPassword_2026!",
      factor: "123456",
      reason: "已确认遗失认证器并核实身份",
    },
  );
  await screen.findByText(
    "多因素认证已恢复，目标账号会退出现有会话并需重新开通",
  );
});

test("OIDC 回调立即清除 code/state，StrictMode 只交换一次，MFA 完成前不保存令牌", async () => {
  window.history.replaceState(
    null,
    "",
    "/auth/oidc/callback?code=synthetic-code&state=synthetic-state",
  );
  const user = userEvent.setup();
  mount(
    <React.StrictMode>
      <OidcCallbackPage />
    </React.StrictMode>,
  );
  await screen.findByLabelText("身份验证码或恢复码");
  assert.equal(window.location.search, "");
  const exchange = calls.filter((call) => call.path.endsWith("/oidc/complete"));
  assert.equal(exchange.length, 1);
  assert.deepEqual(exchange[0].body, {
    code: "synthetic-code",
    state: "synthetic-state",
  });
  assert.equal(sessionStorage.getItem("mayday.session"), null);
  await user.type(screen.getByLabelText("身份验证码或恢复码"), "123456");
  await user.click(screen.getByRole("button", { name: "验证并登录" }));
  await waitFor(() =>
    assert.equal(
      sessionStorage.getItem("mayday.session"),
      "synthetic-complete-session",
    ),
  );
  assert.equal(
    calls.filter((call) => call.path.endsWith("/oidc/complete")).length,
    1,
  );
});

test("OIDC 取消授权不交换 code，也不在界面保留提供方错误参数", async () => {
  window.history.replaceState(
    null,
    "",
    "/auth/oidc/callback?error=access_denied&error_description=sensitive-description",
  );
  mount(<OidcCallbackPage />);
  await screen.findByText("企业授权已取消或回调不完整，请重新开始");
  assert.equal(window.location.search, "");
  assert(!document.body.textContent?.includes("sensitive-description"));
  assert(!calls.some((call) => call.path.endsWith("/oidc/complete")));
});
