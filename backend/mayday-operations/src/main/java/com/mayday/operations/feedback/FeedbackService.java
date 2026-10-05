package com.mayday.operations.feedback;

import com.mayday.common.BusinessException;
import com.mayday.common.EntityVersions;
import com.mayday.common.ModuleSwitches;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.operations.MessagePublisher;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 反馈服务区分匿名提交/凭码查询与后台处理；限频只作入口保护，数据库仍是处理状态的唯一来源。 */
@Service
@RequiredArgsConstructor
public class FeedbackService {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final com.mayday.security.JdbcSecurityState limits;
  private final FeedbackRepository repository;
  private final FeedbackHistoryRepository histories;
  private final UserRepository users;
  private final AccessPolicy access;
  private final MessagePublisher messages;
  private final ModuleSwitches modules;

  /** 前台只接收业务字段，处理人、状态与查询摘要全部由服务端生成。 */
  @Schema(name = "FeedbackSubmit")
  public record Submit(
      @NotBlank @Pattern(regexp = "QUESTION|SUGGESTION|CORRECTION") String type,
      @NotBlank @Size(max = 160) String title,
      @NotBlank @Size(max = 4000) String content,
      @Positive Long articleId,
      @Email @Size(max = 254) String contact) {}

  /** 匿名提交成功仅返回一次的高熵查询码；数据库只存SHA-256摘要，不把原码放进后台列表或日志。 */
  @Schema(
      name = "FeedbackReceipt",
      requiredProperties = {"receipt", "createdAt"})
  public record Receipt(String receipt, LocalDateTime createdAt) {}

  /** 客户可见的状态与公开回复；不含处理人、内部备注和联系方式，内部处理历史不能通过凭码查询泄露。 */
  @Schema(
      name = "FeedbackPublicHistory",
      requiredProperties = {"status", "createdAt"})
  public record PublicHistory(String status, String reply, LocalDateTime createdAt) {}

  /** 凭查询码读取的最小反馈结果，与后台详情DTO严格分离；不存在与非法码使用相同错误。 */
  @Schema(
      name = "FeedbackPublicView",
      requiredProperties = {"title", "type", "status", "createdAt", "history"})
  public record PublicView(
      String title,
      String type,
      String status,
      LocalDateTime createdAt,
      List<PublicHistory> history) {}

  /** 仅反馈查看权限可读取的后台详情；列表不加载历史，详情包含内部备注，响应始终排除查询码摘要。 */
  @Schema(
      name = "FeedbackAdminView",
      requiredProperties = {
        "id",
        "version",
        "type",
        "title",
        "content",
        "status",
        "createdAt",
        "history"
      })
  public record AdminView(
      Long id,
      Long version,
      String type,
      String title,
      String content,
      Long articleId,
      String contact,
      String status,
      Long assigneeId,
      String assigneeName,
      LocalDateTime createdAt,
      List<FeedbackHistory> history) {}

  /** 分配、状态、公开回复和内部备注同事务处理；version 防止旧弹窗覆盖刚提交的回复。 */
  @Schema(name = "FeedbackProcess")
  public record Process(
      @NotNull Long version,
      Long assigneeId,
      @NotBlank @Pattern(regexp = "OPEN|PROCESSING|RESOLVED|CLOSED") String status,
      @Size(max = 2000) String publicReply,
      @Size(max = 2000) String internalNote) {}

  /** 同IP提交每小时十次、凭码查询一百二十次；计数跨实例共享，不信任客户端代理头。 */
  public void limit(String address, boolean submitting) {
    limits.reserve(
        submitting ? "feedback-submit" : "feedback-query", address, submitting ? 10 : 120, 3600000);
  }

  /** 创建初始OPEN反馈并生成192位随机查询码，状态、负责人和服务端时间均不可由客户提交；同一事务保存成功后才返回原码。 */
  @Transactional
  public Receipt submit(Submit request) {
    byte[] random = new byte[24];
    RANDOM.nextBytes(random);
    String receipt = HexFormat.of().formatHex(random);
    Feedback feedback = new Feedback();
    feedback.setReceiptHash(hash(receipt));
    feedback.setType(request.type());
    feedback.setTitle(request.title().trim());
    feedback.setContent(request.content().trim());
    feedback.setArticleId(request.articleId());
    feedback.setContact(request.contact());
    repository.saveAndFlush(feedback);
    return new Receipt(receipt, feedback.getCreatedAt());
  }

  /** 查询码通过POST正文传递，避免出现在网址、浏览器历史和网关访问日志中。 */
  @Transactional(readOnly = true)
  public PublicView track(String receipt) {
    if (receipt == null || !receipt.matches("[a-f0-9]{48}"))
      throw new BusinessException("查询码无效或反馈不存在");
    Feedback feedback =
        repository
            .findByReceiptHash(hash(receipt))
            .orElseThrow(() -> new BusinessException("查询码无效或反馈不存在"));
    return new PublicView(
        feedback.getTitle(),
        feedback.getType(),
        feedback.getStatus(),
        feedback.getCreatedAt(),
        histories.findByFeedbackIdOrderByIdAsc(feedback.getId()).stream()
            .map(
                history ->
                    new PublicHistory(
                        history.getStatus(), history.getPublicReply(), history.getCreatedAt()))
            .toList());
  }

  /** 反馈查看权限下按标题和状态分页查询，列表不加载逐条历史；匿名客户没有列表或按ID查询入口。 */
  @Transactional(readOnly = true)
  public PageResult<AdminView> list(String keyword, String status, int page, int size) {
    access.require("feedback:view");
    return PageResult.from(
        repository
            .findAll(
                (root, query, criteria) ->
                    criteria.and(
                        SearchPredicates.contains(criteria, root.get("title"), keyword),
                        status == null || status.isBlank()
                            ? criteria.conjunction()
                            : criteria.equal(root.get("status"), status)),
                PageResult.request(page, size))
            .map(feedback -> view(feedback, false)));
  }

  /** 明确要求反馈查看权限，返回内部处理历史；不能复用于公开凭码查询，避免私密备注和联系方式泄露。 */
  @Transactional(readOnly = true)
  public AdminView detail(Long id) {
    access.require("feedback:view");
    return view(repository.findById(id).orElseThrow(() -> new BusinessException("反馈不存在")), true);
  }

  /** 查看与处理权限同时校验，变更负责人另需分配权限并验证候选人有效授权；主记录行锁、版本、历史和消息投递同事务提交。 */
  @Transactional
  public AdminView process(Long id, Process request) {
    access.require("feedback:view");
    access.require("feedback:process");
    Feedback feedback = repository.lock(id).orElseThrow(() -> new BusinessException("反馈不存在"));
    EntityVersions.requireCurrent(feedback, request.version());
    if ("RESOLVED".equals(request.status())
        && (request.publicReply() == null || request.publicReply().isBlank()))
      throw new BusinessException("解决反馈时请填写客户可见回复");
    if (!Objects.equals(request.assigneeId(), feedback.getAssigneeId())) {
      access.require("feedback:assign");
      SysUser assignee =
          request.assigneeId() == null
              ? null
              : users
                  .findById(request.assigneeId())
                  .filter(
                      user ->
                          access.hasFor(user, "feedback:view")
                              && access.hasFor(user, "feedback:process"))
                  .orElseThrow(() -> new BusinessException("请选择有反馈处理权限的有效账号"));
      feedback.setAssigneeId(assignee == null ? null : assignee.getId());
      feedback.setAssigneeName(assignee == null ? null : assignee.getNickname());
      if (assignee != null && modules.isEnabled("notifications"))
        messages.publish(
            "feedback:" + id + ":assign:" + request.version(),
            assignee.getId(),
            "收到反馈处理任务",
            feedback.getTitle(),
            access.current().getNickname(),
            "FEEDBACK",
            id);
    }
    feedback.setStatus(request.status());
    if (request.publicReply() != null && !request.publicReply().isBlank())
      feedback.setRepliedAt(LocalDateTime.now());
    FeedbackHistory history = new FeedbackHistory();
    history.setFeedbackId(id);
    history.setActor(access.current().getUsername());
    history.setStatus(request.status());
    history.setPublicReply(request.publicReply());
    history.setInternalNote(request.internalNote());
    histories.save(history);
    repository.saveAndFlush(feedback);
    return view(feedback, true);
  }

  private AdminView view(Feedback feedback, boolean detailed) {
    return new AdminView(
        feedback.getId(),
        feedback.getVersion(),
        feedback.getType(),
        feedback.getTitle(),
        feedback.getContent(),
        feedback.getArticleId(),
        feedback.getContact(),
        feedback.getStatus(),
        feedback.getAssigneeId(),
        feedback.getAssigneeName(),
        feedback.getCreatedAt(),
        detailed ? histories.findByFeedbackIdOrderByIdAsc(feedback.getId()) : List.of());
  }

  private static String hash(String receipt) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(receipt.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("平台缺少SHA-256", exception);
    }
  }
}
