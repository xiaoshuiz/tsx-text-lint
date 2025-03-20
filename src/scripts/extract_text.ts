import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { TextLintEngine } from "textlint";
import type { Node, SourceFile } from "ts-morph";
import { config } from "../constant/attr";

// 缓存 TextLintEngine 实例
const engine = new TextLintEngine({
  configFile: resolve(__dirname, "../../.textlintrc"),
});

// 添加标识位
let hasError = false;

interface LintMessage {
  message: string;
  ruleId: string;
}

// 修改 lintTexts 函数
async function lintTexts(
  validateText: string,
  filePath: string,
  lineNumber: number
): Promise<boolean> {
  // 使用缓存的 engine 实例
  const results = await engine.executeOnText(validateText);

  if (results.length === 0 || results[0].messages.length === 0) {
    return true;
  }
  // 输出检查结果
  for (const message of results[0].messages) {
    const { message: msg, ruleId } = message;
    console.log(
      `\x1b[31m错误\x1b[0m [${ruleId}] ${filePath} 第 ${lineNumber} 行：`,
      msg
    );
    hasError = true;
  }

  return false;
}

// 修改 checkText 函数
async function checkText(
  toCheckText: string,
  filePath: string,
  lineNumber: number
): Promise<boolean> {
  try {
    // 移除引号并去除 HTML 实体字符
    const text = toCheckText
      .replace(/^['"`]|['"`]$/g, "")
      .replace(/&[a-zA-Z]+;/g, " ")
      .replace(/\n\s+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (text && text.length > 0 && /[a-zA-Z]/.test(text)) {
      // 使用本地 node_modules 中的 cspell
      try {
        execSync(
          `echo "${text}" | ./node_modules/.bin/cspell stdin --no-progress --no-summary`,
          {
            stdio: ["pipe", "pipe", "pipe"],
          }
        );
      } catch (error: unknown) {
        if (error instanceof Error && "status" in error && error.status === 1) {
          console.log(
            `\x1b[31m拼写错误\x1b[0m [cspell] ${filePath}:${lineNumber}:`,
            `"${text}" 存在拼写错误`
          );
          hasError = true;
        }
      }

      // 继续进行 textlint 检查
      await lintTexts(text, filePath, lineNumber);
    }
    return true;
  } catch (error) {
    console.error(`检查文本失败 [${filePath}:${lineNumber}]:`, error);
    hasError = true;
    return false;
  }
}

// 添加全局标识位
let isInIgnoreBlock = false;
let currentIgnoreFile: string | null = null;

// 检查是否是忽略块的开始或结束
function checkIgnoreBlock(node: Node): boolean {
  // 检查前导注释
  const leadingComments = node.getLeadingCommentRanges();
  if (leadingComments && leadingComments.length > 0) {
    for (const comment of leadingComments) {
      const commentText = comment.getText();
      if (commentText.includes("@text-lint ignore start")) {
        isInIgnoreBlock = true;
        currentIgnoreFile = node.getSourceFile().getFilePath();
        return true;
      }
      if (commentText.includes("@text-lint ignore end")) {
        isInIgnoreBlock = false;
        currentIgnoreFile = null;
        return true;
      }
    }
  }

  // 检查 JSX 注释
  if (node.getKindName() === "JsxExpression") {
    const text = node.getText().trim();
    if (
      text.startsWith("{/*") &&
      text.endsWith("*/}") &&
      text.includes("@text-lint ignore start")
    ) {
      isInIgnoreBlock = true;
      currentIgnoreFile = node.getSourceFile().getFilePath();
      return true;
    }
    if (
      text.startsWith("{/*") &&
      text.endsWith("*/}") &&
      text.includes("@text-lint ignore end")
    ) {
      isInIgnoreBlock = false;
      currentIgnoreFile = null;
      return true;
    }
  }

  return false;
}

function hasIgnoreComment(node: Node): boolean {
  // 获取节点的所有前导注释
  const leadingComments = node.getLeadingCommentRanges();
  if (leadingComments && leadingComments.length > 0) {
    // 检查每个注释
    for (const comment of leadingComments) {
      const commentText = comment.getText();
      // 检查单行忽略
      if (commentText.includes("@text-lint ignore")) {
        return true;
      }
    }
  }

  // 获取前一个兄弟节点的 JSX 注释
  const previousSibling = node.getPreviousSibling();
  if (!previousSibling) return false;
  // 检查是否是 JSX 注释
  if (previousSibling.getKindName() === "JsxExpression") {
    const text = previousSibling.getText().trim();
    if (
      text.startsWith("{/*") &&
      text.endsWith("*/}") &&
      text.includes("@text-lint ignore")
    ) {
      return true;
    }
  }

  return false;
}

function isFragmentedText(node: Node): boolean {
  // 首先检查当前节点是否是 JsxText
  if (node.getKindName() !== "JsxText") return false;

  // 获取父节点
  const parent = node.getParent();
  if (!parent) return false;

  // 获取所有兄弟节点
  const siblings = parent.getChildren();

  // 找到 SyntaxList 节点
  const syntaxList = siblings.find(
    (s: Node) => s.getKindName() === "SyntaxList"
  );
  if (!syntaxList) return false;

  const syntaxListText = syntaxList.getText();

  return (
    /<[A-Za-z]/.test(syntaxListText) || // JSX 标签
    /\{[^}]+\}/.test(syntaxListText) || // JSX 表达式
    /\/\s*>/.test(syntaxListText) // 自闭合标签
  );
}

export interface TextLintError {
  line: number;
  message: string;
  ruleId: string;
}

export async function validateText(file: SourceFile): Promise<TextLintError[]> {
  const results: TextLintError[] = [];
  try {
    // 重置错误标识
    hasError = false;

    // 重置忽略块状态
    isInIgnoreBlock = false;
    currentIgnoreFile = null;

    const filePath = file.getFilePath();
    
    const forEachDescendantAsArray = file.forEachDescendantAsArray();

    for (const node of forEachDescendantAsArray) {
      // 检查是否是忽略块的开始或结束
      checkIgnoreBlock(node);

      // 如果在忽略块内，跳过检查
      if (isInIgnoreBlock && currentIgnoreFile === filePath) {
        continue;
      }

      // JSX 属性中的文案
      if (node.getKindName() === "JsxAttribute") {
        const attributeName = node.getChildAtIndex(0).getText();

        if (config.ignoreAttributes.includes(attributeName)) {
          continue;
        }

        // 检查目标属性
        if (config.targetAttributes.includes(attributeName)) {
          const value = node.getChildAtIndex(2); // 获取属性值
          if (value && !hasIgnoreComment(node)) {
            const lineNumber = value.getStartLineNumber();

            // 检查文本并收集错误
            const textLintResult = await engine.executeOnText(value.getText());
            if (
              textLintResult.length > 0 &&
              textLintResult[0].messages.length > 0
            ) {
              results.push(
                ...textLintResult[0].messages.map((msg) => ({
                  line: lineNumber,
                  message: msg.message,
                  ruleId: msg.ruleId,
                }))
              );
            }
          }
        }
      }

      // JSX 文本内容
      if (node.getKindName() === "JsxText") {
        const text = node.getText().trim();
        
        if (!text || isFragmentedText(node) || hasIgnoreComment(node)) {
          continue;
        }

        const lineNumber = node.getStartLineNumber();

        // 检查文本并收集错误
        const textLintResult = await engine.executeOnText(text);
        if (
          textLintResult.length > 0 &&
          textLintResult[0].messages.length > 0
        ) {
          results.push(
            ...textLintResult[0].messages.map((msg) => ({
              line: lineNumber,
              message: msg.message,
              ruleId: msg.ruleId,
            }))
          );
        }
      }
    }
  } catch (error) {
    console.error("检查过程发生错误:", error);
  }

  return results;
}
