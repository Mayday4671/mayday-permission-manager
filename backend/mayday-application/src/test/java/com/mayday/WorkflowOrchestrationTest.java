package com.mayday;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mayday.common.BusinessException;
import com.mayday.operations.workflow.WorkflowExecutionState;
import com.mayday.operations.workflow.WorkflowJson;
import com.mayday.operations.workflow.WorkflowOrchestration;
import com.mayday.operations.workflow.WorkflowSchema;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** 结构校验与持久游标回归；真实并发、父子事务和权限由隔离 MySQL HTTP 专项另外证明。 */
class WorkflowOrchestrationTest {
  @Test
  void parallelRequiresDedicatedJoinAndDisjointBranches() {
    Spec spec = parallel("join", List.of("left", "right"), Set.of(), Set.of());
    assertDoesNotThrow(() -> WorkflowSchema.validate(spec));
    assertTrue(WorkflowOrchestration.required(spec));
    assertTrue(WorkflowOrchestration.coexecuted(spec, "left", "right"));
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowSchema.validate(parallel("end", List.of("left", "right"), Set.of(), Set.of())));
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowSchema.validate(parallel("join", List.of("left", "left"), Set.of(), Set.of())));
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowSchema.validate(
                parallel("join", List.of("left", "right"), Set.of("memo"), Set.of("memo"))));
  }

  @Test
  void oldSingleLineKeepsOriginalConstructorAndExecutionSemantics() {
    var approval = approval("review", 2L, "end", Set.of());
    var model = spec(List.of(approval, end()));
    assertDoesNotThrow(() -> WorkflowSchema.validate(model));
    assertFalse(WorkflowOrchestration.required(model));
    assertEquals(List.of(), approval.branches());
    assertEquals(null, approval.subprocess());
  }

  @Test
  void executionRoundTripKeepsIdentityVisitAndChildWait() {
    var state = new WorkflowExecutionState();
    var root = state.add("fork", null, List.of("gate"));
    root.setStatus("WAIT_JOIN");
    root.setJoinNodeId("join");
    var branch = state.add("child", root.getId(), root.getTrail());
    branch.setStatus("WAIT_CHILD");
    branch.setNodeVisit(7);
    branch.setChildRequestId(99L);
    var json = new WorkflowJson();
    var restored = json.execution(json.write(state));
    assertEquals(root.getId(), restored.getTokens().get(0).getId());
    assertEquals("WAIT_CHILD", restored.require(branch.getId()).getStatus());
    assertEquals(7, restored.require(branch.getId()).getNodeVisit());
    assertEquals(99L, restored.require(branch.getId()).getChildRequestId());
    assertEquals(Set.of(root.getId(), branch.getId()), restored.descendants(root.getId()));
    restored.require(branch.getId()).getTrail().add("different");
    assertEquals(List.of("gate"), restored.require(root.getId()).getTrail());
    assertThrows(BusinessException.class, () -> restored.require("not-an-existing-token"));
  }

  @Test
  void corruptedPersistedStateNeverFallsBackToRecreatingTasks() {
    var json = new WorkflowJson();
    assertThrows(
        BusinessException.class, () -> json.execution("{\"formatVersion\":999,\"tokens\":[]}"));
    var state = new WorkflowExecutionState();
    var token = state.add("review", "missing-parent", List.of());
    token.setStatus("APPROVAL");
    assertThrows(BusinessException.class, () -> json.execution(json.write(state)));
    var cyclic = new WorkflowExecutionState();
    var first = cyclic.add("fork", null, List.of());
    var second = cyclic.add("review", first.getId(), List.of());
    first.setParentTokenId(second.getId());
    assertThrows(BusinessException.class, () -> json.execution(json.write(cyclic)));
  }

  private static Spec parallel(
      String join, List<String> branches, Set<String> leftWrite, Set<String> rightWrite) {
    var nodes = new ArrayList<Node>();
    nodes.add(
        new Node(
            "fork",
            "并行",
            "PARALLEL",
            join,
            null,
            List.of(),
            null,
            Set.of(),
            Set.of(),
            Set.of(),
            List.of(),
            null,
            branches,
            null));
    nodes.add(approval("left", 2L, "join", leftWrite));
    nodes.add(approval("right", 3L, "join", rightWrite));
    nodes.add(
        new Node(
            "join", "汇合", "JOIN", "end", null, List.of(), null, Set.of(), Set.of(), Set.of(),
            List.of()));
    nodes.add(end());
    return spec(nodes);
  }

  private static Node approval(String id, Long person, String next, Set<String> writable) {
    return new Node(
        id,
        id,
        "APPROVAL",
        next,
        "USERS",
        List.of(person),
        "ALL",
        Set.of("memo"),
        writable,
        Set.of("APPROVE", "REJECT"),
        List.of());
  }

  private static Node end() {
    return new Node(
        "end", "结束", "END", null, null, List.of(), null, Set.of(), Set.of(), Set.of(), List.of());
  }

  private static Spec spec(List<Node> nodes) {
    return new Spec(
        List.of(new Field("memo", "说明", "TEXT", true, 24, null, null, 100, List.of())),
        nodes,
        nodes.get(0).id(),
        "ALL",
        Set.of(),
        false,
        false,
        true);
  }
}
