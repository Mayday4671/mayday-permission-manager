package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/** 统一异常边界：把业务错误变为可读提示，内部细节仅保留在服务端日志。 */
@RestControllerAdvice
public class ApiExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);

  /** 业务服务主动抛出的可公开说明转为 400，不把预期业务拒绝记录为系统故障。 */
  @ExceptionHandler(BusinessException.class)
  ResponseEntity<?> business(BusinessException exception) {
    return response(400, exception.getMessage());
  }

  /** 已认证用户的授权拒绝返回 403，客户端据此保留登录并提示无权访问。 */
  @ExceptionHandler(AccessDeniedException.class)
  ResponseEntity<?> denied(AccessDeniedException exception) {
    return response(403, exception.getMessage());
  }

  /** 只输出首个字段名和约束说明，不回显被拒绝的密码、正文或其他字段原始值。 */
  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<?> validation(MethodArgumentNotValidException exception) {
    return response(
        400,
        exception.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(fieldError -> fieldError.getField() + ": " + fieldError.getDefaultMessage())
            .orElse("请检查表单"));
  }

  /** 解析和参数类型错误统一说明格式问题，不向客户端泄露反序列化实现或目标类名。 */
  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<?> invalid(Exception exception) {
    return response(400, "请求格式不正确");
  }

  /** 唯一性或关联约束冲突使用通用 409 提示，数据库表名与 SQL 错误不会进入响应。 */
  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<?> conflict(Exception exception) {
    return response(409, "编码已存在，或数据仍被其他记录引用");
  }

  /** 并发写入冲突要求刷新后重试，不能静默覆盖已被他人保存的数据。 */
  @ExceptionHandler(OptimisticLockingFailureException.class)
  ResponseEntity<?> stale(Exception exception) {
    return response(409, "数据已被其他人修改，请刷新后重试");
  }

  /** 框架拒绝超大请求时返回413，不能被兜底处理误报为500或回显文件/表单内容。 */
  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ResponseEntity<?> uploadTooLarge(MaxUploadSizeExceededException exception) {
    return response(413, "上传内容超过服务器限制，请减小文件后重试");
  }

  /** 未预期故障仅在服务端保存异常栈，对外固定错误提示以隔离内部实现细节。 */
  @ExceptionHandler(Exception.class)
  ResponseEntity<?> internal(Exception exception) {
    LOG.error("请求处理失败", exception);
    return response(500, "服务暂时不可用，请稍后重试");
  }

  /** 静态资源与不存在的 API 路径统一返回 404，不能被兜底异常处理误报为服务器故障。 */
  @ExceptionHandler({
    com.mayday.common.ResourceNotFoundException.class,
    org.springframework.web.servlet.resource.NoResourceFoundException.class,
    org.springframework.web.servlet.NoHandlerFoundException.class
  })
  ResponseEntity<?> notFound(Exception exception) {
    return response(404, "请求的资源不存在");
  }

  private ResponseEntity<?> response(int status, String message) {
    return ResponseEntity.status(status).body(ApiResponse.error(message));
  }
}
