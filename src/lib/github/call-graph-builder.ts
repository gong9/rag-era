/**
 * 代码符号提取器（简化版 - 已移除 tree-sitter）
 * 符号搜索功能已禁用，使用 Meilisearch 关键词搜索代替
 */

import { CodeFileInfo } from './repo-fetcher';

export interface ExtractedSymbol {
  name: string;
  qualifiedName: string;
  type: 'function' | 'class' | 'method' | 'variable' | 'interface';
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  exported: boolean;
  docComment?: string;
  semanticTags?: string[];
}

export interface SymbolExtractionResult {
  symbols: ExtractedSymbol[];
}

// 模块路径映射（用于关联符号和模块）
export interface ModuleMapping {
  moduleId: string;
  modulePath: string;
  moduleName: string;
}

/**
 * 提取代码库的符号（已禁用 - 返回空结果）
 * tree-sitter 已移除，使用 Meilisearch 关键词搜索代替
 */
export async function extractSymbols(
  files: CodeFileInfo[],
  onProgress?: (current: number, total: number, file: string) => void
): Promise<SymbolExtractionResult> {
  console.log(`[Symbol] 符号提取已禁用 (tree-sitter removed), 文件数: ${files.length}`);
  
  // 触发一次进度回调
  onProgress?.(files.length, files.length, '符号提取已跳过');
  
  return { symbols: [] };
}

/**
 * 将符号保存到数据库
 */
export async function saveSymbolsToDatabase(
  codeBaseId: string,
  result: SymbolExtractionResult,
  moduleMapping?: ModuleMapping[]
): Promise<void> {
  const { prisma } = await import('@/lib/prisma');
  
  console.log(`[Symbol] 跳过符号保存 (共 ${result.symbols.length} 个)`);
  
  // 清除旧符号（如果有）
  await prisma.codeSymbol.deleteMany({ where: { codeBaseId } });
}

/**
 * 获取符号统计信息
 */
export async function getSymbolStats(codeBaseId: string): Promise<{
  symbolCount: number;
  byType: Record<string, number>;
}> {
  const { prisma } = await import('@/lib/prisma');
  
  const symbols = await prisma.codeSymbol.findMany({
    where: { codeBaseId },
    select: { type: true },
  });
  
  const byType: Record<string, number> = {};
  for (const symbol of symbols) {
    byType[symbol.type] = (byType[symbol.type] || 0) + 1;
  }
  
  return {
    symbolCount: symbols.length,
    byType,
  };
}
