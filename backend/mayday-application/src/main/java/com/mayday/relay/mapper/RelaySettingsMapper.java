package com.mayday.relay.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.relay.RelaySettings;
import org.apache.ibatis.annotations.Mapper;

/** 控制面固定单实例配置的存取入口；不承载高频 UDP 数据包或实时统计的持久化。 */
@Mapper
public interface RelaySettingsMapper extends EntityMapper<RelaySettings> {}
