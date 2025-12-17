/**
 * 代码解析器
 * 使用正则表达式提取 TypeScript/JavaScript 代码结构
 * 第一阶段实现，后续可升级到 tree-sitter
 */

export interface CodeBlock {
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'import' | 'export' | 'component';
  name: string;
  filePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  content: string;
  signature?: string;
  docComment?: string;
  exported: boolean;
  language: string;
}

export interface ParseResult {
  blocks: CodeBlock[];
  imports: string[];
  exports: string[];
  totalLines: number;
}

/**
 * 解析代码文件，提取结构化信息
 */
export function parseCodeFile(
  content: string,
  filePath: string,
  relativePath: string,
  language: string
): ParseResult {
  const lines = content.split('\n');
  const blocks: CodeBlock[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  
  // 提取导入语句
  const importMatches = content.matchAll(/^import\s+(?:{[^}]+}|[^;]+)\s+from\s+['"]([^'"]+)['"]/gm);
  for (const match of importMatches) {
    imports.push(match[1]);
  }
  
  // 提取导出语句
  const exportMatches = content.matchAll(/^export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)\s+(\w+)/gm);
  for (const match of exportMatches) {
    exports.push(match[1]);
  }

  // 根据语言选择解析策略
  if (['ts', 'tsx', 'js', 'jsx'].includes(language)) {
    blocks.push(...parseTypeScriptBlocks(content, filePath, relativePath, language));
  } else if (language === 'md') {
    // Markdown 文件作为整体处理
    blocks.push({
      type: 'export',
      name: relativePath.replace(/\.md$/, ''),
      filePath,
      relativePath,
      startLine: 1,
      endLine: lines.length,
      content: content,
      exported: true,
      language,
    });
  } else if (language === 'json') {
    // JSON 文件只在较小时处理
    if (lines.length <= 100) {
      blocks.push({
        type: 'export',
        name: relativePath.replace(/\.json$/, ''),
        filePath,
        relativePath,
        startLine: 1,
        endLine: lines.length,
        content: content,
        exported: true,
        language,
      });
    }
  }

  return {
    blocks,
    imports,
    exports,
    totalLines: lines.length,
  };
}

/**
 * 解析 TypeScript/JavaScript 代码块
 */
function parseTypeScriptBlocks(
  content: string,
  filePath: string,
  relativePath: string,
  language: string
): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');
  
  // 正则表达式模式
  const patterns = {
    // 函数声明: function name() 或 async function name()
    functionDecl: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)/,
    
    // 箭头函数: const name = () => 或 const name = async () =>
    arrowFunction: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/,
    
    // 类声明: class Name 或 export class Name
    classDecl: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[^{]+)?/,
    
    // 接口声明: interface Name
    interfaceDecl: /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[^{]+)?/,
    
    // 类型声明: type Name =
    typeDecl: /^(?:export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/,
    
    // React 组件: export default function Component 或 const Component: React.FC
    reactComponent: /^(?:export\s+(?:default\s+)?)?(?:const|function)\s+([A-Z]\w+)(?:\s*:\s*React\.(?:FC|FunctionComponent))?/,
    
    // 变量声明: export const name =
    variableDecl: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=/,
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // 跳过空行和注释
    if (!trimmedLine || trimmedLine.startsWith('//')) {
      i++;
      continue;
    }

    // 检查 JSDoc 注释
    let docComment: string | undefined;
    if (trimmedLine.startsWith('/**')) {
      const docStart = i;
      while (i < lines.length && !lines[i].includes('*/')) {
        i++;
      }
      docComment = lines.slice(docStart, i + 1).join('\n');
      i++;
      if (i >= lines.length) break;
    }

    const currentLine = lines[i]?.trim() || '';
    let match: RegExpMatchArray | null = null;
    let type: CodeBlock['type'] = 'variable';

    // 尝试匹配各种模式
    if ((match = currentLine.match(patterns.classDecl))) {
      type = 'class';
    } else if ((match = currentLine.match(patterns.interfaceDecl))) {
      type = 'interface';
    } else if ((match = currentLine.match(patterns.typeDecl))) {
      type = 'type';
    } else if ((match = currentLine.match(patterns.reactComponent)) && currentLine.match(/[A-Z]/)) {
      type = 'component';
    } else if ((match = currentLine.match(patterns.functionDecl))) {
      type = 'function';
    } else if ((match = currentLine.match(patterns.arrowFunction))) {
      type = 'function';
    } else if ((match = currentLine.match(patterns.variableDecl))) {
      type = 'variable';
    }

    if (match) {
      const name = match[1];
      const startLine = i + 1;
      const exported = currentLine.startsWith('export');
      
      // 找到代码块的结束位置
      const endLine = findBlockEnd(lines, i);
      const blockContent = lines.slice(i, endLine).join('\n');
      
      // 提取签名（第一行）
      const signature = currentLine;

      blocks.push({
        type,
        name,
        filePath,
        relativePath,
        startLine,
        endLine,
        content: docComment ? `${docComment}\n${blockContent}` : blockContent,
        signature,
        docComment,
        exported,
        language,
      });

      i = endLine;
    } else {
      i++;
    }
  }

  return blocks;
}

/**
 * 找到代码块的结束行
 * 通过跟踪大括号匹配来确定
 */
function findBlockEnd(lines: string[], startIndex: number): number {
  let braceCount = 0;
  let started = false;
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    
    // 统计大括号
    for (const char of line) {
      if (char === '{') {
        braceCount++;
        started = true;
      } else if (char === '}') {
        braceCount--;
      }
    }
    
    // 如果大括号匹配完成，返回结束行
    if (started && braceCount === 0) {
      return i + 1;
    }
    
    // 对于单行声明（如 type 或简单变量）
    if (!started && (line.includes(';') || (line.includes('=') && !line.includes('{')))) {
      return i + 1;
    }
  }
  
  // 如果没找到匹配，返回最后一行
  return lines.length;
}

/**
 * 合并小的代码块
 * 将相邻的小块合并为一个较大的块
 */
export function mergeSmallBlocks(blocks: CodeBlock[], minLines: number = 10): CodeBlock[] {
  if (blocks.length === 0) return blocks;
  
  const result: CodeBlock[] = [];
  let currentGroup: CodeBlock[] = [];
  let currentFile = '';
  
  for (const block of blocks) {
    // 如果是新文件，处理之前的组
    if (block.filePath !== currentFile) {
      if (currentGroup.length > 0) {
        result.push(...processGroup(currentGroup, minLines));
      }
      currentGroup = [block];
      currentFile = block.filePath;
    } else {
      currentGroup.push(block);
    }
  }
  
  // 处理最后一组
  if (currentGroup.length > 0) {
    result.push(...processGroup(currentGroup, minLines));
  }
  
  return result;
}

function processGroup(blocks: CodeBlock[], minLines: number): CodeBlock[] {
  // 如果只有一个块，直接返回
  if (blocks.length === 1) return blocks;
  
  const result: CodeBlock[] = [];
  let pending: CodeBlock[] = [];
  let pendingLines = 0;
  
  for (const block of blocks) {
    const blockLines = block.endLine - block.startLine + 1;
    
    // 如果当前块足够大，单独保留
    if (blockLines >= minLines) {
      // 先处理待合并的小块
      if (pending.length > 0) {
        result.push(mergeBlocks(pending));
        pending = [];
        pendingLines = 0;
      }
      result.push(block);
    } else {
      // 累积小块
      pending.push(block);
      pendingLines += blockLines;
      
      // 如果累积的行数足够多，合并它们
      if (pendingLines >= minLines) {
        result.push(mergeBlocks(pending));
        pending = [];
        pendingLines = 0;
      }
    }
  }
  
  // 处理剩余的小块
  if (pending.length > 0) {
    result.push(mergeBlocks(pending));
  }
  
  return result;
}

function mergeBlocks(blocks: CodeBlock[]): CodeBlock {
  if (blocks.length === 1) return blocks[0];
  
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  
  return {
    type: 'export',
    name: blocks.map(b => b.name).join(', '),
    filePath: first.filePath,
    relativePath: first.relativePath,
    startLine: first.startLine,
    endLine: last.endLine,
    content: blocks.map(b => b.content).join('\n\n'),
    exported: blocks.some(b => b.exported),
    language: first.language,
  };
}

