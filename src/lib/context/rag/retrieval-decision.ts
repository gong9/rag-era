/**
 * 检索决策器
 * 智能判断是否需要检索、检索什么、检索多少
 */

import type { RetrievalDecision } from '../types';

/**
 * 查询类型检测规则
 */
interface QueryPattern {
  pattern: RegExp | string[];
  queryType: RetrievalDecision['queryType'];
  priority: RetrievalDecision['priority'];
}

const QUERY_PATTERNS: QueryPattern[] = [
  // 关系查询 -> 图谱检索
  {
    pattern: ['谁是', '关系', '上级', '下级', '负责', '属于', '隶属'],
    queryType: 'graph',
    priority: 'high',
  },
  // 精确查找 -> 关键词检索
  {
    pattern: ['.pdf', '.doc', '.txt', '文件名', '搜索', '查找'],
    queryType: 'keyword',
    priority: 'high',
  },
  // 概念定义 -> 语义检索
  {
    pattern: ['什么是', '如何', '为什么', '怎么', '定义', '概念'],
    queryType: 'semantic',
    priority: 'medium',
  },
  // 总结类 -> 混合检索
  {
    pattern: ['总结', '概述', '讲了什么', '主要内容', '核心观点'],
    queryType: 'hybrid',
    priority: 'high',
  },
];

/**
 * 不需要检索的查询模式
 */
const SKIP_RETRIEVAL_PATTERNS = [
  /^(你好|hi|hello|嗨)/i,
  /^(谢谢|感谢|好的|明白|知道了)/,
  /^(再见|拜拜|bye)/i,
  /^(是|否|对|不对|好|不好)$/,
  /现在几点|什么时间|今天日期/,
  /天气|气温|下雨|下雪/,  // 天气查询不需要知识库
];

/**
 * 不需要检索知识库的意图类型
 */
const SKIP_KB_INTENTS = [
  'greeting',
  'small_talk', 
  'web_search',
  'time_query',
];

/**
 * 检索决策
 */
export function makeRetrievalDecision(
  query: string,
  options: {
    hasKnowledgeBase?: boolean;
    chatHistoryLength?: number;
    previousQueryType?: string;
  } = {}
): RetrievalDecision {
  const { hasKnowledgeBase = true, chatHistoryLength = 0 } = options;
  
  // 没有知识库，不检索
  if (!hasKnowledgeBase) {
    return {
      shouldRetrieve: false,
      reason: '没有可用的知识库',
      queryType: 'hybrid',
      estimatedResults: 0,
      priority: 'low',
    };
  }
  
  // 检查是否匹配跳过检索的模式
  for (const pattern of SKIP_RETRIEVAL_PATTERNS) {
    if (pattern.test(query)) {
      return {
        shouldRetrieve: false,
        reason: '闲聊/简单回复，无需检索',
        queryType: 'hybrid',
        estimatedResults: 0,
        priority: 'low',
      };
    }
  }
  
  // 查询太短
  if (query.length < 3) {
    return {
      shouldRetrieve: false,
      reason: '查询太短',
      queryType: 'hybrid',
      estimatedResults: 0,
      priority: 'low',
    };
  }
  
  // 匹配查询模式
  for (const { pattern, queryType, priority } of QUERY_PATTERNS) {
    const matches = Array.isArray(pattern)
      ? pattern.some(p => query.includes(p))
      : pattern.test(query);
    
    if (matches) {
      return {
        shouldRetrieve: true,
        reason: `匹配${queryType}检索模式`,
        queryType,
        estimatedResults: queryType === 'graph' ? 5 : 10,
        priority,
      };
    }
  }
  
  // 默认：混合检索
  return {
    shouldRetrieve: true,
    reason: '默认混合检索',
    queryType: 'hybrid',
    estimatedResults: 8,
    priority: 'medium',
  };
}

/**
 * 计算检索数量
 */
export function calculateRetrievalCount(
  decision: RetrievalDecision,
  options: {
    maxTokenBudget?: number;
    averageChunkTokens?: number;
  } = {}
): {
  vectorTopK: number;
  keywordLimit: number;
  graphLimit: number;
} {
  const { maxTokenBudget = 2000, averageChunkTokens = 150 } = options;
  
  // 基于 token 预算计算
  const maxChunks = Math.floor(maxTokenBudget / averageChunkTokens);
  
  // 根据优先级调整
  const priorityMultiplier = 
    decision.priority === 'high' ? 1.5 :
    decision.priority === 'medium' ? 1.0 : 0.7;
  
  const baseCount = Math.floor(maxChunks * priorityMultiplier);
  
  // 根据检索类型分配
  switch (decision.queryType) {
    case 'semantic':
      return {
        vectorTopK: baseCount,
        keywordLimit: 0,
        graphLimit: 0,
      };
    case 'keyword':
      return {
        vectorTopK: 2,
        keywordLimit: baseCount,
        graphLimit: 0,
      };
    case 'graph':
      return {
        vectorTopK: 3,
        keywordLimit: 0,
        graphLimit: baseCount,
      };
    case 'hybrid':
    default:
      return {
        vectorTopK: Math.ceil(baseCount * 0.6),
        keywordLimit: Math.ceil(baseCount * 0.4),
        graphLimit: 0,
      };
  }
}

/**
 * 生成检索策略摘要
 */
export function summarizeRetrievalStrategy(decision: RetrievalDecision): string {
  if (!decision.shouldRetrieve) {
    return `跳过检索: ${decision.reason}`;
  }
  
  const counts = calculateRetrievalCount(decision);
  const parts: string[] = [];
  
  if (counts.vectorTopK > 0) parts.push(`向量:${counts.vectorTopK}`);
  if (counts.keywordLimit > 0) parts.push(`关键词:${counts.keywordLimit}`);
  if (counts.graphLimit > 0) parts.push(`图谱:${counts.graphLimit}`);
  
  return `${decision.queryType}检索 [${parts.join(', ')}] - ${decision.reason}`;
}

