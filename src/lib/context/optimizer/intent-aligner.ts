/**
 * 意图对齐模块
 * 根据意图调整上下文权重和组织方式
 * 
 * 注意：意图分析在 context/intent/analyzer.ts 中
 * 本模块只负责根据意图结果调整上下文
 */

import type { ContextChunk } from '../types';
import type { IntentType } from '../intent';
import { getContextWeights } from '../intent';

/**
 * 根据意图过滤和调整 chunks 权重
 */
export function filterChunksByIntent(
  chunks: ContextChunk[],
  intent: IntentType
): ContextChunk[] {
  const weights = getContextWeights(intent);
  
  // 根据来源和意图调整优先级
  return chunks.map(chunk => ({
    ...chunk,
    priority: chunk.priority * (weights[chunk.source as keyof typeof weights] || 1),
  }));
}

/**
 * 对齐上下文与意图
 */
export function alignContextWithIntent(
  context: string,
  query: string,
  intent: IntentType,
  keywords: string[] = []
): string {
  // 根据意图添加引导提示
  const intentPrompts: Record<string, string> = {
    greeting: '',
    small_talk: '',
    document_summary: '请基于以上信息进行总结归纳。',
    knowledge_query: '请基于以上信息回答问题。',
    comparison: '请基于以上信息进行对比分析。',
    draw_diagram: '请基于以上信息生成图表。',
    web_search: '请基于搜索结果回答。',
    datetime: '',
    instruction: '请基于以上信息执行用户的指令。',
  };
  
  const prompt = intentPrompts[intent] || '';
  
  // 高亮关键词（可选）
  let alignedContext = context;
  if (keywords.length > 0) {
    const keywordHint = `\n\n关注关键词: ${keywords.join(', ')}`;
    alignedContext += keywordHint;
  }
  
  if (prompt) {
    alignedContext += `\n\n${prompt}`;
  }
  
  return alignedContext;
}

/**
 * 验证上下文与意图的一致性
 */
export function validateAlignment(
  context: string,
  query: string,
  intent: IntentType
): {
  isAligned: boolean;
  score: number;
  suggestions: string[];
} {
  const suggestions: string[] = [];
  let score = 1.0;
  
  // 检查上下文是否为空
  if (!context || context.trim().length < 50) {
    suggestions.push('上下文内容太少，可能无法回答问题');
    score -= 0.3;
  }
  
  // 检查是否包含查询关键词
  const queryWords = query.split(/[\s，。！？]+/).filter(w => w.length > 1);
  const coveredWords = queryWords.filter(w => context.includes(w));
  const coverage = queryWords.length > 0 
    ? coveredWords.length / queryWords.length 
    : 0;
  
  if (coverage < 0.3) {
    suggestions.push('上下文与查询的关键词覆盖度较低');
    score -= 0.2;
  }
  
  // 意图特定检查
  switch (intent) {
    case 'comparison':
      if (!context.includes('与') && !context.includes('和') && !context.includes('对比')) {
        suggestions.push('对比类问题可能需要更多对比对象的信息');
        score -= 0.1;
      }
      break;
    case 'document_summary':
      if (context.length < 500) {
        suggestions.push('总结类问题可能需要更多原始内容');
        score -= 0.1;
      }
      break;
  }
  
  return {
    isAligned: score >= 0.7,
    score: Math.max(0, score),
    suggestions,
  };
}

