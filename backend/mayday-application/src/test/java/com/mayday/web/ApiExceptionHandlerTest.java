package com.mayday.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;

/** 请求分派与绑定错误应保持客户端状态，内部异常不得泄露原始消息。 */
class ApiExceptionHandlerTest {
  /** 构造请求边界错误的控制器，不依赖真实数据库和鉴权。 */
  @RestController
  static class Requests {
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    String upload(@RequestPart("file") MultipartFile file) {
      return "ok";
    }

    @GetMapping("/parameter")
    String parameter(@RequestParam("required") String value) {
      return value;
    }

    @GetMapping("/large")
    String large() {
      throw new MaxUploadSizeExceededException(10);
    }

    @GetMapping("/broken")
    String broken() {
      throw new IllegalStateException("private database detail");
    }
  }

  final MockMvc mvc =
      MockMvcBuilders.standaloneSetup(
              new Requests(), new com.mayday.operations.web.FileController(null, null, null, null))
          .setControllerAdvice(new ApiExceptionHandler())
          .build();

  @Test
  void productionFileUploadRejectsInvalidRequestsBeforeBusinessLogic() throws Exception {
    mvc.perform(multipart("/api/operations/files")).andExpect(status().isBadRequest());
    mvc.perform(post("/api/operations/files").contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnsupportedMediaType());
    mvc.perform(put("/api/operations/files")).andExpect(status().isMethodNotAllowed());
  }

  @Test
  void missingPartAndParameterAreBadRequests() throws Exception {
    mvc.perform(multipart("/upload"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.success").value(false));
    mvc.perform(get("/parameter")).andExpect(status().isBadRequest());
  }

  @Test
  void wrongMethodPreservesAllowHeader() throws Exception {
    mvc.perform(put("/upload"))
        .andExpect(status().isMethodNotAllowed())
        .andExpect(header().string("Allow", "POST"));
  }

  @Test
  void wrongContentTypeAndOversizedUploadKeepClientStatus() throws Exception {
    mvc.perform(post("/upload").contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnsupportedMediaType());
    mvc.perform(get("/large")).andExpect(status().is(413));
  }

  @Test
  void unexpectedFailureRemainsSafeInternalError() throws Exception {
    mvc.perform(get("/broken"))
        .andExpect(status().isInternalServerError())
        .andExpect(jsonPath("$.message").value("服务暂时不可用，请稍后重试"));
  }
}
