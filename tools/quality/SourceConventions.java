import com.sun.source.tree.ClassTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.util.DocTrees;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreePathScanner;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import javax.lang.model.element.Modifier;
import javax.tools.ToolProvider;

/** 用JDK语法树检查手写Java源码的业务边界注释，不用正则误判字符串、嵌套类或注解。 */
public final class SourceConventions {
  /** --report只列出待补充位置；普通模式用于CI，缺职责/公开边界说明或通配导入时退出失败。 */
  public static void main(String[] arguments) throws IOException {
    boolean reportOnly = List.of(arguments).contains("--report");
    Path root = Path.of("backend");
    List<Path> sources;
    try (var files = Files.walk(root)) {
      sources =
          files
              .filter(
                  path -> {
                    String name = path.toString().replace('\\', '/');
                    return (name.contains("/src/main/java/") || name.contains("/src/test/java/"))
                        && name.endsWith(".java");
                  })
              .sorted()
              .toList();
    }
    var compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) throw new IllegalStateException("代码规范检查需要JDK，不能只安装JRE");
    List<String> failures = new ArrayList<>();
    try (var manager =
        compiler.getStandardFileManager(null, null, java.nio.charset.StandardCharsets.UTF_8)) {
      var task =
          (JavacTask)
              compiler.getTask(
                  null,
                  manager,
                  null,
                  List.of("-proc:none"),
                  null,
                  manager.getJavaFileObjectsFromPaths(sources));
      DocTrees docs = DocTrees.instance(task);
      for (var unit : task.parse()) {
        String file = Path.of(unit.getSourceFile().toUri()).toString();
        for (var declaration : unit.getImports())
          if (declaration.getQualifiedIdentifier().toString().endsWith(".*"))
            failures.add(file + ": 通配导入 " + declaration.getQualifiedIdentifier());
        new TreePathScanner<Void, Void>() {
          private void requireDescription(String boundary) {
            String description = docs.getDocComment(getCurrentPath());
            if (description == null || description.strip().length() < 8)
              failures.add(
                  file
                      + ": "
                      + unit.getLineMap()
                          .getLineNumber(
                              docs.getSourcePositions()
                                  .getStartPosition(unit, getCurrentPath().getLeaf()))
                      + " "
                      + boundary
                      + " 缺业务说明");
          }

          @Override
          public Void visitClass(ClassTree node, Void unused) {
            if (!node.getSimpleName().toString().isEmpty())
              requireDescription("类型 " + node.getSimpleName());
            return super.visitClass(node, unused);
          }

          @Override
          public Void visitMethod(MethodTree node, Void unused) {
            boolean inherited =
                node.getModifiers().getAnnotations().stream()
                    .anyMatch(
                        annotation -> annotation.getAnnotationType().toString().equals("Override"));
            if (node.getModifiers().getFlags().contains(Modifier.PUBLIC)
                && !inherited
                && node.getReturnType() != null) requireDescription("公开方法 " + node.getName());
            return super.visitMethod(node, unused);
          }
        }.scan(unit, null);
      }
    }
    failures.forEach(System.out::println);
    System.out.println("手写Java源码 " + sources.size() + " 文件；待处理 " + failures.size() + " 处。");
    if (!reportOnly && !failures.isEmpty()) System.exit(1);
  }
}
