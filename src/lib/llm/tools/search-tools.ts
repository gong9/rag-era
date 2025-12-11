/**
 * 搜索工具模块
 * 包含 search_knowledge, deep_search, keyword_search
 */
import { FunctionTool } from 'llamaindex';
import { hybridSearch, formatSearchResults } from '../../hybrid-search';
import { meilisearchService } from '../../meilisearch';
import type { ToolContext } from './types';

/**
 * 创建混合检索工具
 */
export function createSearchTool(ctx: ToolContext) {
  return FunctionTool.from(
    async ({ query }: { query: string }): Promise<string> => {
      console.log(`[LLM] 🔍 Hybrid search: "${query}"`);
      
      const results = await hybridSearch(ctx.index, ctx.knowledgeBaseId, query, {
        vectorTopK: 5,
        keywordLimit: 5,
      });
      
      if (results.length === 0) {
        ctx.toolCalls.push({ tool: 'search_knowledge', input: query, output: '未找到相关内容' });
        return '未找到相关内容';
      }
      
      const formatted = formatSearchResults(results, 3);
      console.log(`[LLM] 🔍 Found ${results.length} results (showing top 3)`);
      ctx.toolCalls.push({ tool: 'search_knowledge', input: query, output: formatted.substring(0, 200) });
      
      // 保存检索结果用于前端展示
      if (ctx.searchResults.length === 0) {
        ctx.searchResults.push(...results);
      }
      
      return formatted;
    },
    {
      name: 'search_knowledge',
      description: '混合检索：结合语义搜索和关键词搜索。适用于查找具体信息、定义或事实。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或问题' },
        },
        required: ['query'],
      },
    }
  );
}

/**
 * 创建深度混合检索工具
 */
export function createDeepSearchTool(ctx: ToolContext) {
  return FunctionTool.from(
    async ({ query }: { query: string }): Promise<string> => {
      console.log(`[LLM] 📚 Deep hybrid search: "${query}"`);
      
      const results = await hybridSearch(ctx.index, ctx.knowledgeBaseId, query, {
        vectorTopK: 10,
        keywordLimit: 10,
      });
      
      if (results.length === 0) {
        ctx.toolCalls.push({ tool: 'deep_search', input: query, output: '未找到相关内容' });
        return '未找到相关内容';
      }
      
      const formatted = formatSearchResults(results, 8);
      console.log(`[LLM] 📚 Found ${results.length} results (showing top 8)`);
      ctx.toolCalls.push({ tool: 'deep_search', input: query, output: formatted.substring(0, 200) });
      
      // 保存检索结果
      if (ctx.searchResults.length === 0) {
        ctx.searchResults.push(...results);
      }
      
      return formatted;
    },
    {
      name: 'deep_search',
      description: '深度混合检索：获取更全面的信息。适用于需要多角度了解主题时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或问题' },
        },
        required: ['query'],
      },
    }
  );
}

/**
 * 创建关键词精确搜索工具
 */
export function createKeywordSearchTool(ctx: ToolContext) {
  return FunctionTool.from(
    async ({ query }: { query: string }): Promise<string> => {
      console.log(`[LLM] 🔤 Keyword search: "${query}"`);
      
      const results = await meilisearchService.search(ctx.knowledgeBaseId, query, 5);
      
      if (results.length === 0) {
        return '未找到匹配的内容';
      }
      
      const formatted = results
        .map((r, i) => `[来源${i + 1}: ${r.documentName}]\n${r.content}`)
        .join('\n\n');
      
      console.log(`[LLM] 🔤 Found ${results.length} keyword matches`);
      return formatted;
    },
    {
      name: 'keyword_search',
      description: '关键词精确搜索：适合搜索专有名词、文件名、代码、精确短语。当语义搜索找不到时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '精确搜索的关键词' },
        },
        required: ['query'],
      },
    }
  );
}

