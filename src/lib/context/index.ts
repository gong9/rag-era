/**
 * 上下文工程系统
 * 
 * 统一管理：
 * - 意图分析（Intent）
 * - 记忆系统（Memory）
 * - RAG 优化
 * - 上下文优化
 * 
 * 使用方式：
 * ```typescript
 * import { getContextEngine, analyzeIntent } from '@/lib/context';
 * 
 * // 意图分析
 * const intent = await analyzeIntent(query, chatHistory);
 * 
 * // 构建上下文
 * const engine = getContextEngine();
 * const { context, stats } = await engine.buildContext({
 *   knowledgeBaseId,
 *   sessionId,
 *   userId,
 *   query,
 *   chatHistory,
 *   intent,
 * });
 * ```
 */

// 类型导出
export type {
  Memory,
  ScoredMemory,
  MemoryType,
  TaskState,
  UserProfile,
  RetrievalDecision,
  SearchResult,
  FusedResult,
  ContextChunk,
  ContextStats,
  ContextBuildOptions,
  BuiltContext,
} from './types';

// 意图分析（核心模块）
export {
  intentTypes,
  analyzeIntent,
  detectIntentFast,
  generateDirectResponse,
  shouldSkipAgent,
  getContextWeights,
} from './intent';
export type { IntentType, IntentResult } from './intent';

// 主引擎
export {
  ContextEngine,
  createContextEngine,
  getContextEngine,
} from './engine';

// 任务状态
export {
  getTaskState,
  createTaskState,
  setCurrentTask,
  addSubTask,
  updateSubTaskStatus,
  clearTaskState,
  formatTaskStateAsContext,
} from './task-state';

// 历史摘要
export {
  generateHistorySummary,
  formatHistorySummaryAsContext,
  compressHistorySimple,
  clearSummaryCache,
} from './history-summary';

// RAG 优化
export * from './rag';

// 上下文优化
export * from './optimizer';

// 自适应上下文（Agent 循环中动态更新）
export {
  AdaptiveContextManager,
  createAdaptiveContextManager,
} from './adaptive-context';
export type { UpdateConditions } from './adaptive-context';

export {
  wrapFunctionTool,
  wrapAllTools,
  createContextAwareToolContext,
} from './context-aware-tools';
export type { ContextAwareToolContext } from './context-aware-tools';

