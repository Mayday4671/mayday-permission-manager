package com.mayday.bulk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.mayday.common.BusinessException;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 验证真实 CSV 边界而非复制实现：引号换行、重复标题、无界输入、乱码及公式注入。 */
class CsvCodecTest {
  @Test
  void preservesQuotedCommaNewlineAndEscapedQuote() {
    var parsed =
        CsvCodec.parse(
            "\ufeffusername,nickname\r\nalice,\"Alice,\r\n\"\"Mayday\"\"\"\r\n"
                .getBytes(StandardCharsets.UTF_8));
    assertEquals(List.of("username", "nickname"), parsed.headers());
    assertEquals(List.of(List.of("alice", "Alice,\r\n\"Mayday\"")), parsed.rows());
  }

  @Test
  void rejectsMalformedOrAmbiguousFiles() {
    for (String input :
        List.of(
            "name,name\na,b", "name\n\"open", "name\n\"closed\"more", "name,value\na", "name\n"))
      assertThrows(
          BusinessException.class, () -> CsvCodec.parse(input.getBytes(StandardCharsets.UTF_8)));
    assertThrows(BusinessException.class, () -> CsvCodec.parse(new byte[] {(byte) 0xff}));
    assertThrows(
        BusinessException.class, () -> CsvCodec.parse(new byte[CsvCodec.MAX_IMPORT_BYTES + 1]));
  }

  @Test
  void limitsImportedRowsAndNeutralizesSpreadsheetFormulas() throws Exception {
    String oversized = "name\n" + "value\n".repeat(CsvCodec.MAX_IMPORT_ROWS + 1);
    assertThrows(
        BusinessException.class, () -> CsvCodec.parse(oversized.getBytes(StandardCharsets.UTF_8)));
    StringWriter output = new StringWriter();
    CsvCodec.writeRow(output, List.of("=HYPERLINK(\"url\")", "+formula", "  @formula", "普通文本"));
    assertEquals(
        "\"'=HYPERLINK(\"\"url\"\")\",\"'+formula\",\"'  @formula\",\"普通文本\"\r\n",
        output.toString());
  }

  @Test
  void columnLimitAppliesAtNewlineAndEndOfFile() {
    String headers =
        java.util.stream.IntStream.range(0, 31)
            .mapToObj(index -> "field" + index)
            .collect(java.util.stream.Collectors.joining(","));
    String row = String.join(",", java.util.Collections.nCopies(31, "value"));
    assertThrows(
        BusinessException.class,
        () -> CsvCodec.parse((headers + "\n" + row).getBytes(StandardCharsets.UTF_8)));
    assertThrows(
        BusinessException.class,
        () -> CsvCodec.parse((headers + "\n" + row + "\n").getBytes(StandardCharsets.UTF_8)));
  }

  @Test
  void originalSpreadsheetRowNumbersSurviveSkippedBlankRows() {
    var parsed = CsvCodec.parse("name\n\nAlice\n\nBob\n".getBytes(StandardCharsets.UTF_8));
    assertEquals(List.of(3, 5), parsed.rowNumbers());
    assertEquals(List.of(List.of("Alice"), List.of("Bob")), parsed.rows());
  }
}
