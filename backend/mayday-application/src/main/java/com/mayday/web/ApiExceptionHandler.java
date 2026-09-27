package com.mayday.web;

import com.mayday.common.*;
import org.slf4j.*;
import org.springframework.dao.*;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/** 统一异常边界：把业务错误变为可读提示，内部细节仅保留在服务端日志。 */
@RestControllerAdvice
public class ApiExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);

  @ExceptionHandler(BusinessException.class)
  ResponseEntity<?> business(BusinessException ex) {
    return response(400, ex.getMessage());
  }

  @ExceptionHandler(AccessDeniedException.class)
  ResponseEntity<?> denied(AccessDeniedException ex) {
    return response(403, ex.getMessage());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<?> validation(MethodArgumentNotValidException ex) {
    return response(
        400,
        ex.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .orElse("请检查表单"));
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<?> invalid(Exception ex) {
    return response(400, "请求格式不正确");
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<?> conflict(Exception ex) {
    return response(409, "编码已存在，或数据仍被其他记录引用");
  }

  @ExceptionHandler(OptimisticLockingFailureException.class)
  ResponseEntity<?> stale(Exception ex) {
    return response(409, "数据已被其他人修改，请刷新后重试");
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> internal(Exception ex) {
    LOG.error("请求处理失败", ex);
    return response(500, "服务暂时不可用，请稍后重试");
  }

  private ResponseEntity<?> response(int status, String message) {
    return ResponseEntity.status(status).body(ApiResponse.error(message));
  }
}
