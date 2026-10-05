package com.mayday.operations.realtime;

import java.util.Collection;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 面向账号的轻量刷新事件。只传资源名称，业务正文必须由客户端重新调用受保护接口获取。 事务中发布的事件由流服务在提交成功后发送，因此不会显示随后回滚的待办或消息。 */
@Service
@RequiredArgsConstructor
public class RealtimeEvents {
  private final RealtimeJournal journal;

  /** 收件账号来自服务端业务结果，不能直接使用未经授权的页面用户列表。 */
  public void changed(Collection<Long> recipientIds, String... topics) {
    if (recipientIds.isEmpty()) return;
    journal.append(recipientIds, topics);
  }

  /** 同一次业务提交合并账号和主题，事件本身不包含令牌、人员资料或业务数据。 */
  public record Change(Set<Long> recipientIds, Set<String> topics) {}
}
