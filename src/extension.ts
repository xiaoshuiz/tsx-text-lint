import * as vscode from "vscode";
import { validateText } from "./scripts/extract_text";
import { Project, SourceFile } from "ts-morph";

let diagnosticCollection: vscode.DiagnosticCollection;
const project = new Project();

export function activate(context: vscode.ExtensionContext) {
  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("tsx-text-lint");
  context.subscriptions.push(diagnosticCollection);

  // 注册文档更改事件
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "typescriptreact") {
        validateTsxDocument(event.document);
      }
    })
  );

  // 注册保存事件
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "typescriptreact") {
        validateTsxDocument(document);
      }
    })
  );

  // 手动触发当前编辑器文档
  if (vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (doc.languageId === "typescriptreact") {
      validateTsxDocument(doc);
    }
  }
}

async function validateTsxDocument(document: vscode.TextDocument) {
  const diagnostics: vscode.Diagnostic[] = [];

  try {
    const sourceFile = project.createSourceFile(
      document.fileName,
      document.getText(),
      { overwrite: true }
    );

    const textLintErrors = await validateText(sourceFile);

    // 将检查结果转换为 VSCode 诊断信息
    for (const error of textLintErrors) {
      const line = error.line - 1; // textlint 的行号从 1 开始，VSCode 从 0 开始
      const lineText = document.lineAt(line).text;

      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(line, 0, line, lineText.length),
          error.message,
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    diagnosticCollection.set(document.uri, diagnostics);
  } catch (error) {
    console.error("验证文档时发生错误:", error);
  }
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
  }
}
