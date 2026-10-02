package com.mayday;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.mayday.common.RichText;
import com.mayday.web.ContentContracts;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** 兼容旧纯文本契约，同时确保 HTML 只保留白名单。新可选字段不能使既有客户端无法保存草稿。 */
class ContentContractTest {
  @Test
  void acceptsOriginalDraftWithoutNewOptionalFlags() {
    var draft =
        JsonMapper.builder()
            .build()
            .readValue(
                "{\"title\":\"标题\",\"category\":\"公告\",\"content\":\"纯文本\",\"published\":false}",
                ContentContracts.Draft.class);
    assertEquals("标题", draft.title());
    assertNull(draft.sortOrder());
    assertNull(draft.pinned());
  }

  @Test
  void cleansHtmlAndPreservesPlainTextMeaning() {
    assertEquals(
        "<p>正文<strong>重点</strong></p>",
        RichText.clean(
            "<p onclick='alert(1)'>正文<strong>重点</strong><script>alert(1)</script><img"
                + " src='https://example.test'></p>",
            50000));
    assertEquals(
        "<p>&lt;script&gt;文字&lt;/script&gt;<br>第二行</p>",
        RichText.plain("<script>文字</script>\n第二行", 50000));
  }
}
