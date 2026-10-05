/**
 * 路由和渲染异常共用的恢复界面。只使用原生元素，不依赖可能已经失效的身份、主题或组件上下文。
 * 不展示异常消息、源码路径或堆栈；重新加载走正常入口和身份校验，不清空用户数据或绕过登录。
 */
export function PageFailure() {
  return (
    <main className="page-failure" aria-labelledby="page-failure-title">
      <section role="alert">
        <h1 id="page-failure-title">页面加载失败</h1>
        <p>请重新加载页面。如果问题持续，请联系管理员。</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </section>
    </main>
  );
}
