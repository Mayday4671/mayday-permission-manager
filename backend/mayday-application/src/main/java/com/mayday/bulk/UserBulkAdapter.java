package com.mayday.bulk;

import com.mayday.common.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.service.UserService;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import com.mayday.web.Contracts.UserRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

/** 用户批量适配器只创建新账号；角色不自动猜测或默认授权，密码仍由原用户服务加密保存。 */
@Component
@RequiredArgsConstructor
public class UserBulkAdapter implements BulkResourceAdapter {
  private static final Set<String> HEADERS =
      Set.of(
          "username",
          "nickname",
          "password",
          "email",
          "phone",
          "departmentId",
          "roleIds",
          "postIds",
          "enabled");
  private final AccessPolicy access;
  private final UserService userService;
  private final UserRepository users;
  private final RoleRepository roles;
  private final EntryRepository entries;
  private final Validator validator;

  @Override
  public String resource() {
    return "users";
  }

  @Override
  public String title() {
    return "用户";
  }

  /** 导入权限与创建权限独立叠加，数据范围同普通创建账号，不能靠批量接口绕过范围。 */
  @Override
  public void requireImport() {
    access.require("users:import");
    access.require("users:create");
    if (!"ALL".equals(access.scope("users"))) throw new AccessDeniedException("当前用户数据范围不允许导入账号");
  }

  @Override
  public void requireExport() {
    access.require("users:export");
    access.require("users:view");
  }

  /** 模板仅开放可写字段；不存在邮箱读权限但有写权限时仍允许写入，不把读授权隐含扩大。 */
  @Override
  public List<String> templateHeaders() {
    List<String> headers = new ArrayList<>(List.of("username", "nickname", "password", "enabled"));
    if (contact("email", "write")) headers.add("email");
    if (contact("phone", "write")) headers.add("phone");
    if (access.admin()) headers.add("departmentId");
    if (access.has("users:assign")) headers.add("roleIds");
    headers.add("postIds");
    return headers;
  }

  @Override
  public BulkContracts.ImportPreview preview(CsvCodec.Document document) {
    requireImport();
    if (!HEADERS.containsAll(document.headers())
        || !document.headers().containsAll(List.of("username", "nickname", "password")))
      throw new BusinessException("请使用用户导入模板，必须包含 username、nickname、password 标题");
    List<BulkContracts.ImportRow> result = new ArrayList<>();
    Set<String> usernames = new HashSet<>();
    int validRows = 0;
    for (int index = 0; index < document.rows().size(); index++) {
      Map<String, String> values = values(document, document.rows().get(index));
      List<String> errors = validateRow(values, usernames);
      // 预览不返回初始密码，错误报告也不能带回该字段原文。
      Map<String, String> safe = new LinkedHashMap<>(values);
      safe.put("password", values.getOrDefault("password", "").isBlank() ? "未提供" : "已提供");
      if (errors.isEmpty()) validRows++;
      result.add(
          new BulkContracts.ImportRow(document.rowNumbers().get(index), safe, List.copyOf(errors)));
    }
    return new BulkContracts.ImportPreview(result.size(), validRows, List.copyOf(result));
  }

  /** 提交总是再次校验并调用原保存用例，任一账号或并发唯一约束失败由外层事务全批回滚。 */
  @Override
  public int commit(CsvCodec.Document document) {
    BulkContracts.ImportPreview preview = preview(document);
    if (preview.validRows() != preview.totalRows()) throw new BusinessException("导入包含错误，请先修正全部错误行");
    for (List<String> row : document.rows()) userService.save(null, request(values(document, row)));
    return document.rows().size();
  }

  @Override
  public List<String> exportHeaders() {
    List<String> headers = new ArrayList<>(List.of("用户名", "姓名", "部门", "角色"));
    if (contact("email", "read")) headers.add("邮箱");
    if (contact("phone", "read")) headers.add("电话");
    headers.add("状态");
    return headers;
  }

  /** SQL 查询复用 UserService 的授权范围；每批读取 DTO，字段再次按当前权限过滤。 */
  @Override
  public ExportPage exportPage(BulkContracts.ExportFilter filter, int page) {
    requireExport();
    var result =
        userService.list(filter.keyword(), filter.enabled(), filter.departmentId(), page, 100);
    List<List<String>> rows =
        result.items().stream()
            .map(
                user -> {
                  List<String> cells =
                      new ArrayList<>(
                          List.of(
                              user.username(),
                              user.nickname(),
                              user.departmentName(),
                              String.join("、", user.roleNames())));
                  if (contact("email", "read")) cells.add(user.email());
                  if (contact("phone", "read")) cells.add(user.phone());
                  cells.add(user.enabled() ? "启用" : "停用");
                  return cells;
                })
            .toList();
    return new ExportPage(rows, result.total());
  }

  private List<String> validateRow(Map<String, String> values, Set<String> usernames) {
    List<String> errors = new ArrayList<>();
    UserRequest request;
    try {
      request = request(values);
    } catch (BusinessException exception) {
      errors.add(exception.getMessage());
      return errors;
    }
    validator.validate(request).stream()
        .map(ConstraintViolation::getPropertyPath)
        .map(path -> path + " 格式或长度不正确")
        .distinct()
        .sorted()
        .forEach(errors::add);
    try {
      UserService.validatePassword(request.password());
    } catch (BusinessException exception) {
      errors.add(exception.getMessage());
    }
    if (!usernames.add(request.username())) errors.add("文件内用户名重复");
    if (users.findByUsername(request.username()).isPresent()) errors.add("用户名已存在");
    if (!request.roleIds().isEmpty()) {
      if (!access.has("users:assign")) errors.add("没有分配角色的权限");
      else {
        List<SysRole> assigned = roles.findAllById(request.roleIds());
        if (assigned.size() != request.roleIds().size()
            || assigned.stream().anyMatch(role -> !role.isEnabled())) errors.add("角色不存在或已停用");
        else
          try {
            access.checkGrant(assigned);
          } catch (AccessDeniedException exception) {
            errors.add("角色超出当前账号的委托权限");
          }
      }
    }
    if (request.departmentId() != null) {
      if (!access.admin()) errors.add("创建部门账号需要超级管理员");
      else if (entries
          .findById(request.departmentId())
          .filter(entry -> "departments".equals(entry.getKind()) && entry.isEnabled())
          .isEmpty()) errors.add("部门不存在或已停用");
    }
    if (!request.postIds().isEmpty()) {
      List<SystemEntry> posts = entries.findAllById(request.postIds());
      if (posts.size() != request.postIds().size()
          || posts.stream().anyMatch(post -> !"posts".equals(post.getKind()) || !post.isEnabled()))
        errors.add("岗位不存在或已停用");
    }
    if (request.email() != null && !contact("email", "write")) errors.add("没有修改邮箱的权限");
    if (request.phone() != null && !contact("phone", "write")) errors.add("没有修改电话的权限");
    return errors;
  }

  private Map<String, String> values(CsvCodec.Document document, List<String> row) {
    Map<String, String> values = new LinkedHashMap<>();
    for (int index = 0; index < document.headers().size(); index++) {
      String header = document.headers().get(index);
      // 账号及选项允许去掉表格编辑产生的边缘空格；密码属于精确凭据，不能隐式改写。
      values.put(header, "password".equals(header) ? row.get(index) : row.get(index).trim());
    }
    return values;
  }

  private UserRequest request(Map<String, String> values) {
    String enabled = values.getOrDefault("enabled", "true");
    if (enabled.isBlank()) enabled = "true";
    if (!Set.of("true", "false").contains(enabled))
      throw new BusinessException("enabled 只能填写 true 或 false");
    return new UserRequest(
        values.get("username"),
        values.get("nickname"),
        nullable(values.get("email")),
        nullable(values.get("phone")),
        values.get("password"),
        identifier(values.get("departmentId")),
        Boolean.parseBoolean(enabled),
        identifiers(values.get("roleIds")),
        identifiers(values.get("postIds")),
        null);
  }

  private Long identifier(String value) {
    if (value == null || value.isBlank()) return null;
    try {
      long id = Long.parseLong(value);
      if (id <= 0) throw new NumberFormatException();
      return id;
    } catch (NumberFormatException exception) {
      throw new BusinessException("部门、角色和岗位 ID 必须为正整数，多项用分号分隔");
    }
  }

  private Set<Long> identifiers(String value) {
    if (value == null || value.isBlank()) return Set.of();
    if (value.split(";", -1).length > 50) throw new BusinessException("角色或岗位最多填写 50 项");
    Set<Long> result = new HashSet<>();
    for (String item : value.split(";", -1)) {
      Long id = identifier(item.trim());
      if (id == null || !result.add(id)) throw new BusinessException("角色或岗位 ID 不能为空或重复");
    }
    return result;
  }

  private String nullable(String value) {
    return value == null || value.isBlank() ? null : value;
  }

  private boolean contact(String field, String action) {
    return access.has("users:sensitive") || access.has("users:" + field + "-" + action);
  }
}
