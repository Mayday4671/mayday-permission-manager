package com.mayday.common;

/** 统一响应信封；业务失败同时使用正确的 HTTP 状态码，便于前端区分未登录、无权限与校验错误。 */
public record ApiResponse<T>(boolean success, T data, String message) {
  public static <T> ApiResponse<T> ok(T data) {
    return new ApiResponse<>(true, data, "操作成功");
  }

  public static ApiResponse<Void> error(String message) {
    return new ApiResponse<>(false, null, message);
  }
}
