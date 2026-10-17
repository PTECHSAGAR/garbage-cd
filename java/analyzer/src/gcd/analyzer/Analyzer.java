package gcd.analyzer;

import com.sun.source.tree.ArrayTypeTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.ModifiersTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import gcd.json.Json;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import javax.lang.model.element.Modifier;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

public final class Analyzer {
    private Analyzer() {}

    private static final class SourceFile extends SimpleJavaFileObject {
        private final String source;

        SourceFile(String filename, String source) {
            super(URI.create("string:///" + filename), Kind.SOURCE);
            this.source = source;
        }

        @Override
        public CharSequence getCharContent(boolean ignoreEncodingErrors) {
            return source;
        }
    }

    private static final class Analysis {
        String mainClass;
        String publicTypeName;
        String packageName;
    }

    public static void main(String[] args) {
        int exitCode = 0;
        try {
            exitCode = run(args);
        } catch (Exception exception) {
            System.err.println("analyzer error: " + exception.getMessage());
            exitCode = 4;
        }
        if (exitCode != 0) {
            System.exit(exitCode);
        }
    }

    private static int run(String[] args) throws IOException {
        if (args.length != 6 || !"--source".equals(args[0]) ||
                !"--analysis".equals(args[2]) || !"--classes".equals(args[4])) {
            System.err.println(
                    "usage: Analyzer --source <file> --analysis <file> --classes <directory>");
            return 3;
        }
        Path sourcePath = Paths.get(args[1]);
        Path analysisPath = Paths.get(args[3]);
        Path classesPath = Paths.get(args[5]);
        String source = Files.readString(sourcePath, StandardCharsets.UTF_8);
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            System.err.println("JDK compiler is unavailable");
            return 3;
        }

        long started = System.nanoTime();
        Analysis analysis = parse(compiler, source);
        Files.createDirectories(classesPath);
        DiagnosticCollector<JavaFileObject> compileDiagnostics = new DiagnosticCollector<>();
        boolean compiled = compile(compiler, source, analysis.publicTypeName,
                                  classesPath, compileDiagnostics);
        List<String> diagnostics = new ArrayList<>();
        for (Diagnostic<? extends JavaFileObject> diagnostic : compileDiagnostics.getDiagnostics()) {
            diagnostics.add(writeDiagnostic(diagnostic));
        }
        boolean hasCompileError = compileDiagnostics.getDiagnostics().stream()
                .anyMatch(diagnostic -> diagnostic.getKind() == Diagnostic.Kind.ERROR);
        if (!hasCompileError && analysis.mainClass == null) {
            diagnostics.add("{\"severity\":\"error\",\"code\":\"NO_MAIN_METHOD\","
                    + "\"message\":\"no public static void main(String[] args) method found\"}");
        }
        double compileMs = (System.nanoTime() - started) / 1_000_000.0;
        String status = hasCompileError || !compiled ? "compile_error"
                : analysis.mainClass == null ? "no_main" : "ok";
        writeResult(analysisPath, analysis, diagnostics, compileMs, status);
        return 0;
    }

    private static Analysis parse(JavaCompiler compiler, String source) throws IOException {
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        SourceFile sourceFile = new SourceFile("Submission.java", source);
        try (StandardJavaFileManager manager =
                     compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
            JavacTask task = (JavacTask) compiler.getTask(
                    null, manager, diagnostics, Arrays.asList("-proc:none", "-Xlint:all"),
                    null, Collections.singletonList(sourceFile));
            Analysis analysis = new Analysis();
            for (CompilationUnitTree unit : task.parse()) {
                analysis.packageName =
                        unit.getPackageName() == null ? "" : unit.getPackageName().toString();
                for (Tree declaration : unit.getTypeDecls()) {
                    if (declaration instanceof ClassTree) {
                        ClassTree classTree = (ClassTree) declaration;
                        if (isPublic(classTree.getModifiers()) && analysis.publicTypeName == null) {
                            analysis.publicTypeName = classTree.getSimpleName().toString();
                        }
                        if (analysis.mainClass == null && hasMain(classTree)) {
                            String simpleName = classTree.getSimpleName().toString();
                            analysis.mainClass = analysis.packageName.isEmpty()
                                    ? simpleName : analysis.packageName + "." + simpleName;
                        }
                    }
                }
            }
            return analysis;
        }
    }

    private static boolean isPublic(ModifiersTree modifiers) {
        return modifiers.getFlags().contains(Modifier.PUBLIC);
    }

    private static boolean hasMain(ClassTree classTree) {
        for (Tree member : classTree.getMembers()) {
            if (!(member instanceof MethodTree)) {
                continue;
            }
            MethodTree method = (MethodTree) member;
            Set<Modifier> flags = method.getModifiers().getFlags();
            if (!"main".contentEquals(method.getName()) ||
                    !flags.containsAll(EnumSet.of(Modifier.PUBLIC, Modifier.STATIC)) ||
                    method.getReturnType() == null ||
                    !"void".equals(method.getReturnType().toString()) ||
                    method.getParameters().size() != 1) {
                continue;
            }
            VariableTree parameter = method.getParameters().get(0);
            if (parameter.getType() instanceof ArrayTypeTree) {
                String componentType =
                        ((ArrayTypeTree) parameter.getType()).getType().toString();
                if ("String".equals(componentType) || "java.lang.String".equals(componentType)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean compile(JavaCompiler compiler, String source, String publicType,
                                   Path classesPath,
                                   DiagnosticCollector<JavaFileObject> diagnostics)
            throws IOException {
        String filename = publicType == null ? "Submission.java" : publicType + ".java";
        SourceFile sourceFile = new SourceFile(filename, source);
        try (StandardJavaFileManager manager =
                     compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
            manager.setLocationFromPaths(javax.tools.StandardLocation.CLASS_OUTPUT,
                                         Collections.singletonList(classesPath));
            JavacTask task = (JavacTask) compiler.getTask(
                    null, manager, diagnostics, Arrays.asList("-proc:none", "-Xlint:all"),
                    null, Collections.singletonList(sourceFile));
            try {
                task.parse();
                task.analyze();
                task.generate();
            } catch (IOException exception) {
                throw exception;
            } catch (Exception exception) {
                if (diagnostics.getDiagnostics().stream()
                        .noneMatch(diagnostic -> diagnostic.getKind() == Diagnostic.Kind.ERROR)) {
                    throw new IOException("javac failed: " + exception.getMessage(), exception);
                }
            }
            return diagnostics.getDiagnostics().stream()
                    .noneMatch(diagnostic -> diagnostic.getKind() == Diagnostic.Kind.ERROR);
        }
    }

    private static String writeDiagnostic(Diagnostic<? extends JavaFileObject> diagnostic) {
        StringBuilder result = new StringBuilder("{\"severity\":");
        String severity = diagnostic.getKind() == Diagnostic.Kind.ERROR ? "error"
                : diagnostic.getKind() == Diagnostic.Kind.WARNING ||
                  diagnostic.getKind() == Diagnostic.Kind.MANDATORY_WARNING ? "warning" : "note";
        result.append(Json.quote(severity)).append(",\"code\":")
                .append(Json.quote(diagnostic.getCode())).append(",\"message\":")
                .append(Json.quote(diagnostic.getMessage(java.util.Locale.ROOT)));
        long line = diagnostic.getLineNumber();
        long column = diagnostic.getColumnNumber();
        if (line > 0 && column > 0) {
            result.append(",\"location\":{\"line\":").append(line)
                    .append(",\"column\":").append(column)
                    .append(",\"provenance\":\"compiler\"");
            if (diagnostic.getStartPosition() >= 0) {
                result.append(",\"startOffset\":").append(diagnostic.getStartPosition());
            }
            if (diagnostic.getEndPosition() >= 0) {
                result.append(",\"endOffset\":").append(diagnostic.getEndPosition());
            }
            result.append('}');
        }
        return result.append('}').toString();
    }

    private static void writeResult(Path path, Analysis analysis, List<String> diagnostics,
                                    double compileMs, String status) throws IOException {
        Files.createDirectories(path.getParent());
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        String mainClass = analysis.mainClass == null ? "null" : Json.quote(analysis.mainClass);
        String publicType = analysis.publicTypeName == null
                ? "null" : Json.quote(analysis.publicTypeName);
        String packageName = analysis.packageName == null || analysis.packageName.isEmpty()
                ? "null" : Json.quote(analysis.packageName);
        StringBuilder json = new StringBuilder();
        json.append("{\"status\":").append(Json.quote(status))
                .append(",\"mainClass\":").append(mainClass)
                .append(",\"publicTypeName\":").append(publicType)
                .append(",\"packageName\":").append(packageName)
                .append(",\"compileMs\":").append(compileMs)
                .append(",\"staticAnalysis\":{\"schema\":\"gcd.static-analysis/1\",")
                .append("\"language\":\"java\",\"ast\":null,\"nodeCount\":0,")
                .append("\"truncated\":false,\"diagnostics\":[")
                .append(String.join(",", diagnostics))
                .append("],\"java\":{\"mainClass\":").append(mainClass)
                .append(",\"publicTypeName\":").append(publicType)
                .append(",\"packageName\":").append(packageName)
                .append(",\"compileMs\":{\"value\":").append(compileMs)
                .append(",\"unit\":\"ms\",\"provenance\":\"measured\",")
                .append("\"source\":\"gcd-java-analyzer\"}}}}");
        Files.writeString(temporary, json.toString(), StandardCharsets.UTF_8);
        Files.move(temporary, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                   java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }
}
