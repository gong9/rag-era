/**
 * Token 预算管理模块
 * 实现预算感知的记忆选择和自动截断
 */

import type { ScoredMemory } from './types';

/**
 * Token 预算配置
 */
interface BudgetConfig {
  maxTokens: number;          // 最大 token 预算
  reserveRatio: number;       // 预留比例（用于安全边际）
  truncateLastIfNeeded: boolean;  // 是否截断最后一条以适应预算
}

const DEFAULT_CONFIG: BudgetConfig = {
  maxTokens: 2000,
  reserveRatio: 0.1,          // 预留 10% 安全边际
  truncateLastIfNeeded: true,
};

/**
 * Token 预算管理器
 */
export class TokenBudgetManager {
  private config: BudgetConfig;
  
  constructor(config: Partial<BudgetConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * 估算文本的 token 数量
   * 中文约 3 字符/token，英文约 4 字符/token
   * 这里使用简单估算，实际可以换成更精确的 tokenizer
   */
  estimateTokens(text: string): number {
    // 统计中文字符数
    const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    // 非中文字符数
    const otherCount = text.length - chineseCount;
    
    // 中文约 1.5 字符/token，英文约 4 字符/token
    return Math.ceil(chineseCount / 1.5 + otherCount / 4);
  }
  
  /**
   * 获取有效预算（扣除预留）
   */
  getEffectiveBudget(): number {
    return Math.floor(this.config.maxTokens * (1 - this.config.reserveRatio));
  }
  
  /**
   * 选择记忆，直到预算用尽
   * 
   * @param memories 按分数排序的记忆列表
   * @returns 选中的记忆列表
   */
  selectMemories(memories: ScoredMemory[]): ScoredMemory[] {
    const effectiveBudget = this.getEffectiveBudget();
    const selected: ScoredMemory[] = [];
    let usedTokens = 0;
    
    for (const memory of memories) {
      const tokens = this.estimateTokens(memory.content);
      
      if (usedTokens + tokens <= effectiveBudget) {
        // 完全符合预算
        selected.push(memory);
        usedTokens += tokens;
      } else if (this.config.truncateLastIfNeeded && selected.length > 0) {
        // 接近预算限制，检查是否可以截断
        const remainingBudget = effectiveBudget - usedTokens;
        if (remainingBudget > 50) {  // 至少还有 50 token 空间
          // 截断记忆内容
          const truncatedContent = this.truncateToTokens(memory.content, remainingBudget);
          if (truncatedContent) {
            selected.push({
              ...memory,
              content: truncatedContent + '...',
            });
          }
        }
        break;  // 预算用尽，停止选择
      } else {
        break;  // 预算用尽
      }
    }
    
    return selected;
  }
  
  /**
   * 截断文本到指定 token 数
   */
  private truncateToTokens(text: string, maxTokens: number): string | null {
    if (maxTokens < 10) return null;
    
    // 估算每个字符的 token 数
    const totalTokens = this.estimateTokens(text);
    if (totalTokens <= maxTokens) return text;
    
    // 按比例截断
    const ratio = maxTokens / totalTokens;
    const targetLength = Math.floor(text.length * ratio * 0.9);  // 留点余量
    
    if (targetLength < 10) return null;
    
    return text.substring(0, targetLength);
  }
  
  /**
   * 格式化记忆为上下文字符串
   */
  formatMemoriesAsContext(memories: ScoredMemory[]): string {
    if (memories.length === 0) return '';
    
    const lines = memories.map((m, i) => {
      const typeLabel = this.getTypeLabel(m.type);
      return `- [${typeLabel}] ${m.content}`;
    });
    
    return lines.join('\n');
  }
  
  /**
   * 获取记忆类型的中文标签
   */
  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      preference: '偏好',
      fact: '事实',
      context: '背景',
      instruction: '指令',
    };
    return labels[type] || type;
  }
  
  /**
   * 获取预算使用统计
   */
  getBudgetStats(memories: ScoredMemory[]): {
    totalTokens: number;
    budget: number;
    usage: number;
    remaining: number;
  } {
    const totalTokens = memories.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0
    );
    const budget = this.getEffectiveBudget();
    
    return {
      totalTokens,
      budget,
      usage: totalTokens / budget,
      remaining: budget - totalTokens,
    };
  }
}

/**
 * 创建默认的预算管理器
 */
export function createBudgetManager(maxTokens?: number): TokenBudgetManager {
  return new TokenBudgetManager(maxTokens ? { maxTokens } : {});
}

