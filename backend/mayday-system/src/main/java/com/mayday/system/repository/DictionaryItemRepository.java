package com.mayday.system.repository;

import com.mayday.system.model.DictionaryItem;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 字典项与类型独立存储；仓储查询不校验字典权限和类型归属，调用方必须先验证目标字典。 */
public interface DictionaryItemRepository
    extends JpaRepository<DictionaryItem, Long>, JpaSpecificationExecutor<DictionaryItem> {
  /** 删除字典类型前检查是否还有任何关联项，停用字典项也不能绕过引用保护。 */
  boolean existsByDictionaryId(Long dictionaryId);

  /** 只读取有效字典项并稳定排序，供已经获准使用该字典的表单选项接口调用。 */
  List<DictionaryItem> findByDictionaryIdAndEnabledTrueOrderBySortOrderAscIdAsc(Long dictionaryId);
}
