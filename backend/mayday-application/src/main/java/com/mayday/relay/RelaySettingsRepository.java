package com.mayday.relay;

import org.springframework.data.jpa.repository.JpaRepository;

/** 控制面固定单实例配置的存取入口；不承载高频 UDP 数据包或实时统计的持久化。 */
public interface RelaySettingsRepository extends JpaRepository<RelaySettings, Long> {}
