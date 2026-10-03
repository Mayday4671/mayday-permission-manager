package com.mayday;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mayday.common.BusinessException;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.repository.FlowDefinitionRepository;
import com.mayday.operations.repository.FlowRequestRepository;
import com.mayday.operations.repository.FlowVersionRepository;
import com.mayday.operations.workflow.WorkflowDefinitions;
import com.mayday.operations.workflow.WorkflowJson;
import com.mayday.operations.workflow.WorkflowSchema;
import com.mayday.operations.workflow.WorkflowSchema.Condition;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

/** 表单设计改变选项不能静默破坏运行条件。只调用纯模型验证与路由，覆盖直接接口也要 遵守的发布契约；不启动 Spring、数据库或服务，不创建任何业务申请。 */
class WorkflowFormSchemaTest {
  /** EQ/NE 必须使用现有完整选项值，含空格的旧值不能在设计时被自动 trim。 */
  @Test
  void existingExactChoiceValuesRemainValidAndKeepTheirRouting() {
    for (String operator : List.of("EQ", "NE")) {
      Spec schema = schema(List.of(" 差旅 ", "采购"), operator, " 差旅 ");
      assertDoesNotThrow(() -> WorkflowSchema.validate(schema));
      Node condition = schema.node("choice");
      assertEquals(
          "EQ".equals(operator) ? "matched" : "end",
          WorkflowSchema.next(condition, Map.of("kind", " 差旅 ")));
      assertEquals(
          "EQ".equals(operator) ? "end" : "matched",
          WorkflowSchema.next(condition, Map.of("kind", "采购")));
    }
  }

  /** 删除或重命名选项后，EQ 不得变为永不命中，NE 不得变为对合法值永真。 */
  @Test
  void renamedOrRemovedChoiceValuesBlockBothEqualityOperators() {
    for (String operator : List.of("EQ", "NE")) {
      BusinessException error =
          assertThrows(
              BusinessException.class,
              () -> WorkflowSchema.validate(schema(List.of("服务", "采购"), operator, "差旅")));
      assertTrue(error.getMessage().contains("类型判断"));
      assertTrue(error.getMessage().contains("申请类型"));
      assertTrue(error.getMessage().contains("选项已不存在"));
    }
  }

  /** 原选项带空格时，比较值不带空格也不是同一值；配置端不能自行替换原值。 */
  @Test
  void trimmedComparisonCannotMasqueradeAsTheOriginalOption() {
    assertThrows(
        BusinessException.class,
        () -> WorkflowSchema.validate(schema(List.of(" 差旅 ", "采购"), "EQ", "差旅")));
  }

  /** CONTAINS 合法地匹配选项子串，与 EQ/NE 的完整选项成员校验区分。 */
  @Test
  void containsMayStillCompareAnOptionSubstring() {
    Spec schema = schema(List.of("国内差旅", "设备采购"), "CONTAINS", "差旅");
    assertDoesNotThrow(() -> WorkflowSchema.validate(schema));
    assertEquals("matched", WorkflowSchema.next(schema.node("choice"), Map.of("kind", "国内差旅")));
    assertEquals("end", WorkflowSchema.next(schema.node("choice"), Map.of("kind", "设备采购")));
  }

  /** 文字字段仍允许任意文本比较，不能把单选成员限制错误扩展到其他字段类型。 */
  @Test
  void textComparisonDoesNotRequireAnOptionCollection() {
    Spec choice = schema(List.of("差旅", "采购"), "EQ", "临时申请");
    Field text = new Field("kind", "申请类型", "TEXT", false, null, null, null, null, null);
    Spec schema =
        new Spec(
            List.of(text),
            choice.nodes(),
            choice.startNodeId(),
            "ALL",
            Set.of(),
            false,
            false,
            true);
    assertDoesNotThrow(() -> WorkflowSchema.validate(schema));
    assertEquals("matched", WorkflowSchema.next(schema.node("choice"), Map.of("kind", "临时申请")));
  }

  /** 新草稿保存只增加本次引用检查，仍允许尚未填写人员、起点或连线的模型。 */
  @Test
  void draftChoiceCheckRejectsStaleValuesWithoutRequiringACompleteGraph() {
    Spec invalid = schema(List.of("服务", "采购"), "EQ", "差旅");
    assertThrows(BusinessException.class, () -> WorkflowSchema.validateChoiceReferences(invalid));
    assertThrows(BusinessException.class, () -> WorkflowSchema.validateDraft(invalid));
    Spec incomplete = new Spec(List.of(), List.of(), "", "ALL", Set.of(), false, false, true);
    assertDoesNotThrow(() -> WorkflowSchema.validateDraft(incomplete));
  }

  /** 字段先校验再查条件；未配置 ID 的字段返回业务错误，不能在 stream 中触发空指针。 */
  @Test
  void draftValidationRejectsMalformedFieldsBeforeReadingTheirConditionReferences() {
    Spec choice = schema(List.of("差旅", "采购"), "EQ", "差旅");
    Field missingId =
        new Field(null, "申请类型", "SINGLE", true, null, null, null, null, List.of("差旅"));
    Spec invalid =
        new Spec(List.of(missingId), choice.nodes(), "", "ALL", Set.of(), false, false, true);
    BusinessException error =
        assertThrows(BusinessException.class, () -> WorkflowSchema.validateDraft(invalid));
    assertTrue(error.getMessage().contains("字段 ID"));
    assertDoesNotThrow(() -> WorkflowSchema.validateChoiceReferences(invalid));
  }

  /** 完整的表单不意味着节点设计也已完成；草稿暂存不得要求审批人员或出口已配置。 */
  @Test
  void validFieldsMayBeSavedWhileApprovalNodesAreStillIncomplete() {
    Field text = new Field("reason", "申请说明", "TEXTAREA", true, 24, null, null, 2000, null);
    Node unfinished =
        new Node(
            null,
            "未完成审批",
            "APPROVAL",
            null,
            null,
            List.of(),
            null,
            Set.of(),
            Set.of(),
            Set.of(),
            List.of());
    Spec draft =
        new Spec(List.of(text), List.of(unfinished), "", "ALL", Set.of(), false, false, true);
    assertDoesNotThrow(() -> WorkflowSchema.validateDraft(draft));
    assertThrows(BusinessException.class, () -> WorkflowSchema.validate(draft));
  }

  /** 旧退回申请重提只接受库中冻结的快照 ID。旧失效单选比较保留 EQ/NE 原路由， 但同一模型从客户端模拟或新发布校验入口进入仍被拒绝。 */
  @Test
  void storedLegacySnapshotKeepsOldRoutesButClientSchemaCannotUseRuntimeCompatibility() {
    for (String operator : List.of("EQ", "NE")) {
      Spec legacy = schema(List.of("服务", "采购"), operator, "差旅");
      var fixture = stored(legacy);
      assertEquals(
          Map.of("review", List.of(1L)),
          fixture.definitions().resolveStoredSnapshot(42L, fixture.applicant()));
      assertThrows(
          BusinessException.class,
          () -> fixture.definitions().resolve(legacy, fixture.applicant()));
      assertThrows(BusinessException.class, () -> fixture.definitions().validateReferences(legacy));
      assertEquals(
          "EQ".equals(operator) ? "end" : "matched",
          WorkflowSchema.next(legacy.node("choice"), Map.of("kind", "服务")));
    }
  }

  /** 兼容只豁免新增的单选成员检查；旧循环图或越界字段授权仍不得执行。 */
  @Test
  void storedSnapshotStillRejectsCyclesAndUnknownReadableFields() {
    Spec legacy = schema(List.of("服务", "采购"), "EQ", "差旅");
    Node original = legacy.node("choice");
    Node cycle =
        new Node(
            original.id(),
            original.name(),
            original.type(),
            "choice",
            original.source(),
            original.assigneeIds(),
            original.mode(),
            original.readable(),
            original.writable(),
            original.actions(),
            original.conditions());
    Spec cyclic =
        new Spec(
            legacy.fields(),
            List.of(legacy.node("review"), cycle, legacy.node("matched"), legacy.node("end")),
            "review",
            "ALL",
            Set.of(),
            false,
            false,
            true);
    var cycleFixture = stored(cyclic);
    BusinessException cycleError =
        assertThrows(
            BusinessException.class,
            () -> cycleFixture.definitions().resolveStoredSnapshot(42L, cycleFixture.applicant()));
    assertTrue(cycleError.getMessage().contains("循环"));
    Node review = legacy.node("review");
    Node unknown =
        new Node(
            review.id(),
            review.name(),
            review.type(),
            review.next(),
            review.source(),
            review.assigneeIds(),
            review.mode(),
            Set.of("undeclared"),
            Set.of(),
            review.actions(),
            review.conditions());
    Spec unauthorized =
        new Spec(
            legacy.fields(),
            List.of(unknown, legacy.node("choice"), legacy.node("matched"), legacy.node("end")),
            "review",
            "ALL",
            Set.of(),
            false,
            false,
            true);
    var fieldFixture = stored(unauthorized);
    BusinessException fieldError =
        assertThrows(
            BusinessException.class,
            () -> fieldFixture.definitions().resolveStoredSnapshot(42L, fieldFixture.applicant()));
    assertTrue(fieldError.getMessage().contains("字段必须存在"));
  }

  /** 知道其他实例 ID 不能调用快照兼容入口，申请人的归属与当前审批权限仍受保护。 */
  @Test
  void snapshotResolutionRejectsAnotherApplicantAndRevokedApproverPermission() {
    var fixture = stored(schema(List.of("服务", "采购"), "EQ", "差旅"));
    SysUser other = new SysUser();
    other.setId(3L);
    assertThrows(
        AccessDeniedException.class, () -> fixture.definitions().resolveStoredSnapshot(42L, other));
    when(fixture.access().hasFor(fixture.approver(), "requests:approve")).thenReturn(false);
    assertThrows(
        BusinessException.class,
        () -> fixture.definitions().resolveStoredSnapshot(42L, fixture.applicant()));
  }

  /** Repository 模拟只提供已存实例；真实 JSON 编码器保持冻结模型，不接受参数模型替换。 */
  private StoredFixture stored(Spec schema) {
    FlowRequestRepository requests = mock(FlowRequestRepository.class);
    UserRepository users = mock(UserRepository.class);
    AccessPolicy access = mock(AccessPolicy.class);
    WorkflowJson json = new WorkflowJson();
    FlowRequest request = new FlowRequest();
    request.setId(42L);
    request.setApplicantId(2L);
    request.setSchemaSnapshot(json.write(schema));
    when(requests.findById(42L)).thenReturn(Optional.of(request));
    SysUser applicant = new SysUser();
    applicant.setId(2L);
    applicant.setEnabled(true);
    SysUser approver = new SysUser();
    approver.setId(1L);
    approver.setEnabled(true);
    when(users.findById(1L)).thenReturn(Optional.of(approver));
    when(access.hasFor(approver, "requests:approve")).thenReturn(true);
    WorkflowDefinitions definitions =
        new WorkflowDefinitions(
            mock(FlowDefinitionRepository.class),
            mock(FlowVersionRepository.class),
            requests,
            users,
            mock(EntryRepository.class),
            mock(RoleRepository.class),
            access,
            json);
    return new StoredFixture(definitions, applicant, approver, access);
  }

  /** 合成仓储与账号只存在于测试进程，不启动数据库或修改真实权限。 */
  private record StoredFixture(
      WorkflowDefinitions definitions, SysUser applicant, SysUser approver, AccessPolicy access) {}

  /** 每条分支先经过审批，使用稳定节点标识构造最小可执行的合成模型。 */
  private Spec schema(List<String> options, String operator, String value) {
    Field field = new Field("kind", "申请类型", "SINGLE", true, null, null, null, null, options);
    Node review =
        new Node(
            "review",
            "审批",
            "APPROVAL",
            "choice",
            "USERS",
            List.of(1L),
            "ALL",
            Set.of("kind"),
            Set.of(),
            Set.of("APPROVE", "REJECT"),
            List.of());
    Node condition =
        new Node(
            "choice",
            "类型判断",
            "CONDITION",
            "end",
            null,
            List.of(),
            null,
            Set.of(),
            Set.of(),
            Set.of(),
            List.of(new Condition("kind", operator, value, "matched")));
    Node matched =
        new Node(
            "matched", "条件结束", "END", null, null, List.of(), null, Set.of(), Set.of(), Set.of(),
            List.of());
    Node end =
        new Node(
            "end", "默认结束", "END", null, null, List.of(), null, Set.of(), Set.of(), Set.of(),
            List.of());
    return new Spec(
        List.of(field),
        List.of(review, condition, matched, end),
        "review",
        "ALL",
        Set.of(),
        false,
        false,
        true);
  }
}
