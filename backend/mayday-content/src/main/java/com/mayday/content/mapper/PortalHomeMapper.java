package com.mayday.content.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.content.PortalHome;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 首页配置的乐观版本与栏目、文章版本分开，不因修改主题覆盖其他人的内容编排。 */
@Mapper
public interface PortalHomeMapper extends EntityMapper<PortalHome> {
  /** 配置写入统一锁定单例，阻止并发将同一分类分配到不同栏目；不会修改首页编排版本。 */
  default Optional<PortalHome> lockConfiguration() {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(1L)).forUpdate()));
  }
}
