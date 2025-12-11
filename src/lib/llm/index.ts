/**
 * LLM 模块统一导出
 * 保持与原 llm.ts 相同的 API，确保调用方无需修改
 */

// 导出配置
export { configureLLM, getDefaultConfig, resetConfig, isLLMConfigured } from './config';
export type { LLMConfig } from './config';

// 导出索引管理
export { 
  createOrUpdateIndex, 
  loadIndex, 
  deleteIndex, 
  indexExists,
  getStorageDir 
} from './index-manager';

// 导出 Agent
export { query, agenticQuery } from './agent';
export type { AgentQueryResult } from './agent';

// 导出意图分析
export { 
  analyzeIntent, 
  generateDirectResponse, 
  shouldSkipAgent,
  intentTypes 
} from './intent-analyzer';
export type { IntentResult, IntentType } from './intent-analyzer';

// 导出输出解析
export { parseAgentOutput, fixMermaidFormat, toolNameMap } from './output-parser';
export type { ToolCall, ParsedAgentOutput } from './output-parser';

// 导出质量评估
export { 
  evaluateQuality, 
  preCheckFormat, 
  finalValidation,
  buildEvaluationContext 
} from './quality-evaluator';
export type { EvaluationContext, EvaluationResult } from './quality-evaluator';

// 导出工具
export { 
  createToolContext, 
  createAllTools,
  getToolCalls,
  getSearchResults,
  getWebSearchConfig
} from './tools';
export type { ToolContext, SearchResult, WebSearchConfig } from './tools';

/**
 * LLMService 类 - 保持与原 API 兼容
 * 所有方法都是静态方法，直接调用底层模块
 */
export class LLMService {
  /**
   * 获取存储目录
   */
  private static getStorageDir(knowledgeBaseId: string): string {
    const { getStorageDir } = require('./index-manager');
    return getStorageDir(knowledgeBaseId);
  }

  /**
   * 创建或更新知识库索引
   */
  static async createOrUpdateIndex(
    knowledgeBaseId: string,
    documentsPath: string,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<void> {
    const { createOrUpdateIndex } = require('./index-manager');
    return createOrUpdateIndex(knowledgeBaseId, documentsPath, onProgress);
  }

  /**
   * 加载已存在的索引
   */
  static async loadIndex(knowledgeBaseId: string): Promise<any> {
    const { loadIndex } = require('./index-manager');
    return loadIndex(knowledgeBaseId);
  }

  /**
   * 查询知识库（普通 RAG 模式）
   */
  static async query(
    knowledgeBaseId: string, 
    question: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<any> {
    const { query } = require('./agent');
    return query(knowledgeBaseId, question, chatHistory);
  }

  /**
   * Agentic RAG 模式查询
   */
  static async agenticQuery(
    knowledgeBaseId: string, 
    question: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<any> {
    const { agenticQuery } = require('./agent');
    return agenticQuery(knowledgeBaseId, question, chatHistory);
  }

  /**
   * 删除知识库索引
   */
  static async deleteIndex(knowledgeBaseId: string): Promise<void> {
    const { deleteIndex } = require('./index-manager');
    return deleteIndex(knowledgeBaseId);
  }

  /**
   * 检查索引是否存在
   */
  static async indexExists(knowledgeBaseId: string): Promise<boolean> {
    const { indexExists } = require('./index-manager');
    return indexExists(knowledgeBaseId);
  }
}

