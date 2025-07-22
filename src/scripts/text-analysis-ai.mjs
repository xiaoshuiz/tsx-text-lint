#!/usr/bin/env node

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const analysisResults = {
  files: [],
  summary: {
    totalFiles: 0,
    filesWithIssues: 0,
    totalIssues: 0,
    criticalIssues: 0,
    warnings: 0,
  },
};

function getChangedFiles() {
  try {
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    console.log('工作目录:', workspace);

    const output = execSync('git diff --name-only origin/main...HEAD', {
      cwd: workspace,
      encoding: 'utf8',
    }).toString();

    console.log('Git diff 输出:', output);

    const files = output
      .split('\n')
      .filter((file) => file && /\.tsx?$/.test(file))
      .map((file) => resolve(workspace, file));

    console.log('找到的TSX文件:', files);
    return files;
  } catch (error) {
    console.error('获取修改文件失败:', error);
    return [];
  }
}

async function analyzeFileWithGemini(filePath, fileContent) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const relativePath = getRelativePath(filePath);

    const prompt = `
你是一个专业的宠物SaaS系统UI文案检查专家。这是一个面向英语母语宠物店商家的前端系统，需要专业、友好、易懂的文案。

文件路径: ${relativePath}
文件内容:
\`\`\`typescript
${fileContent}
\`\`\`

请从以下维度分析文件中的UI文案（只关注最重要的1-5个问题，避免过度检查）：

1. **语法检查**: 检查英文语法、标点符号、大小写等基本错误
2. **语义检查**: 检查文案是否清晰易懂，避免歧义
3. **变量插值检查**: 检查 {变量名} 格式的变量插值是否合理
4. **用户体验检查**: 检查文案是否适合宠物店商家理解
5. **产品一致性**: 检查是否符合宠物SaaS系统的专业调性

**重要：你必须严格按照以下JSON格式返回结果，不要添加任何其他文字：**

{
  "issues": [
    {
      "type": "error|warning|info",
      "category": "语法|语义|变量|用户体验|产品一致性",
      "message": "具体问题描述",
      "suggestion": "改进建议",
      "line": 行号,
      "text": "有问题的文案"
    }
  ],
  "overall": "pass|warning|error",
  "summary": "总体评价"
}

检查原则：
- 只分析用户可见的UI文案，忽略注释、变量名、函数名等
- 重点关注 JSX 中的文本内容、placeholder、title、alt 等属性
- 优先检查明显的错误（如测试文案、语法错误）
- 对于宠物行业术语，保持专业但易懂
- 如果文案基本正确，不要过度挑剔
- 最多返回1-5个最重要的问题，避免token浪费
- **必须返回纯JSON格式，不要有任何其他文字**
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text();

    try {
      let cleanResponse = responseText.trim();

      // 如果响应被 ```json 包围，提取其中的JSON
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const analysis = JSON.parse(cleanResponse);
      return {
        issues: analysis.issues || [],
        overall: analysis.overall || 'pass',
        summary: analysis.summary || '检查完成',
      };
    } catch (parseError) {
      console.error('解析Gemini响应失败:', parseError);
      console.error('原始响应:', responseText);
      return {
        issues: [
          {
            type: 'warning',
            category: '系统',
            message: 'AI分析响应解析失败',
            suggestion: '请手动检查文案',
          },
        ],
        overall: 'warning',
        summary: 'AI分析异常',
      };
    }
  } catch (error) {
    console.error('Gemini API调用失败:', error);
    return {
      issues: [
        {
          type: 'error',
          category: '系统',
          message: 'AI服务调用失败',
          suggestion: '请检查API配置或稍后重试',
        },
      ],
      overall: 'error',
      summary: 'AI服务异常',
    };
  }
}

// 批量分析文件
async function batchAnalyzeFiles(filesWithContent) {
  const batchSize = 2;
  const results = [];

  for (let i = 0; i < filesWithContent.length; i += batchSize) {
    const batch = filesWithContent.slice(i, i + batchSize);
    console.log(`正在分析第 ${i + 1}-${Math.min(i + batchSize, filesWithContent.length)} 个文件...`);

    const batchPromises = batch.map(async ({ filePath, content }) => {
      const result = await analyzeFileWithGemini(filePath, content);
      return { filePath, ...result };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // 添加延迟避免API限制
    if (i + batchSize < filesWithContent.length) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  return results;
}

function getRelativePath(absolutePath) {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  if (absolutePath.startsWith(workspace)) {
    return absolutePath.substring(workspace.length + 1); // +1 去掉开头的斜杠
  }
  return absolutePath;
}

function readFileContent(filePath) {
  try {
    console.log('正在读取文件:', filePath);
    const content = execSync(`cat "${filePath}"`, { encoding: 'utf8' });
    return content;
  } catch (error) {
    console.error(`读取文件失败 ${filePath}:`, error);
    return null;
  }
}

async function analyzeFiles() {
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    console.log('没有需要检查的 TSX 文件');
    return;
  }

  console.log(`发现 ${changedFiles.length} 个修改的TSX文件`);

  const filesToAnalyze = [];

  for (const filePath of changedFiles) {
    const content = readFileContent(filePath);
    if (content) {
      filesToAnalyze.push({
        filePath,
        content,
      });
      console.log(`文件 ${filePath} 已读取，大小: ${content.length} 字符`);
    }
  }

  console.log(`共发现 ${filesToAnalyze.length} 个文件需要分析`);

  if (filesToAnalyze.length === 0) {
    return;
  }

  const batchResults = await batchAnalyzeFiles(filesToAnalyze);

  const fileResultsMap = new Map();

  for (const result of batchResults) {
    const { filePath, issues, overall, summary } = result;
    const relativePath = getRelativePath(filePath);

    if (!fileResultsMap.has(relativePath)) {
      fileResultsMap.set(relativePath, {
        path: relativePath,
        issues: [],
        lineCount: 0,
      });
    }

    const fileResult = fileResultsMap.get(relativePath);

    if (issues && issues.length > 0) {
      for (const issue of issues) {
        fileResult.issues.push({
          line: issue.line || 0,
          text: issue.text || '未知文案',
          attribute: 'text',
          issues: [issue],
          overall: overall,
          summary: summary,
        });
      }
    }
  }

  analysisResults.files = Array.from(fileResultsMap.values());
  analysisResults.summary.filesWithIssues = analysisResults.files.filter((f) => f.issues.length > 0).length;
  analysisResults.summary.totalIssues = analysisResults.files.reduce((sum, f) => sum + f.issues.length, 0);
  analysisResults.summary.totalFiles = fileResultsMap.size;
}

function generateMarkdownReport(results) {
  let md = `## 🤖 AI文案检查报告\n\n`;
  md += `**检查时间：** ${new Date().toLocaleString('zh-CN')}\n\n`;
  md += `**共检查文件数：** ${results.summary.totalFiles}\n\n`;
  md += `**发现问题数：** ${results.summary.totalIssues}\n\n`;

  if (results.files.length === 0) {
    md += `🎉 **未发现文案问题！**\n\n`;
    md += `所有文案都通过了AI检查，继续保持！\n`;
    return md;
  }

  const criticalIssues = [];
  const warningIssues = [];
  const infoIssues = [];

  for (const file of results.files) {
    for (const issue of file.issues) {
      for (const i of issue.issues) {
        const issueItem = {
          file: file.path,
          line: issue.line,
          text: issue.text,
          attribute: issue.attribute,
          issue: i,
        };

        if (i.type === 'error') {
          criticalIssues.push(issueItem);
        } else if (i.type === 'warning') {
          warningIssues.push(issueItem);
        } else {
          infoIssues.push(issueItem);
        }
      }
    }
  }

  if (criticalIssues.length > 0) {
    md += `### ❌ 需要修复 (${criticalIssues.length})\n\n`;
    for (const item of criticalIssues) {
      md += `**文件：** \`${item.file}:${item.line}\`\n`;
      md += `**文案：** \`${item.text}\`\n`;
      md += `**问题：** ${item.issue.message}\n`;
      if (item.issue.suggestion) {
        md += `**建议：** ${item.issue.suggestion}\n`;
      }
      md += `\n`;
    }
  }

  if (warningIssues.length > 0) {
    md += `### ⚠️ 建议优化 (${warningIssues.length})\n\n`;
    for (const item of warningIssues) {
      md += `**文件：** \`${item.file}:${item.line}\`\n`;
      md += `**文案：** \`${item.text}\`\n`;
      md += `**问题：** ${item.issue.message}\n`;
      if (item.issue.suggestion) {
        md += `**建议：** ${item.issue.suggestion}\n`;
      }
      md += `\n`;
    }
  }

  if (infoIssues.length > 0) {
    md += `### ℹ️ 参考信息 (${infoIssues.length})\n\n`;
    for (const item of infoIssues) {
      md += `**文件：** \`${item.file}:${item.line}\`\n`;
      md += `**文案：** \`${item.text}\`\n`;
      md += `**信息：** ${item.issue.message}\n`;
      if (item.issue.suggestion) {
        md += `**建议：** ${item.issue.suggestion}\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\n`;
  md += `*此报告由 Gemini AI 自动生成，专注于提升用户体验。*\n`;

  return md;
}

// 检查环境变量
if (!process.env.GEMINI_API_KEY) {
  console.error('错误: 未设置 GEMINI_API_KEY 环境变量');
  process.exit(1);
}

console.log('开始AI文案检查...');

try {
  await analyzeFiles();

  const report = generateMarkdownReport(analysisResults);
  const reportPath = 'text-analysis-report.md';
  writeFileSync(reportPath, report, 'utf8');

  console.log('检查完成！');
  console.log(`发现 ${analysisResults.summary.totalIssues} 个问题`);

  // 输出给GitHub Actions (新语法)
  console.log(`has-issues=${analysisResults.summary.totalIssues > 0 ? 'true' : 'false'}`);
  console.log(`report-path=${reportPath}`);

  // 写入GitHub Actions输出文件
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    writeFileSync(
      outputFile,
      `has-issues=${analysisResults.summary.totalIssues > 0 ? 'true' : 'false'}\nreport-path=${reportPath}\n`,
      { flag: 'a' },
    );
  }
} catch (error) {
  console.error('检查过程发生错误:', error);
  process.exit(1);
}
