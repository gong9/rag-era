/**
 * 上下文工程系统类型定义
 */

// ==================== 记忆相关 ====================

export type MemoryType = 'preference' | 'fact' | 'context' | 'instruction';

export interface Memory {
  id: string;
  content: string;
  type: string;
  confidence: number;
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
}

export interface ScoredMemory extends Memory {
  score: number;
  relevanceScore: number;
  freshnessScore: number;
}

// ==================== 任务状态 ====================

export interface TaskState {
  sessionId: string;
  currentTask: string | null;
  subTasks: Array<{
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
  context: Record<string, any>;
  lastUpdated: Date;
}

// ==================== 用户画像 ====================

export interface UserProfile {
  userId: string;
  preferences: Array<{
    key: string;
    value: string;
    confidence: number;
  }>;
  topics: Array<{
    topic: string;
    frequency: number;
  }>;
  style: {
    preferredLength: 'short' | 'medium' | 'long';
    formality: 'casual' | 'formal';
    language: string;
  };
  lastUpdated: Date;
}

// ==================== RAG 相关 ====================

export interface RetrievalDecision {
  shouldRetrieve: boolean;
  reason: string;
  queryType: 'semantic' | 'keyword' | 'hybrid' | 'graph';
  estimatedResults: number;
  priority: 'high' | 'medium' | 'low';
}

export interface SearchResult {
  id: string;
  content: string;
  documentName: string;
  score: number;
  source: 'vector' | 'keyword' | 'graph' | 'hybrid';
  metadata?: Record<string, any>;
}

export interface FusedResult extends SearchResult {
  fusionScore: number;
  sources: string[];
  deduplicated: boolean;
}

// ==================== 上下文优化 ====================

export interface ContextChunk {
  id: string;
  content: string;
  source: 'memory' | 'rag' | 'tool' | 'history';
  priority: number;
  tokens: number;
  metadata?: Record<string, any>;
}

export interface ContextStats {
  totalTokens: number;
  budgetTokens: number;
  usageRatio: number;
  chunkCount: number;
  sources: {
    memory: number;
    rag: number;
    tool: number;
    history: number;
  };
}

// ==================== 统一上下文 ====================

export interface ContextBuildOptions {
  knowledgeBaseId: string;
  sessionId: string;
  userId: string;
  query: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  includeMemory?: boolean;
  includeRag?: boolean;
  includeHistory?: boolean;
}

export interface BuiltContext {
  // 最终上下文字符串
  context: string;
  
  // 各来源的原始数据
  memories: ScoredMemory[];
  ragResults: SearchResult[];
  historySummary: string | null;
  taskState: TaskState | null;
  
  // 统计信息
  stats: ContextStats;
  
  // 调试信息
  debug?: {
    retrievalDecision: RetrievalDecision;
    compressionApplied: boolean;
    chunksBeforeOptimization: number;
    chunksAfterOptimization: number;
  };
}

