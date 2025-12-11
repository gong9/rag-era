/**
 * 自适应上下文管理
 * 在 Agent 循环过程中条件性更新上下文
 */

import { getContextEngine } from './engine';
import type { IntentResult } from './intent';
import type { BuiltContext, SearchResult } from './types';

/**
 * 更新触发条件配置
 */
export interface UpdateConditions {
  /** 累计 N 次工具调用后更新 */
  afterToolCalls: number;
  /** token 使用超过阈值时更新 */
  tokenThreshold: number;
  /** 检测到追问时更新 */
  onFollowUpDetected: boolean;
  /** 发现新实体时更新 */
  onNewEntityDiscovered: boolean;
}

const DEFAULT_CONDITIONS: UpdateConditions = {
  afterToolCalls: 3,
  tokenThreshold: 2000,
  onFollowUpDetected: true,
  onNewEntityDiscovered: true,
};

/**
 * 工具调用记录
 */
interface ToolCallRecord {
  tool: string;
  input: string;
  output: string;
  timestamp: number;
  entities?: string[];  // 发现的实体
}

/**
 * 自适应上下文状态
 */
interface AdaptiveContextState {
  /** 初始上下文 */
  initialContext: BuiltContext;
  /** 当前上下文（可能已更新） */
  currentContext: BuiltContext;
  /** 工具调用记录 */
  toolCalls: ToolCallRecord[];
  /** 发现的实体集合 */
  discoveredEntities: Set<string>;
  /** 上次更新时的工具调用数 */
  lastUpdateAtCallCount: number;
  /** 更新次数 */
  updateCount: number;
}

/**
 * 自适应上下文管理器
 */
export class AdaptiveContextManager {
  private state: AdaptiveContextState;
  private conditions: UpdateConditions;
  private knowledgeBaseId: string;
  private sessionId: string;
  private query: string;
  private intent: IntentResult;
  private chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  
  constructor(options: {
    initialContext: BuiltContext;
    knowledgeBaseId: string;
    sessionId: string;
    query: string;
    intent: IntentResult;
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    conditions?: Partial<UpdateConditions>;
  }) {
    this.state = {
      initialContext: options.initialContext,
      currentContext: options.initialContext,
      toolCalls: [],
      discoveredEntities: new Set(),
      lastUpdateAtCallCount: 0,
      updateCount: 0,
    };
    this.conditions = { ...DEFAULT_CONDITIONS, ...options.conditions };
    this.knowledgeBaseId = options.knowledgeBaseId;
    this.sessionId = options.sessionId;
    this.query = options.query;
    this.intent = options.intent;
    this.chatHistory = options.chatHistory;
  }
  
  /**
   * 记录工具调用
   */
  recordToolCall(tool: string, input: string, output: string): void {
    const entities = this.extractEntities(output);
    
    this.state.toolCalls.push({
      tool,
      input,
      output,
      timestamp: Date.now(),
      entities,
    });
    
    // 记录新发现的实体
    entities.forEach(e => this.state.discoveredEntities.add(e));
    
    console.log(`[AdaptiveContext] Tool call recorded: ${tool}, entities: ${entities.length}`);
  }
  
  /**
   * 检查是否需要更新上下文
   */
  shouldUpdate(): { needUpdate: boolean; reason: string } {
    const callCount = this.state.toolCalls.length;
    const callsSinceLastUpdate = callCount - this.state.lastUpdateAtCallCount;
    
    // 条件 1：累计工具调用次数
    if (callsSinceLastUpdate >= this.conditions.afterToolCalls) {
      return { 
        needUpdate: true, 
        reason: `工具调用达到 ${callsSinceLastUpdate} 次` 
      };
    }
    
    // 条件 2：发现新实体
    if (this.conditions.onNewEntityDiscovered) {
      const recentCall = this.state.toolCalls[callCount - 1];
      if (recentCall?.entities && recentCall.entities.length >= 3) {
        return { 
          needUpdate: true, 
          reason: `发现 ${recentCall.entities.length} 个新实体` 
        };
      }
    }
    
    // 条件 3：检测到追问模式
    if (this.conditions.onFollowUpDetected && this.isFollowUpQuery()) {
      return { 
        needUpdate: true, 
        reason: `检测到追问` 
      };
    }
    
    // 条件 4：上下文 token 超限
    if (this.estimateCurrentTokens() > this.conditions.tokenThreshold) {
      return { 
        needUpdate: true, 
        reason: `token 超过 ${this.conditions.tokenThreshold}` 
      };
    }
    
    return { needUpdate: false, reason: '' };
  }
  
  /**
   * 执行增量上下文更新
   */
  async updateContext(): Promise<BuiltContext> {
    console.log(`[AdaptiveContext] Updating context (update #${this.state.updateCount + 1})...`);
    
    const contextEngine = getContextEngine();
    
    // 构建增强查询（包含工具调用摘要）
    const toolSummary = this.summarizeToolCalls();
    const enhancedQuery = `${this.query}\n\n【已获取的信息】\n${toolSummary}`;
    
    // 重新构建上下文
    const newContext = await contextEngine.buildContext({
      knowledgeBaseId: this.knowledgeBaseId,
      sessionId: this.sessionId,
      userId: 'default',
      query: enhancedQuery,
      chatHistory: this.chatHistory,
      maxTokens: 2500,  // 留出空间给新工具结果
      intent: this.intent,
    });
    
    // 合并新旧上下文
    const mergedContext = this.mergeContexts(this.state.currentContext, newContext);
    
    // 更新状态
    this.state.currentContext = mergedContext;
    this.state.lastUpdateAtCallCount = this.state.toolCalls.length;
    this.state.updateCount++;
    
    console.log(`[AdaptiveContext] Context updated, new token estimate: ${this.estimateCurrentTokens()}`);
    
    return mergedContext;
  }
  
  /**
   * 获取当前上下文
   */
  getCurrentContext(): BuiltContext {
    return this.state.currentContext;
  }
  
  /**
   * 获取增强的上下文字符串（包含工具调用摘要）
   */
  getEnhancedContextString(): string {
    const baseContext = this.state.currentContext.context;
    
    if (this.state.toolCalls.length === 0) {
      return baseContext;
    }
    
    // 添加工具调用摘要
    const toolSummary = this.summarizeToolCalls();
    
    return `${baseContext}\n\n## 已执行的操作\n${toolSummary}`;
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    toolCallCount: number;
    updateCount: number;
    discoveredEntities: number;
    currentTokens: number;
  } {
    return {
      toolCallCount: this.state.toolCalls.length,
      updateCount: this.state.updateCount,
      discoveredEntities: this.state.discoveredEntities.size,
      currentTokens: this.estimateCurrentTokens(),
    };
  }
  
  // ========== 私有方法 ==========
  
  /**
   * 从工具输出中提取实体
   */
  private extractEntities(output: string): string[] {
    const entities: string[] = [];
    
    // 提取函数名
    const funcMatches = output.match(/function\s+(\w+)|(\w+)\s*\(.*?\)/g);
    if (funcMatches) {
      funcMatches.forEach(m => {
        const name = m.replace(/function\s+/, '').replace(/\(.*/, '');
        if (name.length > 2) entities.push(name);
      });
    }
    
    // 提取类名
    const classMatches = output.match(/class\s+(\w+)|interface\s+(\w+)|type\s+(\w+)/g);
    if (classMatches) {
      classMatches.forEach(m => {
        const name = m.replace(/(class|interface|type)\s+/, '');
        if (name.length > 2) entities.push(name);
      });
    }
    
    // 提取文件路径
    const pathMatches = output.match(/[\w\-]+\.(ts|js|tsx|jsx|py|java|go)/g);
    if (pathMatches) {
      entities.push(...pathMatches);
    }
    
    // 提取中文术语（知识库场景）
    const termMatches = output.match(/「([^」]+)」|【([^】]+)】/g);
    if (termMatches) {
      termMatches.forEach(m => {
        const term = m.replace(/[「」【】]/g, '');
        if (term.length >= 2) entities.push(term);
      });
    }
    
    return [...new Set(entities)].slice(0, 10);  // 去重，最多 10 个
  }
  
  /**
   * 检测是否是追问
   */
  private isFollowUpQuery(): boolean {
    const followUpPatterns = [
      /那个/,
      /上面的/,
      /之前的/,
      /刚才/,
      /这个.*呢/,
      /还有.*吗/,
      /继续/,
      /接着/,
      /然后呢/,
      /什么意思/,
      /怎么.*的/,
    ];
    
    return followUpPatterns.some(p => p.test(this.query));
  }
  
  /**
   * 估算当前 token 数
   */
  private estimateCurrentTokens(): number {
    const contextTokens = Math.ceil(this.state.currentContext.context.length / 3);
    const toolTokens = this.state.toolCalls.reduce((sum, call) => {
      return sum + Math.ceil((call.input.length + call.output.length) / 3);
    }, 0);
    return contextTokens + toolTokens;
  }
  
  /**
   * 摘要工具调用
   */
  private summarizeToolCalls(): string {
    if (this.state.toolCalls.length === 0) return '';
    
    return this.state.toolCalls.map((call, i) => {
      const outputPreview = call.output.length > 200 
        ? call.output.substring(0, 200) + '...' 
        : call.output;
      return `${i + 1}. ${call.tool}(${call.input.substring(0, 50)}...)\n   → ${outputPreview}`;
    }).join('\n\n');
  }
  
  /**
   * 合并新旧上下文
   */
  private mergeContexts(oldContext: BuiltContext, newContext: BuiltContext): BuiltContext {
    // 合并记忆（去重）
    const memoryIds = new Set(oldContext.memories.map(m => m.id));
    const mergedMemories = [
      ...oldContext.memories,
      ...newContext.memories.filter(m => !memoryIds.has(m.id)),
    ];
    
    // 合并 RAG 结果（去重，保留分数更高的）
    const ragMap = new Map<string, SearchResult>();
    [...oldContext.ragResults, ...newContext.ragResults].forEach(r => {
      const existing = ragMap.get(r.id);
      if (!existing || r.score > existing.score) {
        ragMap.set(r.id, r);
      }
    });
    const mergedRag = Array.from(ragMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);  // 最多保留 10 个
    
    // 使用新的 context 字符串（已包含更新的信息）
    return {
      ...newContext,
      memories: mergedMemories,
      ragResults: mergedRag,
      stats: {
        ...newContext.stats,
        totalTokens: Math.ceil((mergedMemories.length * 50 + mergedRag.length * 100)),
      },
    };
  }
}

/**
 * 创建自适应上下文管理器
 */
export function createAdaptiveContextManager(options: {
  initialContext: BuiltContext;
  knowledgeBaseId: string;
  sessionId: string;
  query: string;
  intent: IntentResult;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  conditions?: Partial<UpdateConditions>;
}): AdaptiveContextManager {
  return new AdaptiveContextManager(options);
}

