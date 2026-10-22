package com.mayday.telegram;

import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.util.ModuleSwitches;

/** 跨模块服务调用也必须执行开关检查，不能只依赖 HTTP 路径过滤。 */
final class TelegramModuleGuard
{
    private final ModuleSwitches switches;

    TelegramModuleGuard(ModuleSwitches switches)
    {
        this.switches = switches;
    }

    /** 模块关闭时统一返回 404，避免泄露模块是否安装或账号是否配置。 */
    void requireEnabled()
    {
        if (!switches.isEnabled("telegram"))
        {
            throw new ResourceNotFoundException("模块未启用");
        }
    }

    /** Allows periodic workers to stay silent and idle while the module is off. */
    boolean isEnabled()
    {
        return switches.isEnabled("telegram");
    }
}
