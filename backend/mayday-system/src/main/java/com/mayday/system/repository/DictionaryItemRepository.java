package com.mayday.system.repository;

import com.mayday.system.model.DictionaryItem;
import java.util.List;
import org.springframework.data.jpa.repository.*;

public interface DictionaryItemRepository
    extends JpaRepository<DictionaryItem, Long>, JpaSpecificationExecutor<DictionaryItem> {
  boolean existsByDictionaryId(Long dictionaryId);

  List<DictionaryItem> findByDictionaryIdAndEnabledTrueOrderBySortOrderAscIdAsc(Long dictionaryId);
}
