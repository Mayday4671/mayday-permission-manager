package com.mayday.content;

import java.util.List;
import org.springframework.data.jpa.repository.*;

public interface ContentPublicationRepository
    extends JpaRepository<ContentPublication, Long>, JpaSpecificationExecutor<ContentPublication> {
  List<ContentPublication> findByNoticeIdAndOfflineAtIsNull(Long noticeId);

  void deleteByNoticeId(Long noticeId);
}
