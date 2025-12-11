/**
 * 智能记忆层类型定义
 */

/**
 * 记忆类型
 */
export type MemoryType = 'preference' | 'fact' | 'context' | 'instruction';

/**
 * 提取的记忆（LLM 提取后的结构）
 */
export interface ExtractedMemory {
  content: string;      // 记忆内容
  type: MemoryType;     // 记忆类型
  confidence: number;   // 置信度 0-1
}

/**
 * 数据库中的记忆
 */
export interface Memory {
  id: string;
  knowledgeBaseId: string;
  content: string;
  type: string;
  confidence: number;
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  vectorNodeId: string | null;
}

/**
 * 带分数的记忆（用于排序）
 */
export interface ScoredMemory extends Memory {
  score: number;        // 综合评分
  relevanceScore: number;  // 语义相关性
  freshnessScore: number;  // 新鲜度评分
}

/**
 * 记忆检索选项
 */
export interface MemoryRetrievalOptions {
  limit?: number;           // 最多返回数量
  maxTokens?: number;       // Token 预算
  minRelevance?: number;    // 最低相关性阈值
  types?: MemoryType[];     // 过滤记忆类型
}

