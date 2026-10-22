package com.mayday.telegram;

import com.mayday.common.util.ModuleSwitches;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Telegram 模块配置只注册惰性的部署属性。 TDLib 客户端将在模块启用且运行环境核验通过后由生命周期管理器创建。
 */
@Configuration
@EnableConfigurationProperties(TelegramSettings.class)
public class TelegramConfiguration
{
    /** 注册模块调用守卫；守卫自身不构造 TDLib/native 客户端，不产生外部连接。 */
    @Bean
    TelegramModuleGuard telegramModuleGuard(ModuleSwitches switches)
    {
        return new TelegramModuleGuard(switches);
    }
}
