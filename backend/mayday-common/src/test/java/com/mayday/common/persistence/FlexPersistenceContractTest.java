package com.mayday.common.persistence;

import java.util.List;
import java.util.Optional;

import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.table.TableInfo;
import com.mybatisflex.core.table.TableInfoFactory;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.dao.OptimisticLockingFailureException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;

/** 迁移到 MyBatis-Flex 后的公共查询构件回归：列名映射、转义条件渲染与保存门面的乐观锁语义。 */
class FlexPersistenceContractTest
{

    @Test
    void entityColumnsFollowSnakeCaseAndCarryAuditColumns()
    {
        TableInfo info = TableInfoFactory.ofEntityClass(ContractSampleEntity.class);
        assertEquals("contract_sample", info.getTableName());
        List<String> columns = List.of(info.getColumns());
        for (String expected : List.of("user_name", "department_id", "created_at", "updated_at"))
        {
            assertEquals(true, columns.contains(expected), "缺少列映射: " + expected);
        }
        assertEquals("version", info.getVersionColumn());
    }

    @Test
    void keywordConditionBindsEscapedLiteralWithExplicitEscape()
    {
        QueryWrapper wrapper = QueryWrapper.create()
                .where(SearchPredicates.contains("user_name", "a%b_c!").and(new VisibleRaw("department_id = ?", 7L)));
        String sql = wrapper.toSQL();
        assertEquals(true, sql.toLowerCase().contains("escape '!'"), sql);
        assertEquals(true, sql.contains("a!%b!_c!!"), sql);
    }

    @Test
    void saveInsertsNewEntityAndUpdatesExistingWithOptimisticLock()
    {
        EntityMapper<ContractSampleEntity> repository = Mockito.mock(EntityMapper.class,
                Mockito.withSettings().defaultAnswer(Mockito.CALLS_REAL_METHODS));

        ContractSampleEntity created = new ContractSampleEntity();
        Mockito.doReturn(1).when(repository).insert(any(ContractSampleEntity.class), Mockito.anyBoolean());
        repository.save(created);
        Mockito.verify(repository).insert(any(ContractSampleEntity.class), Mockito.anyBoolean());

        ContractSampleEntity existing = new ContractSampleEntity();
        existing.setId(5L);
        existing.setVersion(3L);
        Mockito.doReturn(1).when(repository).update(any(), Mockito.anyBoolean());
        repository.save(existing);
        Mockito.verify(repository).update(any(), Mockito.eq(false));

        Mockito.doReturn(0).when(repository).update(any(), Mockito.anyBoolean());
        assertThrows(OptimisticLockingFailureException.class, () -> repository.save(existing));
    }

    @Test
    void pageRequestNormalizesUntrustedPagination()
    {
        var page = PageResult.request(0, 500);
        assertEquals(1, page.getPageNumber());
        assertEquals(100, page.getPageSize());
        assertEquals(2, PageResult.request(2, 10).getPageNumber());
    }

    @Test
    void containsTreatsNullKeywordAsMatchAll()
    {
        QueryWrapper wrapper = QueryWrapper.create().where(SearchPredicates.contains("user_name", null));
        String sql = wrapper.toSQL();
        assertEquals(true, sql.contains("%"), sql);
    }

    @Test
    void anyOfJoinsConditionsWithOr()
    {
        QueryWrapper wrapper = QueryWrapper.create().where(new VisibleRaw("department_id = ?", 1L));
        SearchPredicates.anyOf(wrapper, SearchPredicates.contains("user_name", "kw"),
                SearchPredicates.contains("name", null));
        String sql = wrapper.toSQL();
        assertEquals(true, sql.toLowerCase().contains(" or "), sql);
    }

    @Test
    void mockitoCanStillMockEntityMapperForUnitTests()
    {
        EntityMapper<ContractSampleEntity> repository = mock(EntityMapper.class);
        Mockito.when(repository.findById(1L)).thenReturn(Optional.of(new ContractSampleEntity()));
        assertEquals(true, repository.findById(1L).isPresent());
    }

    /** RawQueryCondition 为公共 API；可见包装只为保持断言阅读性。 */
    private static final class VisibleRaw extends com.mybatisflex.core.query.RawQueryCondition
    {
        VisibleRaw(String content, Object... params)
        {
            super(content, params);
        }
    }
}
