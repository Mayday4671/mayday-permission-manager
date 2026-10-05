package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 图形模拟沿用正式人员、表单、条件和固定子版本规则，只读取数据，不建立申请、任务或通知。 */
@Service
@RequiredArgsConstructor
public class WorkflowSimulation {
  private final WorkflowDefinitions definitions;
  private final WorkflowJson json;
  private final UserRepository users;
  private final AccessPolicy access;

  /** 并行展开全部支路再显示一次汇合；子流程展示固定版本的内部路径，不静默当作普通节点跳过。 */
  public List<Map<String, Object>> path(Spec spec, Map<String, Object> form, SysUser applicant) {
    return path(spec, new LinkedHashMap<>(form), applicant, 0);
  }

  private List<Map<String, Object>> path(
      Spec spec, Map<String, Object> form, SysUser applicant, int depth) {
    if (depth > 4) throw new BusinessException("模拟子流程超过安全上限");
    var people = definitions.resolve(spec, applicant);
    for (var user :
        users.findAllById(people.values().stream().flatMap(Collection::stream).distinct().toList()))
      access.checkData("users", user.getId(), user.getDepartmentId());
    List<Map<String, Object>> result = new ArrayList<>();
    walk(spec, spec.startNodeId(), null, form, applicant, people, result, depth, null);
    return result;
  }

  private void walk(
      Spec spec,
      String first,
      String stop,
      Map<String, Object> form,
      SysUser applicant,
      Map<String, List<Long>> people,
      List<Map<String, Object>> result,
      int depth,
      String branch) {
    String next = first;
    for (int hops = 0; hops <= spec.nodes().size(); hops++) {
      if (next.equals(stop)) return;
      var node = spec.node(next);
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("id", node.id());
      row.put("name", node.name());
      row.put("type", node.type());
      row.put("branch", branch);
      row.put(
          "approvers",
          users.findAllById(people.getOrDefault(node.id(), List.of())).stream()
              .map(user -> Map.of("id", user.getId(), "name", user.getNickname()))
              .toList());
      result.add(row);
      if ("END".equals(node.type())) return;
      if ("PARALLEL".equals(node.type())) {
        int index = 0;
        for (String root : node.branches())
          walk(
              spec,
              root,
              node.next(),
              form,
              applicant,
              people,
              result,
              depth,
              node.name() + " · 支路" + ++index);
        next = node.next();
      } else if ("SUBPROCESS".equals(node.type())) {
        var version = definitions.subprocessVersion(node.subprocess().versionId());
        var child = json.spec(version.getSchemaJson());
        Map<String, Object> mapped = new LinkedHashMap<>();
        node.subprocess()
            .inputs()
            .forEach((target, source) -> mapped.put(target, form.get(source)));
        var normalized = WorkflowSchema.form(child, mapped);
        row.put("childVersionId", version.getId());
        row.put("childPath", path(child, normalized, applicant, depth + 1));
        node.subprocess()
            .outputs()
            .forEach((target, source) -> form.put(target, normalized.get(source)));
        var recomputed = WorkflowSchema.form(spec, form);
        form.clear();
        form.putAll(recomputed);
        next = node.next();
      } else next = WorkflowSchema.next(node, form);
    }
    throw new BusinessException("模拟路径未能正常结束");
  }
}
