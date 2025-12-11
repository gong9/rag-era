/**
 * 工具模块统一导出
 * 提供工具创建函数和工具上下文类型
 */
import type { VectorStoreIndex } from 'llamaindex';
import type { ToolCall } from '../output-parser';
import type { ToolContext } from './types';

// 导出类型
export type { ToolContext, SearchResult, WebSearchConfig } from './types';
export { getWebSearchConfig } from './types';

// 导出各工具创建函数
export { createSearchTool, createDeepSearchTool, createKeywordSearchTool } from './search-tools';
export { createGraphSearchTool } from './graph-search';
export { createSummarizeTool } from './summarize-tool';
export { createWebSearchTool, createFetchWebpageTool } from './web-tools';
export { createDateTimeTool } from './datetime-tool';
export { createDiagramTool } from './diagram-tool';

/**
 * 创建工具上下文
 */
export function createToolContext(
  index: VectorStoreIndex,
  knowledgeBaseId: string
): ToolContext {
  return {
    index,
    knowledgeBaseId,
    toolCalls: [],
    searchResults: [],
  };
}

/**
 * 创建所有工具
 */
export function createAllTools(ctx: ToolContext) {
  // 延迟导入，避免循环依赖
  const { createSearchTool, createDeepSearchTool, createKeywordSearchTool } = require('./search-tools');
  const { createGraphSearchTool } = require('./graph-search');
  const { createSummarizeTool } = require('./summarize-tool');
  const { createWebSearchTool, createFetchWebpageTool } = require('./web-tools');
  const { createDateTimeTool } = require('./datetime-tool');
  const { createDiagramTool } = require('./diagram-tool');
  
  return [
    createSearchTool(ctx),
    createDeepSearchTool(ctx),
    createKeywordSearchTool(ctx),
    createGraphSearchTool(ctx),
    createSummarizeTool(ctx),
    createWebSearchTool(ctx),
    createDateTimeTool(ctx),
    createFetchWebpageTool(ctx),
    createDiagramTool(ctx),
  ];
}

/**
 * 获取工具调用记录
 */
export function getToolCalls(ctx: ToolContext): ToolCall[] {
  return ctx.toolCalls;
}

/**
 * 获取检索结果
 */
export function getSearchResults(ctx: ToolContext): any[] {
  return ctx.searchResults;
}

