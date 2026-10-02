package com.mayday.config;

import com.mayday.common.ModuleSwitches;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.prepost.PreAuthorize;

/** 从真实控制器和请求 DTO 生成契约，不维护另一份手写接口定义。契约读取本身受管理员限制。 */
@Configuration
public class OpenApiConfig {
  @Bean
  OpenAPI platformOpenApi() {
    return new OpenAPI()
        .info(
            new Info()
                .title("Mayday API")
                .version("1.0.0")
                .description("统一响应、动作权限、数据范围与乐观锁均由服务端执行。关闭模块不开放接口。"))
        .servers(List.of(new Server().url("/")))
        .schemaRequirement(
            "bearerAuth",
            new SecurityScheme()
                .type(SecurityScheme.Type.HTTP)
                .scheme("bearer")
                .description("通过滑块验证与登录接口取得的一次性会话令牌"));
  }

  @Bean
  OperationCustomizer permissionDescriptions() {
    return (operation, handler) -> {
      // 不依赖反射发现顺序生成 create_1/create_2，使契约比较和客户端名称在每次构建中稳定。
      operation.setOperationId(
          handler.getBeanType().getSimpleName() + "_" + handler.getMethod().getName());
      PreAuthorize authorization = handler.getMethodAnnotation(PreAuthorize.class);
      if (authorization != null) operation.addExtension("x-authorization", authorization.value());
      return operation;
    };
  }

  @Bean
  OpenApiCustomizer activeModuleContract(ModuleSwitches modules) {
    return api -> {
      // 响应信封三个字段始终序列化。业务泛型 data 保留自身类型；失败时允许 null。
      if (api.getComponents() != null && api.getComponents().getSchemas() != null) {
        api.getComponents()
            .getSchemas()
            .forEach(
                (name, schema) -> {
                  if (name.startsWith("ApiResponse"))
                    schema.setRequired(List.of("success", "data", "message"));
                });
      }
      if (api.getPaths() == null) return;
      api.getPaths().entrySet().removeIf(entry -> !modules.pathEnabled(entry.getKey()));
      api.getPaths()
          .forEach(
              (path, item) -> {
                boolean publicEndpoint =
                    path.startsWith("/api/public/")
                        || path.equals("/api/platform/features")
                        || path.equals("/api/auth/login")
                        || path.startsWith("/api/auth/captcha/");
                item.readOperations()
                    .forEach(
                        operation ->
                            operation.setSecurity(
                                publicEndpoint
                                    ? List.of()
                                    : List.of(new SecurityRequirement().addList("bearerAuth"))));
              });
    };
  }
}
