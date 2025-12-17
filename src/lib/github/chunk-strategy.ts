/**
 * 代码智能分块策略
 * 将代码转换为适合 RAG 检索的文档块
 */

import { CodeBlock, parseCodeFile, mergeSmallBlocks } from './code-parser';
import { CodeFileInfo, readCodeFile } from './repo-fetcher';
import { Document } from 'llamaindex';

export interface CodeChunk {
  id: string;
  content: string;
  metadata: {
    filePath: string;
    relativePath: string;
    language: string;
    type: string;
    name: string;
    startLine: number;
    endLine: number;
    exported: boolean;
    signature?: string;
  };
}

/**
 * 将代码文件转换为文档块
 * @param files 代码文件列表
 * @param onProgress 进度回调
 */
export async function createCodeChunks(
  files: CodeFileInfo[],
  onProgress?: (current: number, total: number, file: string) => void
): Promise<CodeChunk[]> {
  const chunks: CodeChunk[] = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.relativePath);
    
    try {
      const content = await readCodeFile(file.path);
      if (!content.trim()) continue;
      
      const result = parseCodeFile(content, file.path, file.relativePath, file.language);
      
      // 合并小的代码块
      const mergedBlocks = mergeSmallBlocks(result.blocks, 15);
      
      if (mergedBlocks.length === 0) {
        // 如果没有解析出块，将整个文件作为一个块
        // 但要限制大小
        const lines = content.split('\n');
        if (lines.length <= 200) {
          chunks.push({
            id: `${file.relativePath}:1-${lines.length}`,
            content: formatChunkContent(file.relativePath, content, file.language),
            metadata: {
              filePath: file.path,
              relativePath: file.relativePath,
              language: file.language,
              type: 'file',
              name: file.relativePath.split('/').pop() || file.relativePath,
              startLine: 1,
              endLine: lines.length,
              exported: true,
            },
          });
        } else {
          // 对于大文件，按固定行数分块
          const chunkSize = 100;
          for (let start = 0; start < lines.length; start += chunkSize) {
            const end = Math.min(start + chunkSize, lines.length);
            const chunkContent = lines.slice(start, end).join('\n');
            
            chunks.push({
              id: `${file.relativePath}:${start + 1}-${end}`,
              content: formatChunkContent(file.relativePath, chunkContent, file.language, start + 1, end),
              metadata: {
                filePath: file.path,
                relativePath: file.relativePath,
                language: file.language,
                type: 'file-part',
                name: `${file.relativePath.split('/').pop()} (lines ${start + 1}-${end})`,
                startLine: start + 1,
                endLine: end,
                exported: true,
              },
            });
          }
        }
      } else {
        // 将解析出的代码块转换为 chunks
        for (const block of mergedBlocks) {
          chunks.push({
            id: `${file.relativePath}:${block.startLine}-${block.endLine}`,
            content: formatChunkContent(
              file.relativePath,
              block.content,
              file.language,
              block.startLine,
              block.endLine,
              block.type,
              block.name
            ),
            metadata: {
              filePath: block.filePath,
              relativePath: block.relativePath,
              language: block.language,
              type: block.type,
              name: block.name,
              startLine: block.startLine,
              endLine: block.endLine,
              exported: block.exported,
              signature: block.signature,
            },
          });
        }
      }
    } catch (error) {
      console.error(`[Chunk] Failed to process ${file.relativePath}:`, error);
    }
  }
  
  console.log(`[Chunk] Created ${chunks.length} chunks from ${files.length} files`);
  return chunks;
}

/**
 * 格式化 chunk 内容，添加元数据上下文
 */
function formatChunkContent(
  relativePath: string,
  content: string,
  language: string,
  startLine?: number,
  endLine?: number,
  type?: string,
  name?: string
): string {
  const header = [
    `【文件: ${relativePath}】`,
    startLine && endLine ? `【行号: ${startLine}-${endLine}】` : null,
    type && name ? `【${type}: ${name}】` : null,
    `【语言: ${language}】`,
  ].filter(Boolean).join(' ');
  
  return `${header}\n\n${content}`;
}

/**
 * 将代码块转换为 LlamaIndex Document
 */
export function chunksToDocuments(chunks: CodeChunk[]): Document[] {
  return chunks.map(chunk => {
    const doc = new Document({
      text: chunk.content,
      metadata: {
        ...chunk.metadata,
        chunkId: chunk.id,
      },
    });
    return doc;
  });
}

/**
 * 统计代码块信息
 */
export function getChunkStats(chunks: CodeChunk[]): {
  totalChunks: number;
  byType: Record<string, number>;
  byLanguage: Record<string, number>;
  avgLinesPerChunk: number;
} {
  const byType: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  let totalLines = 0;
  
  for (const chunk of chunks) {
    const { type, language, startLine, endLine } = chunk.metadata;
    
    byType[type] = (byType[type] || 0) + 1;
    byLanguage[language] = (byLanguage[language] || 0) + 1;
    totalLines += endLine - startLine + 1;
  }
  
  return {
    totalChunks: chunks.length,
    byType,
    byLanguage,
    avgLinesPerChunk: chunks.length > 0 ? Math.round(totalLines / chunks.length) : 0,
  };
}

