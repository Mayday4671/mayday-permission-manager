package com.mayday.bulk;

import com.mayday.common.BusinessException;
import java.io.IOException;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/** 有界 RFC 4180 CSV 编解码；保留引号中的换行，拒绝乱码、重复标题及无界导入。 */
public final class CsvCodec {
  public static final int MAX_IMPORT_ROWS = 1000;
  public static final int MAX_IMPORT_BYTES = 2 * 1024 * 1024;

  private CsvCodec() {}

  /** CSV 原文件的请求内结构，标题及单元格不参与持久化；密码值只在校验/提交内存存在。 */
  public record Document(List<String> headers, List<List<String>> rows, List<Integer> rowNumbers) {}

  /** 只支持 UTF-8，错误不回显单元格原文，防止密码出现在日志或接口错误中。 */
  public static Document parse(byte[] bytes) {
    if (bytes.length == 0 || bytes.length > MAX_IMPORT_BYTES)
      throw new BusinessException("导入文件须为 1 字节到 2 MB");
    String text;
    try {
      text =
          StandardCharsets.UTF_8
              .newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT)
              .onUnmappableCharacter(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(bytes))
              .toString();
    } catch (CharacterCodingException exception) {
      throw new BusinessException("请使用 UTF-8 编码的 CSV 文件");
    }
    if (text.startsWith("\ufeff")) text = text.substring(1);
    List<List<String>> records = new ArrayList<>();
    List<Integer> recordNumbers = new ArrayList<>();
    int recordNumber = 1;
    List<String> row = new ArrayList<>();
    StringBuilder cell = new StringBuilder();
    boolean quoted = false;
    boolean quoteClosed = false;
    for (int index = 0; index < text.length(); index++) {
      char current = text.charAt(index);
      if (quoted) {
        if (current == '"') {
          if (index + 1 < text.length() && text.charAt(index + 1) == '"') {
            cell.append('"');
            index++;
          } else {
            quoted = false;
            quoteClosed = true;
          }
        } else cell.append(current);
      } else if (current == '"' && cell.isEmpty() && !quoteClosed) quoted = true;
      else if (current == ',' || current == '\r' || current == '\n') {
        row.add(cell.toString());
        cell.setLength(0);
        quoteClosed = false;
        if (current != ',') {
          if (current == '\r' && index + 1 < text.length() && text.charAt(index + 1) == '\n')
            index++;
          append(records, row, recordNumbers, recordNumber++);
          row = new ArrayList<>();
        }
      } else {
        if (quoteClosed || current == '"') throw new BusinessException("CSV 引号格式不正确");
        cell.append(current);
      }
      if (cell.length() > 10000 || row.size() > 30) throw new BusinessException("CSV 单元格或列数量超出限制");
    }
    if (quoted) throw new BusinessException("CSV 引号未闭合");
    if (!cell.isEmpty() || !row.isEmpty() || quoteClosed) {
      row.add(cell.toString());
      append(records, row, recordNumbers, recordNumber);
    }
    if (records.isEmpty()) throw new BusinessException("CSV 缺少标题");
    List<String> headers = records.removeFirst().stream().map(String::trim).toList();
    recordNumbers.removeFirst();
    if (headers.stream().anyMatch(String::isBlank)
        || new HashSet<>(headers).size() != headers.size())
      throw new BusinessException("CSV 标题不能为空或重复");
    if (records.isEmpty()) throw new BusinessException("CSV 没有需要导入的数据");
    for (List<String> values : records)
      if (values.size() != headers.size()) throw new BusinessException("CSV 数据列数与标题不一致");
    return new Document(headers, records, recordNumbers);
  }

  private static void append(
      List<List<String>> records, List<String> row, List<Integer> recordNumbers, int recordNumber) {
    // 换行和 EOF 都在同一入口验证列数，不能因行缓冲已重置而绕过数量上限。
    if (row.size() > 30) throw new BusinessException("CSV 列数量超出限制");
    if (row.size() == 1 && row.getFirst().isBlank()) return;
    if (records.size() >= MAX_IMPORT_ROWS + 1) throw new BusinessException("单次最多导入 1000 行");
    records.add(List.copyOf(row));
    // 空白记录可以忽略，但其原表格行号仍需保留，错误清单不会定位到前一行。
    recordNumbers.add(recordNumber);
  }

  /** CSV 输出始终加引号并中和公式前缀，打开导出文件不能触发电子表格公式执行。 */
  public static void writeRow(Writer writer, List<String> cells) throws IOException {
    for (int index = 0; index < cells.size(); index++) {
      if (index > 0) writer.write(',');
      String value = cells.get(index) == null ? "" : cells.get(index);
      String candidate = value.stripLeading();
      if (!candidate.isEmpty() && "=+-@".indexOf(candidate.charAt(0)) >= 0
          || !value.isEmpty() && "\t\r\n".indexOf(value.charAt(0)) >= 0) value = "'" + value;
      writer.write('"');
      writer.write(value.replace("\"", "\"\""));
      writer.write('"');
    }
    writer.write("\r\n");
  }
}
