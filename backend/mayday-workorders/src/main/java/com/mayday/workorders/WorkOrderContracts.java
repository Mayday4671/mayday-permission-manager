package com.mayday.workorders;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;

/** 工单管理接口契约。请求白名单不包含主键、创建者、部门和服务端时间，阻断批量赋值越权。 */
public final class WorkOrderContracts {
  private WorkOrderContracts() {}

  /** version 新建时可空；修改时必须与数据库当前版本一致。 */
  public record WorkOrderRequest(
      @NotBlank @Size(max = 160) String title,
      @Schema(nullable = true) @Size(max = 1000) String description,
      @NotNull Boolean enabled,
      Long version) {}

  /** 对外响应始终从实体投影，新增内部字段不会自动泄露到接口。 */
  @Schema(
      requiredProperties = {
        "id",
        "title",
        "description",
        "enabled",
        "ownerId",
        "departmentId",
        "createdAt",
        "updatedAt",
        "version"
      })
  public record WorkOrderView(
      Long id,
      String title,
      @Schema(nullable = true) String description,
      Boolean enabled,
      Long ownerId,
      @Schema(nullable = true) Long departmentId,
      LocalDateTime createdAt,
      LocalDateTime updatedAt,
      Long version) {
    /** 调用方先完成动作与范围检查，再映射公开字段；实体未来增加的内部属性不会自动输出。 */
    public static WorkOrderView from(WorkOrder entity) {
      return new WorkOrderView(
          entity.getId(),
          entity.getTitle(),
          entity.getDescription(),
          entity.getEnabled(),
          entity.getOwnerId(),
          entity.getDepartmentId(),
          entity.getCreatedAt(),
          entity.getUpdatedAt(),
          entity.getVersion());
    }
  }
}
