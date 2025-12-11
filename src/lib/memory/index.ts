/**
 * 智能记忆层
 * 
 * 核心功能：
 * - LLM 自动提取关键记忆
 * - 时间衰减 + 访问频率权重
 * - Token 预算感知的上下文构建
 * 
 * 使用方式：
 * ```typescript
 * import { getMemoryService } from '@/lib/memory';
 * 
 * // 获取服务实例
 * const memoryService = getMemoryService(knowledgeBaseId);
 * 
 * // 获取相关记忆上下文
 * const { context, stats } = await memoryService.getRelevantContext(query);
 * 
 * // 处理对话（自动提取记忆）
 * await memoryService.processConversation(question, answer);
 * ```
 */

// 类型导出
export type { 
  ExtractedMemory, 
  Memory, 
  ScoredMemory, 
  MemoryType,
  MemoryRetrievalOptions,
} from './types';

// 服务层导出
export { 
  MemoryService,
  createMemoryService,
  getMemoryService,
  clearServiceCache,
} from './service';

// 存储层导出
export { 
  MemoryStore,
  createMemoryStore,
} from './store';

// 提取器导出
export { 
  extractMemories,
  shouldExtractMemory,
  batchExtractMemories,
} from './extractor';

// 新鲜度评分导出
export { 
  calculateFreshnessScore,
  batchCalculateFreshness,
  sortByFreshness,
} from './freshness';

// 预算管理导出
export { 
  TokenBudgetManager,
  createBudgetManager,
} from './budget';

