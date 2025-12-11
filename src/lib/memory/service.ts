/**
 * 记忆服务层
 * 整合提取、存储、检索、预算管理，提供统一的对外接口
 */

import { MemoryStore, createMemoryStore } from './store';
import { extractMemories, shouldExtractMemory } from './extractor';
import { TokenBudgetManager, createBudgetManager } from './budget';
import type { ExtractedMemory, Memory, ScoredMemory, MemoryRetrievalOptions } from './types';

/**
 * 记忆服务配置
 */
interface MemoryServiceConfig {
  maxTokens?: number;           // 记忆上下文的 Token 预算
  autoExtract?: boolean;        // 是否自动提取记忆
  deduplicateOnSave?: boolean;  // 保存时是否去重
}

const DEFAULT_CONFIG: MemoryServiceConfig = {
  maxTokens: 2000,
  autoExtract: true,
  deduplicateOnSave: true,
};

/**
 * 记忆服务
 * 提供完整的记忆管理功能
 */
export class MemoryService {
  private store: MemoryStore;
  private budgetManager: TokenBudgetManager;
  private config: MemoryServiceConfig;
  private knowledgeBaseId: string;
  
  constructor(knowledgeBaseId: string, config: Partial<MemoryServiceConfig> = {}) {
    this.knowledgeBaseId = knowledgeBaseId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = createMemoryStore(knowledgeBaseId);
    this.budgetManager = createBudgetManager(this.config.maxTokens);
  }
  
  /**
   * 获取与查询相关的记忆上下文
   * 这是主要的对外接口，用于构建 Agent 的上下文
   */
  async getRelevantContext(
    query: string,
    options: MemoryRetrievalOptions = {}
  ): Promise<{
    memories: ScoredMemory[];
    context: string;
    stats: {
      totalMemories: number;
      selectedMemories: number;
      tokensUsed: number;
      tokenBudget: number;
    };
  }> {
    const { limit = 20, maxTokens, minRelevance = 0.5 } = options;  // 🔥 默认阈值改为 0.5
    
    console.log(`[MemoryService] Getting context for: ${query.substring(0, 50)}... (minRelevance: ${minRelevance})`);
    
    // 1. 检索相关记忆（传入阈值）
    let memories = await this.store.retrieve(query, limit, minRelevance);
    
    // 2. 二次过滤（以防万一）
    memories = memories.filter(m => m.relevanceScore >= minRelevance);
    
    // 3. Token 预算选择
    const budgetManager = maxTokens 
      ? createBudgetManager(maxTokens) 
      : this.budgetManager;
    
    const selected = budgetManager.selectMemories(memories);
    
    // 4. 更新访问记录
    if (selected.length > 0) {
      await this.store.touchMany(selected.map(m => m.id));
    }
    
    // 5. 格式化为上下文
    const context = budgetManager.formatMemoriesAsContext(selected);
    
    // 6. 统计信息
    const budgetStats = budgetManager.getBudgetStats(selected);
    
    console.log(`[MemoryService] Selected ${selected.length}/${memories.length} memories, ${budgetStats.totalTokens} tokens`);
    
    return {
      memories: selected,
      context,
      stats: {
        totalMemories: memories.length,
        selectedMemories: selected.length,
        tokensUsed: budgetStats.totalTokens,
        tokenBudget: budgetStats.budget,
      },
    };
  }
  
  /**
   * 从对话中提取并保存记忆
   * 在每次对话结束后调用
   */
  async processConversation(question: string, answer: string): Promise<Memory[]> {
    // 检查是否需要提取
    if (!this.config.autoExtract || !shouldExtractMemory(question, answer)) {
      console.log('[MemoryService] Skipping memory extraction');
      return [];
    }
    
    console.log('[MemoryService] Processing conversation for memory extraction');
    
    // 1. 提取记忆
    const extracted = await extractMemories(question, answer);
    
    if (extracted.length === 0) {
      return [];
    }
    
    // 2. 去重检查
    const toSave: ExtractedMemory[] = [];
    if (this.config.deduplicateOnSave) {
      for (const memory of extracted) {
        const exists = await this.store.hasSimilar(memory.content);
        if (!exists) {
          toSave.push(memory);
        }
      }
    } else {
      toSave.push(...extracted);
    }
    
    // 3. 保存
    if (toSave.length > 0) {
      const saved = await this.store.saveMany(toSave);
      console.log(`[MemoryService] Saved ${saved.length} new memories`);
      return saved;
    }
    
    return [];
  }
  
  /**
   * 手动添加记忆
   */
  async addMemory(memory: ExtractedMemory): Promise<Memory> {
    // 去重检查
    if (this.config.deduplicateOnSave) {
      const exists = await this.store.hasSimilar(memory.content);
      if (exists) {
        throw new Error('Similar memory already exists');
      }
    }
    
    return this.store.save(memory);
  }
  
  /**
   * 获取所有记忆
   */
  async getAllMemories(): Promise<Memory[]> {
    return this.store.getAll();
  }
  
  /**
   * 删除记忆
   */
  async deleteMemory(memoryId: string): Promise<void> {
    return this.store.delete(memoryId);
  }
  
  /**
   * 获取记忆统计
   */
  async getStats(): Promise<{
    totalCount: number;
    byType: Record<string, number>;
  }> {
    const all = await this.store.getAll();
    
    const byType: Record<string, number> = {};
    for (const memory of all) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
    }
    
    return {
      totalCount: all.length,
      byType,
    };
  }
  
  /**
   * 清空所有记忆
   */
  async clearAll(): Promise<number> {
    const all = await this.store.getAll();
    for (const memory of all) {
      await this.store.delete(memory.id);
    }
    return all.length;
  }
}

/**
 * 创建记忆服务实例
 */
export function createMemoryService(
  knowledgeBaseId: string,
  config?: Partial<MemoryServiceConfig>
): MemoryService {
  return new MemoryService(knowledgeBaseId, config);
}

/**
 * 记忆服务缓存（避免重复创建）
 */
const serviceCache = new Map<string, MemoryService>();

/**
 * 获取或创建记忆服务（带缓存）
 */
export function getMemoryService(
  knowledgeBaseId: string,
  config?: Partial<MemoryServiceConfig>
): MemoryService {
  const cacheKey = knowledgeBaseId;
  
  if (!serviceCache.has(cacheKey)) {
    serviceCache.set(cacheKey, createMemoryService(knowledgeBaseId, config));
  }
  
  return serviceCache.get(cacheKey)!;
}

/**
 * 清除服务缓存
 */
export function clearServiceCache(): void {
  serviceCache.clear();
}

