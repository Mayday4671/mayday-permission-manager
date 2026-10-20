package com.mayday.operations.mapper;

import com.mayday.operations.model.FilePayload;
import com.mybatisflex.core.BaseMapper;
import java.io.Serializable;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 历史 MySQL 正文按文件 ID 单条读取，禁止文件列表联查 LOB；主键与文件元信息一致。 */
@Mapper
public interface FilePayloadMapper extends BaseMapper<FilePayload> {
  /** 主键由文件元信息决定：不存在则带主键插入，存在则整行覆盖。 */
  default FilePayload save(FilePayload payload) {
    if (selectOneById(payload.getId()) == null) {
      insertWithPk(payload, false);
    } else {
      update(payload, false);
    }
    return payload;
  }

  /** 按文件 ID 载入正文；不存在返回空。 */
  default Optional<FilePayload> findById(Serializable id) {
    return Optional.ofNullable(selectOneById(id));
  }
}
