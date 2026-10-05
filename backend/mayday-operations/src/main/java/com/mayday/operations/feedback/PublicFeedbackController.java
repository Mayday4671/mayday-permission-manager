package com.mayday.operations.feedback;

import com.mayday.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 客户无需后台账号即可提交和凭码查询；绝不提供按ID或邮箱枚举反馈的匿名接口。 */
@RestController
@RequestMapping("/api/public/feedback")
@RequiredArgsConstructor
public class PublicFeedbackController {
  private final FeedbackService service;

  /** 查询码只通过POST正文传递，长度限制先于查询；不会要求客户填写后台账号或反馈ID。 */
  public record Track(@NotBlank @Size(max = 48) String receipt) {}

  /** 对真实连接地址限频后接收客户反馈，响应只含查询码和创建时间；不信任可伪造的客户端代理头。 */
  @PostMapping
  public ApiResponse<FeedbackService.Receipt> submit(
      @Valid @RequestBody FeedbackService.Submit body, HttpServletRequest request) {
    service.limit(request.getRemoteAddr(), true);
    return ApiResponse.ok(service.submit(body));
  }

  /** 凭高熵查询码读取公开处理结果；不支持通过邮箱、标题或ID枚举其他客户反馈。 */
  @PostMapping("/track")
  public ApiResponse<FeedbackService.PublicView> track(
      @Valid @RequestBody Track body, HttpServletRequest request) {
    service.limit(request.getRemoteAddr(), false);
    return ApiResponse.ok(service.track(body.receipt()));
  }
}
