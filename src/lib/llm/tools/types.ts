/**
 * 工具模块共享类型定义
 */
import type { VectorStoreIndex } from 'llamaindex';
import type { ToolCall } from '../output-parser';

/**
 * 工具上下文 - 传递给工具工厂函数的依赖
 */
export interface ToolContext {
  /** 向量索引 */
  index: VectorStoreIndex;
  /** 知识库 ID */
  knowledgeBaseId: string;
  /** 工具调用记录（用于追踪） */
  toolCalls: ToolCall[];
  /** 检索结果（用于返回给前端） */
  searchResults: any[];
}

/**
 * 搜索结果
 */
export interface SearchResult {
  content: string;
  score: number;
  documentName?: string;
  source?: string;
}

/**
 * Web 搜索配置
 */
export interface WebSearchConfig {
  /** SearXNG 实例列表 */
  instances: string[];
  /** 请求超时（毫秒） */
  timeout: number;
  /** 最大无效调用次数 */
  maxInvalidCalls: number;
}

/**
 * 获取默认 Web 搜索配置
 */
export function getWebSearchConfig(): WebSearchConfig {
  return {
    instances: [
      process.env.SEARXNG_URL || 'http://39.96.203.251:8888',
    ],
    timeout: parseInt(process.env.WEB_SEARCH_TIMEOUT || '8000', 10),
    maxInvalidCalls: 3,
  };
}

