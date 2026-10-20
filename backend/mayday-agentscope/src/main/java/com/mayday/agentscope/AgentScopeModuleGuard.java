package com.mayday.agentscope;

import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.util.ModuleSwitches;

/** 让跨模块直接调用也遵守启动开关，不能只依赖控制器路径过滤。 */
final class AgentScopeModuleGuard {
  private final ModuleSwitches switches;

  AgentScopeModuleGuard(ModuleSwitches switches) {
    this.switches = switches;
  }

  /** 关闭模块时与路由层一致返回未找到，不泄露已安装的模块接口。 */
  void requireEnabled() {
    if (!switches.isEnabled("agentscope")) {
      throw new ResourceNotFoundException("模块未启用");
    }
  }
}
