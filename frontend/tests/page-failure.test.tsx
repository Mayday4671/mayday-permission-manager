import { JSDOM } from "jsdom";
import test, { after } from "node:test";
import assert from "node:assert/strict";

/** 实际数据路由抛错回归：恢复页不能依赖故障上下文，也不能把内部异常正文显示给用户。 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { render, screen, cleanup } = await import("@testing-library/react");
const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
const { PageFailure } = await import("../src/components/PageFailure");
after(() => {
  cleanup();
  dom.window.close();
});

test("路由加载失败保留恢复按钮且不显示内部异常", async () => {
  const internalMarker = "INTERNAL_FAILURE_DETAIL_NOT_FOR_UI";
  const router = createMemoryRouter([
    {
      path: "/",
      loader: () => {
        throw new Error(internalMarker);
      },
      element: <div>正常内容</div>,
      errorElement: <PageFailure />,
      hydrateFallbackElement: <div>正在加载</div>,
    },
  ]);
  try {
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "页面加载失败" });
    assert(screen.getByRole("button", { name: "重新加载" }));
    assert.equal(document.body.textContent?.includes(internalMarker), false);
    assert.equal(
      document.body.textContent?.includes("Unexpected Application Error"),
      false,
    );
    assert.equal(screen.queryByText("正常内容"), null);
  } finally {
    cleanup();
    router.dispose();
  }
});
