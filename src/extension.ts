import * as vscode from "vscode";
import { validateText } from "./scripts/extract_text";
import { Project } from "ts-morph";

let diagnosticCollection: vscode.DiagnosticCollection;
const project = new Project();

export function activate(context: vscode.ExtensionContext) {
    console.log('==================');
    console.log('开始激活 TSX Text Lint');
    
    try {
        // 创建诊断集合
        console.log('正在创建诊断集合...');
        diagnosticCollection = vscode.languages.createDiagnosticCollection("tsx-text-lint");
        console.log('诊断集合创建成功');
        
        context.subscriptions.push(diagnosticCollection);
        
        // Project 初始化检查
        console.log('检查 ts-morph Project 状态...');
        if (!project) {
            throw new Error('Project 初始化失败');
        }
        
        // 注册文档更改事件
        console.log('正在注册文档更改事件...');
        const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
            try {
                if (event.document.languageId === "typescriptreact") {
                    console.log('触发文档更改检查');
                    validateTsxDocument(event.document);
                }
            } catch (error) {
                console.error('文档更改事件处理错误:', error);
            }
        });
        context.subscriptions.push(changeSubscription);
        
        // 注册保存事件
        console.log('正在注册文档保存事件...');
        const saveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
            try {
                if (document.languageId === "typescriptreact") {
                    console.log('触发文档保存检查');
                    validateTsxDocument(document);
                }
            } catch (error) {
                console.error('文档保存事件处理错误:', error);
            }
        });
        context.subscriptions.push(saveSubscription);
        
        // 检查当前文档
        console.log('检查当前活动编辑器...');
        if (vscode.window.activeTextEditor) {
            const doc = vscode.window.activeTextEditor.document;
            console.log('当前文档类型:', doc.languageId);
            if (doc.languageId === "typescriptreact") {
                validateTsxDocument(doc).catch(error => {
                    console.error('初始文档验证错误:', error);
                });
            }
        }
        
        console.log('TSX Text Lint 激活成功');
    } catch (error) {
        console.error('扩展激活过程中发生严重错误:', error);
        // 重要：向用户显示错误
        vscode.window.showErrorMessage(`TSX Text Lint 激活失败: ${error}`);
        throw error; // 重新抛出错误以确保 VS Code 知道激活失败
    }
    console.log('==================');
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
