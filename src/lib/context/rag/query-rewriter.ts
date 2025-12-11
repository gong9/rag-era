/**
 * 查询改写模块
 * 基于上下文优化查询，提升召回效果
 */

import { Settings } from 'llamaindex';

/**
 * 改写策略
 */
type RewriteStrategy = 'expand' | 'refine' | 'decompose' | 'none';

/**
 * 查询改写结果
 */
interface RewriteResult {
  originalQuery: string;
  rewrittenQuery: string;
  strategy: RewriteStrategy;
  subQueries?: string[];  // 分解后的子查询
  keywords?: string[];    // 提取的关键词
}

/**
 * 简单的查询扩展（基于规则）
 */
export function expandQuerySimple(query: string): string[] {
  const variations: string[] = [query];
  
  // 同义词替换
  const synonyms: Record<string, string[]> = {
    '如何': ['怎么', '怎样', '方法'],
    '什么是': ['定义', '含义', '概念'],
    '为什么': ['原因', '理由'],
    '区别': ['差异', '不同', '对比'],
  };
  
  for (const [word, syns] of Object.entries(synonyms)) {
    if (query.includes(word)) {
      for (const syn of syns) {
        variations.push(query.replace(word, syn));
      }
    }
  }
  
  return [...new Set(variations)];
}

/**
 * 基于历史上下文改写查询
 */
export function rewriteWithContext(
  query: string,
  context: {
    previousQuery?: string;
    previousAnswer?: string;
    memories?: Array<{ content: string }>;
  }
): string {
  // 检测指代词
  const pronouns = ['这个', '那个', '它', '他们', '这些', '上面'];
  const hasPronouns = pronouns.some(p => query.includes(p));
  
  if (!hasPronouns) {
    return query;
  }
  
  // 尝试从上一轮对话中提取实体
  if (context.previousQuery && context.previousAnswer) {
    // 简单的实体提取（可以用 LLM 增强）
    const entities = extractEntities(context.previousAnswer);
    if (entities.length > 0) {
      // 替换指代词
      let rewritten = query;
      for (const pronoun of pronouns) {
        if (rewritten.includes(pronoun)) {
          rewritten = rewritten.replace(pronoun, entities[0]);
          break;
        }
      }
      return rewritten;
    }
  }
  
  return query;
}

/**
 * 简单的实体提取
 */
function extractEntities(text: string): string[] {
  const entities: string[] = [];
  
  // 提取引号内的内容
  const quoted = text.match(/[「『""]([^」』""]+)[」』""]/g);
  if (quoted) {
    entities.push(...quoted.map(q => q.slice(1, -1)));
  }
  
  // 提取书名号内的内容
  const bookTitles = text.match(/《([^》]+)》/g);
  if (bookTitles) {
    entities.push(...bookTitles.map(t => t.slice(1, -1)));
  }
  
  return entities;
}

/**
 * 使用 LLM 改写查询（高质量但较慢）
 */
export async function rewriteWithLLM(
  query: string,
  context: {
    memories?: string;
    previousQuery?: string;
  }
): Promise<RewriteResult> {
  const llm = Settings.llm;
  if (!llm) {
    return {
      originalQuery: query,
      rewrittenQuery: query,
      strategy: 'none',
    };
  }
  
  const prompt = `你是一个查询优化助手。请根据上下文改写用户查询，使其更适合知识库检索。

${context.memories ? `用户记忆：\n${context.memories}\n` : ''}
${context.previousQuery ? `上一个问题：${context.previousQuery}\n` : ''}

当前查询：${query}

请输出：
1. 改写后的查询（更完整、更明确）
2. 3-5个关键词（用于关键词检索）

格式：
改写：<改写后的查询>
关键词：<关键词1>, <关键词2>, ...`;

  try {
    const response = await llm.complete({ prompt });
    const text = response.text;
    
    // 解析响应
    const rewrittenMatch = text.match(/改写[：:]\s*(.+)/);
    const keywordsMatch = text.match(/关键词[：:]\s*(.+)/);
    
    const rewrittenQuery = rewrittenMatch?.[1]?.trim() || query;
    const keywords = keywordsMatch?.[1]?.split(/[,，]/).map(k => k.trim()) || [];
    
    return {
      originalQuery: query,
      rewrittenQuery,
      strategy: 'refine',
      keywords,
    };
  } catch (error) {
    console.error('[QueryRewriter] LLM rewrite failed:', error);
    return {
      originalQuery: query,
      rewrittenQuery: query,
      strategy: 'none',
    };
  }
}

/**
 * 分解复杂查询为多个子查询
 */
export function decomposeQuery(query: string): string[] {
  // 检测并列关系
  const conjunctions = ['和', '以及', '还有', '并且', '同时'];
  
  for (const conj of conjunctions) {
    if (query.includes(conj)) {
      const parts = query.split(conj);
      if (parts.length >= 2) {
        // 提取主题
        const theme = extractTheme(query);
        return parts.map(p => {
          const trimmed = p.trim();
          // 如果子查询太短，补充主题
          if (trimmed.length < 5 && theme) {
            return `${theme}${trimmed}`;
          }
          return trimmed;
        }).filter(p => p.length > 2);
      }
    }
  }
  
  return [query];
}

/**
 * 提取查询主题
 */
function extractTheme(query: string): string {
  // 简单实现：提取问号前的主要成分
  const parts = query.split(/[的地得]/);
  if (parts.length > 1) {
    return parts[0];
  }
  return '';
}

/**
 * 综合改写（选择最佳策略）
 */
export async function rewriteQuery(
  query: string,
  options: {
    useLLM?: boolean;
    context?: {
      memories?: string | Array<{ content: string }>;
      previousQuery?: string;
      previousAnswer?: string;
    };
  } = {}
): Promise<RewriteResult> {
  const { useLLM = false, context = {} } = options;
  
  // 转换 memories 格式
  const contextForRewrite = {
    ...context,
    memories: typeof context.memories === 'string' 
      ? undefined  // 字符串格式用于 LLM 改写，不用于规则改写
      : context.memories,
  };
  
  // 1. 先尝试上下文改写（处理指代词）
  let rewritten = rewriteWithContext(query, contextForRewrite);
  
  // 2. 检测是否需要分解
  const subQueries = decomposeQuery(rewritten);
  if (subQueries.length > 1) {
    return {
      originalQuery: query,
      rewrittenQuery: rewritten,
      strategy: 'decompose',
      subQueries,
    };
  }
  
  // 3. 如果启用 LLM，使用 LLM 改写
  if (useLLM) {
    // 转换 memories 为字符串格式
    const llmContext = {
      memories: Array.isArray(context.memories)
        ? context.memories.map(m => m.content).join('\n')
        : context.memories,
      previousQuery: context.previousQuery,
    };
    return rewriteWithLLM(rewritten, llmContext);
  }
  
  // 4. 简单扩展
  const expanded = expandQuerySimple(rewritten);
  
  return {
    originalQuery: query,
    rewrittenQuery: rewritten,
    strategy: expanded.length > 1 ? 'expand' : 'none',
    keywords: expanded.slice(0, 5),
  };
}

