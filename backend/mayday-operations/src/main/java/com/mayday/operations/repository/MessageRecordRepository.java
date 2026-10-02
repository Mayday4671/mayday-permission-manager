package com.mayday.operations.repository;

import com.mayday.operations.model.MessageRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 站内信按收件人独立保存已读状态；发件人与接收者均由服务端校验。 数据访问层。 */
public interface MessageRecordRepository
    extends JpaRepository<MessageRecord, Long>, JpaSpecificationExecutor<MessageRecord> {
  long countByRecipientIdAndReadAtIsNull(Long recipientId);
}
