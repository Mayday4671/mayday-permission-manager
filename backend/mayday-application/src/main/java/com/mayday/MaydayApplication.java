package com.mayday;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** 启动聚合模块；公共模型、系统管理、权限安全、内容业务分别位于独立 Maven 模块。 */
@SpringBootApplication
public class MaydayApplication {
  public static void main(String[] args) {
    SpringApplication.run(MaydayApplication.class, args);
  }
}
