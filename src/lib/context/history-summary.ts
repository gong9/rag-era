/**
 * 历史摘要模块
 * 对长对话历史进行压缩摘要
 */

import { Settings } from 'llamaindex';

/**
 * 摘要配置
 */
interface SummaryConfig {
  maxHistoryLength: number;    // 触发摘要的历史长度
  summaryMaxTokens: number;    // 摘要的最大 token 数
  keepRecentCount: number;     // 保留最近几轮不摘要
}

const DEFAULT_CONFIG: SummaryConfig = {
  maxHistoryLength: 10,
  summaryMaxTokens: 500,
  keepRecentCount: 3,
};

/**
 * 摘要 Prompt
 */
const SUMMARY_PROMPT = `请将以下对话历史压缩为简洁的摘要，保留关键信息：
- 用户的主要问题和意图
- 重要的结论和答案
- 任何需要记住的上下文

对话历史：
{history}

请输出简洁的摘要（不超过 200 字）：`;

/**
 * 摘要缓存
 */
const summaryCache = new Map<string, {
  summary: string;
  historyHash: string;
  createdAt: Date;
}>();

/**
 * 计算历史的哈希（用于缓存）
 */
function hashHistory(history: Array<{ role: string; content: string }>): string {
  const str = history.map(h => `${h.role}:${h.content}`).join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * 生成对话历史摘要
 */
export async function generateHistorySummary(
  sessionId: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  config: Partial<SummaryConfig> = {}
): Promise<{
  summary: string | null;
  recentHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // 历史不够长，不需要摘要
  if (chatHistory.length <= cfg.maxHistoryLength) {
    return {
      summary: null,
      recentHistory: chatHistory,
    };
  }
  
  // 分割：需要摘要的部分 + 保留的最近部分
  const toSummarize = chatHistory.slice(0, -cfg.keepRecentCount * 2);
  const recentHistory = chatHistory.slice(-cfg.keepRecentCount * 2);
  
  // 检查缓存
  const historyHash = hashHistory(toSummarize);
  const cached = summaryCache.get(sessionId);
  if (cached && cached.historyHash === historyHash) {
    console.log('[HistorySummary] Using cached summary');
    return {
      summary: cached.summary,
      recentHistory,
    };
  }
  
  // 生成摘要
  console.log(`[HistorySummary] Summarizing ${toSummarize.length} messages...`);
  
  const historyText = toSummarize
    .map(h => `${h.role === 'user' ? '用户' : 'AI'}: ${h.content}`)
    .join('\n');
  
  const prompt = SUMMARY_PROMPT.replace('{history}', historyText);
  
  try {
    const llm = Settings.llm;
    if (!llm) {
      console.warn('[HistorySummary] LLM not configured');
      return { summary: null, recentHistory: chatHistory };
    }
    
    const response = await llm.complete({ prompt });
    const summary = response.text.trim();
    
    // 缓存
    summaryCache.set(sessionId, {
      summary,
      historyHash,
      createdAt: new Date(),
    });
    
    console.log(`[HistorySummary] Generated summary: ${summary.substring(0, 100)}...`);
    
    return {
      summary,
      recentHistory,
    };
  } catch (error) {
    console.error('[HistorySummary] Failed to generate summary:', error);
    return {
      summary: null,
      recentHistory: chatHistory,
    };
  }
}

/**
 * 格式化历史摘要为上下文
 */
export function formatHistorySummaryAsContext(
  summary: string | null,
  recentHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const parts: string[] = [];
  
  if (summary) {
    parts.push(`## 之前的对话摘要\n${summary}`);
  }
  
  if (recentHistory.length > 0) {
    const recentText = recentHistory
      .map(h => `${h.role === 'user' ? '用户' : 'AI'}: ${h.content}`)
      .join('\n');
    parts.push(`## 最近的对话\n${recentText}`);
  }
  
  return parts.join('\n\n');
}

/**
 * 清除摘要缓存
 */
export function clearSummaryCache(sessionId?: string): void {
  if (sessionId) {
    summaryCache.delete(sessionId);
  } else {
    summaryCache.clear();
  }
}

/**
 * 简化的历史压缩（不使用 LLM，仅截断）
 * 用于不需要精确摘要的场景
 */
export function compressHistorySimple(
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxRounds: number = 5
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (chatHistory.length <= maxRounds * 2) {
    return chatHistory;
  }
  
  // 保留第一轮（可能包含重要上下文）和最近几轮
  const first = chatHistory.slice(0, 2);
  const recent = chatHistory.slice(-(maxRounds - 1) * 2);
  
  return [...first, ...recent];
}

