/**
 * 新鲜度评分模块
 * 实现时间衰减 + 访问频率加权
 */

import type { Memory } from './types';

/**
 * 衰减参数配置
 */
interface DecayConfig {
  // 时间衰减系数，值越大衰减越快
  // 0.05 表示约 14 小时后权重降为一半
  timeDecayFactor: number;
  
  // 访问频率加成系数
  frequencyBonus: number;
}

const DEFAULT_CONFIG: DecayConfig = {
  timeDecayFactor: 0.05,
  frequencyBonus: 0.1,
};

/**
 * 计算记忆的新鲜度评分
 * 
 * 公式: score = confidence * decay * (1 + frequencyBonus)
 * - decay = exp(-factor * hours)  指数衰减
 * - frequencyBonus = log(accessCount + 1) * bonus  对数增长
 * 
 * @param memory 记忆对象
 * @param now 当前时间（默认为当前）
 * @param config 衰减配置
 * @returns 新鲜度评分 (0-1 之间)
 */
export function calculateFreshnessScore(
  memory: Memory,
  now: Date = new Date(),
  config: DecayConfig = DEFAULT_CONFIG
): number {
  // 计算距离上次访问的小时数
  const hoursSinceAccess = (now.getTime() - memory.lastAccessedAt.getTime()) / 3600000;
  
  // 指数衰减
  const decayFactor = Math.exp(-config.timeDecayFactor * hoursSinceAccess);
  
  // 访问频率加成（对数增长，避免过度加权）
  const frequencyBonus = Math.log(memory.accessCount + 1) * config.frequencyBonus;
  
  // 综合评分
  const score = memory.confidence * decayFactor * (1 + frequencyBonus);
  
  // 限制在 0-1 范围
  return Math.max(0, Math.min(1, score));
}

/**
 * 批量计算新鲜度评分
 */
export function batchCalculateFreshness(
  memories: Memory[],
  now: Date = new Date()
): Array<{ memory: Memory; freshnessScore: number }> {
  return memories.map(memory => ({
    memory,
    freshnessScore: calculateFreshnessScore(memory, now),
  }));
}

/**
 * 按新鲜度排序记忆
 */
export function sortByFreshness(
  memories: Memory[],
  now: Date = new Date()
): Memory[] {
  const scored = batchCalculateFreshness(memories, now);
  return scored
    .sort((a, b) => b.freshnessScore - a.freshnessScore)
    .map(s => s.memory);
}

