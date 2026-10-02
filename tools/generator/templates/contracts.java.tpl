package com.mayday.{{module}};

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDateTime;

/** {{label}}接口契约。请求白名单不包含主键、创建者、部门和服务端时间，阻断批量赋值越权。 */
public final class {{entity}}Contracts {
  private {{entity}}Contracts() {}

  /** version 新建时可空；修改时必须与数据库当前版本一致。 */
  public record {{entity}}Request(
{{requestFields}},
      Long version) {}

  /** 对外响应始终从实体投影，新增内部字段不会自动泄露到接口。 */
  @Schema(requiredProperties = { {{viewRequiredProperties}} })
  public record {{entity}}View(
      Long id,
{{viewFields}},
      Long ownerId,
      @Schema(nullable = true) Long departmentId,
      LocalDateTime createdAt,
      LocalDateTime updatedAt,
      Long version) {
    /** 调用方先完成动作与范围检查，再映射公开字段；实体未来增加的内部属性不会自动输出。 */
    public static {{entity}}View from({{entity}} entity) {
      return new {{entity}}View(entity.getId(),
{{viewValues}},
          entity.getOwnerId(), entity.getDepartmentId(), entity.getCreatedAt(),
          entity.getUpdatedAt(), entity.getVersion());
    }
  }
}
