import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Alert, Button, Modal, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { tokenStore } from "../lib/api";

interface IdentityRecoveryCodesContextValue {
  /** 后端成功返回后交接本次恢复码，并立即结束已被撤销的旧会话。 */
  present: (recoveryCodes: readonly string[]) => void;
}

const IdentityRecoveryCodesContext =
  createContext<IdentityRecoveryCodesContextValue | null>(null);

/**
 * 恢复码只在路由上层的内存中保留一次，不进入 URL、浏览器存储或查询缓存。
 * 此 Provider 必须放在 AppearanceProvider 内、Application/Protected 外，不能按账号或路由设置 key。
 * 后端确认开通或轮换时已撤销会话；个人中心卸载、身份刷新及缓存清理都不能提前销毁待保存的明文。
 */
export function IdentityRecoveryCodesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const navigate = useNavigate();
  const present = useCallback(
    (recoveryCodes: readonly string[]) => {
      // 拷贝接口结果，避免调用方随后清理数组时改变已交接的恢复码。
      // 同一个同步调用内先交接到不随 Protected 卸载的上层，再结束会话；不等用户确认保存才清令牌。
      setCodes([...recoveryCodes]);
      tokenStore.clear();
      window.dispatchEvent(new Event("mayday:unauthorized"));
      navigate("/login", { replace: true });
    },
    [navigate],
  );
  return (
    <IdentityRecoveryCodesContext.Provider value={{ present }}>
      {children}
      {/* 确认时直接卸载敏感弹窗，避免 Modal 的关闭动画或内容缓存保留恢复码明文。 */}
      {codes !== null && (
        <Modal
          title="保存一次性恢复码"
          open
          closable={false}
          mask={{ closable: false }}
          keyboard={false}
          centered
          footer={
            <Button
              type="primary"
              onClick={() => {
                // 会话在 present 时已结束；确认只删除本次内存副本，不再发请求或重新建立登录。
                setCodes(null);
              }}
            >
              已安全保存
            </Button>
          }
        >
          <Alert
            type="warning"
            title="恢复码仅显示这一次。每个恢复码只能使用一次，不能代替登录密码；请存到独立安全位置。"
            description="现有登录会话已退出，保存完成后可以重新登录。"
          />
          <Typography.Paragraph
            copyable={{ text: codes.join("\n") }}
            style={{
              marginTop: 16,
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
            }}
          >
            {codes.join("\n")}
          </Typography.Paragraph>
        </Modal>
      )}
    </IdentityRecoveryCodesContext.Provider>
  );
}

/** 个人中心只交接接口刚返回的恢复码，展示生命周期由路由上层统一管理。 */
export function useIdentityRecoveryCodes() {
  const context = useContext(IdentityRecoveryCodesContext);
  if (!context) throw new Error("IdentityRecoveryCodesProvider 未挂载");
  return context;
}
