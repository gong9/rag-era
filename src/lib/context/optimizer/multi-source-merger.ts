/**
 * 多源合并模块
 * 将 Memory + RAG + Tools + History 智能合并
 */

import type { ContextChunk, ContextStats, ScoredMemory, SearchResult } from '../types';

/**
 * 来源权重配置
 */
interface SourceWeights {
  memory: number;
  rag: number;
  tool: number;
  history: number;
}

const DEFAULT_WEIGHTS: SourceWeights = {
  memory: 1.2,    // 记忆略高权重
  rag: 1.0,       // RAG 基准
  tool: 0.8,      // 工具结果
  history: 0.6,   // 历史较低
};

/**
 * 将不同来源转换为统一的 ContextChunk
 */
export function normalizeToChunks(sources: {
  memories?: ScoredMemory[];
  ragResults?: SearchResult[];
  toolResults?: Array<{ content: string; tool: string }>;
  historySummary?: string;
}): ContextChunk[] {
  const chunks: ContextChunk[] = [];
  
  // 记忆
  if (sources.memories) {
    for (const memory of sources.memories) {
      chunks.push({
        id: `memory_${memory.id}`,
        content: memory.content,
        source: 'memory',
        priority: memory.score,
        tokens: estimateTokens(memory.content),
        metadata: { type: memory.type },
      });
    }
  }
  
  // RAG 结果
  if (sources.ragResults) {
    for (const result of sources.ragResults) {
      chunks.push({
        id: `rag_${result.id}`,
        content: result.content,
        source: 'rag',
        priority: result.score,
        tokens: estimateTokens(result.content),
        metadata: { documentName: result.documentName },
      });
    }
  }
  
  // 工具结果
  if (sources.toolResults) {
    for (const result of sources.toolResults) {
      chunks.push({
        id: `tool_${result.tool}_${Date.now()}`,
        content: result.content,
        source: 'tool',
        priority: 0.7,  // 工具结果默认优先级
        tokens: estimateTokens(result.content),
        metadata: { tool: result.tool },
      });
    }
  }
  
  // 历史摘要
  if (sources.historySummary) {
    chunks.push({
      id: 'history_summary',
      content: sources.historySummary,
      source: 'history',
      priority: 0.5,
      tokens: estimateTokens(sources.historySummary),
    });
  }
  
  return chunks;
}

/**
 * 估算 token 数
 */
function estimateTokens(text: string): number {
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCount = text.length - chineseCount;
  return Math.ceil(chineseCount / 1.5 + otherCount / 4);
}

/**
 * 按优先级排序 chunks
 */
export function sortChunksByPriority(
  chunks: ContextChunk[],
  weights: Partial<SourceWeights> = {}
): ContextChunk[] {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  
  return [...chunks].sort((a, b) => {
    const scoreA = a.priority * w[a.source];
    const scoreB = b.priority * w[b.source];
    return scoreB - scoreA;
  });
}

/**
 * 在预算内选择 chunks
 */
export function selectChunksWithinBudget(
  chunks: ContextChunk[],
  maxTokens: number
): ContextChunk[] {
  const selected: ContextChunk[] = [];
  let usedTokens = 0;
  
  for (const chunk of chunks) {
    if (usedTokens + chunk.tokens <= maxTokens) {
      selected.push(chunk);
      usedTokens += chunk.tokens;
    } else {
      // 检查是否可以部分包含
      const remaining = maxTokens - usedTokens;
      if (remaining > 50) {
        // 截断
        const ratio = remaining / chunk.tokens;
        const truncatedContent = chunk.content.substring(
          0, 
          Math.floor(chunk.content.length * ratio)
        ) + '...';
        selected.push({
          ...chunk,
          content: truncatedContent,
          tokens: remaining,
        });
      }
      break;
    }
  }
  
  return selected;
}

/**
 * 合并 chunks 为最终上下文
 */
export function mergeChunksToContext(chunks: ContextChunk[]): string {
  // 按来源分组
  const grouped: Record<string, ContextChunk[]> = {
    memory: [],
    rag: [],
    tool: [],
    history: [],
  };
  
  for (const chunk of chunks) {
    grouped[chunk.source].push(chunk);
  }
  
  const sections: string[] = [];
  
  // 记忆部分
  if (grouped.memory.length > 0) {
    const memoryContent = grouped.memory
      .map(c => `- ${c.content}`)
      .join('\n');
    sections.push(`## 用户记忆\n${memoryContent}`);
  }
  
  // RAG 部分
  if (grouped.rag.length > 0) {
    const ragContent = grouped.rag
      .map((c, i) => {
        const docName = c.metadata?.documentName || '未知文档';
        return `[来源${i + 1}: ${docName}]\n${c.content}`;
      })
      .join('\n\n');
    sections.push(`## 知识库检索结果\n${ragContent}`);
  }
  
  // 工具部分
  if (grouped.tool.length > 0) {
    const toolContent = grouped.tool
      .map(c => {
        const tool = c.metadata?.tool || '工具';
        return `[${tool}结果]\n${c.content}`;
      })
      .join('\n\n');
    sections.push(`## 工具执行结果\n${toolContent}`);
  }
  
  // 历史部分
  if (grouped.history.length > 0) {
    const historyContent = grouped.history.map(c => c.content).join('\n');
    sections.push(`## 对话历史摘要\n${historyContent}`);
  }
  
  return sections.join('\n\n');
}

/**
 * 计算上下文统计信息
 */
export function calculateStats(
  chunks: ContextChunk[],
  budgetTokens: number
): ContextStats {
  const totalTokens = chunks.reduce((sum, c) => sum + c.tokens, 0);
  
  const sources = {
    memory: 0,
    rag: 0,
    tool: 0,
    history: 0,
  };
  
  for (const chunk of chunks) {
    sources[chunk.source] += chunk.tokens;
  }
  
  return {
    totalTokens,
    budgetTokens,
    usageRatio: totalTokens / budgetTokens,
    chunkCount: chunks.length,
    sources,
  };
}

/**
 * 主合并函数
 */
export function mergeMultipleSources(
  sources: {
    memories?: ScoredMemory[];
    ragResults?: SearchResult[];
    toolResults?: Array<{ content: string; tool: string }>;
    historySummary?: string;
  },
  options: {
    maxTokens?: number;
    weights?: Partial<SourceWeights>;
  } = {}
): {
  context: string;
  chunks: ContextChunk[];
  stats: ContextStats;
} {
  const { maxTokens = 3000, weights } = options;
  
  // 1. 转换为统一格式
  const allChunks = normalizeToChunks(sources);
  
  // 2. 排序
  const sorted = sortChunksByPriority(allChunks, weights);
  
  // 3. 预算选择
  const selected = selectChunksWithinBudget(sorted, maxTokens);
  
  // 4. 合并
  const context = mergeChunksToContext(selected);
  
  // 5. 统计
  const stats = calculateStats(selected, maxTokens);
  
  return { context, chunks: selected, stats };
}

