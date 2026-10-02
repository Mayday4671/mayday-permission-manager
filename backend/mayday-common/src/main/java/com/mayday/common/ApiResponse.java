package com.mayday.common;

/** 统一响应信封；业务失败同时使用正确的 HTTP 状态码，便于前端区分未登录、无权限与校验错误。 */
public record ApiResponse<T>(boolean success, T data, String message) {
  /** 包装已经完成授权和事务处理的结果；本方法不改变 HTTP 状态，也不替代业务校验。 */
  public static <T> ApiResponse<T> ok(T data) {
    return new ApiResponse<>(true, data, "操作成功");
  }

  /** 失败响应不携带业务数据；调用方只能传入可展示的错误，并由异常边界设置对应 HTTP 状态。 */
  public static <T> ApiResponse<T> error(String message) {
    return new ApiResponse<>(false, null, message);
  }
}
