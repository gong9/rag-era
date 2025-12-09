/**
 * 混合搜索模块
 * 结合向量搜索和关键词搜索，使用 RRF 算法融合结果
 */

import { VectorStoreIndex } from 'llamaindex';
import { meilisearchService, SearchResult as MeiliResult } from './meilisearch';

// 统一的搜索结果结构
export interface HybridSearchResult {
  id: string;
  documentId?: string;
  documentName: string;
  content: string;
  score: number;
  source: 'vector' | 'keyword' | 'both';
}

// 向量搜索结果
interface VectorResult {
  id: string;
  documentName: string;
  content: string;
  score: number;
}

/**
 * RRF (Reciprocal Rank Fusion) 算法
 * 将多个排序列表融合为一个统一排序
 * 
 * @param vectorResults 向量搜索结果
 * @param keywordResults 关键词搜索结果
 * @param k RRF 常数，通常为 60
 * @returns 融合后的结果
 */
export function reciprocalRankFusion(
  vectorResults: VectorResult[],
  keywordResults: MeiliResult[],
  k: number = 60
): HybridSearchResult[] {
  const scoreMap = new Map<string, {
    score: number;
    content: string;
    documentName: string;
    documentId?: string;
    source: 'vector' | 'keyword' | 'both';
  }>();

  // 处理向量搜索结果
  vectorResults.forEach((result, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    const key = result.content.substring(0, 100); // 用内容前100字符作为去重key
    
    const existing = scoreMap.get(key);
    if (existing) {
      existing.score += rrfScore;
      existing.source = 'both';
    } else {
      scoreMap.set(key, {
        score: rrfScore,
        content: result.content,
        documentName: result.documentName,
        source: 'vector',
      });
    }
  });

  // 处理关键词搜索结果
  keywordResults.forEach((result, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    const key = result.content.substring(0, 100);
    
    const existing = scoreMap.get(key);
    if (existing) {
      existing.score += rrfScore;
      existing.source = 'both';
    } else {
      scoreMap.set(key, {
        score: rrfScore,
        content: result.content,
        documentName: result.documentName,
        documentId: result.documentId,
        source: 'keyword',
      });
    }
  });

  // 转换为数组并排序
  const results: HybridSearchResult[] = [...scoreMap.entries()]
    .map(([key, data]) => ({
      id: key,
      documentId: data.documentId,
      documentName: data.documentName,
      content: data.content,
      score: data.score,
      source: data.source,
    }))
    .sort((a, b) => b.score - a.score);

  return results;
}

/**
 * 执行向量搜索
 */
async function vectorSearch(
  index: VectorStoreIndex,
  query: string,
  topK: number
): Promise<VectorResult[]> {
  const retriever = index.asRetriever({ similarityTopK: topK });
  const nodes = await retriever.retrieve(query);

  return nodes.map((node) => ({
    id: node.node.id_,
    documentName: node.node.metadata?.documentName || '未知文档',
    content: (node.node as any).text || '',
    score: node.score || 0,
  }));
}

/**
 * 混合搜索主函数
 * 
 * @param index 向量索引
 * @param knowledgeBaseId 知识库 ID
 * @param query 搜索查询
 * @param options 搜索选项
 * @returns 融合后的搜索结果
 */
export async function hybridSearch(
  index: VectorStoreIndex,
  knowledgeBaseId: string,
  query: string,
  options: {
    vectorTopK?: number;
    keywordLimit?: number;
    useKeyword?: boolean;
  } = {}
): Promise<HybridSearchResult[]> {
  const {
    vectorTopK = 8,
    keywordLimit = 8,
    useKeyword = true,
  } = options;

  console.log(`[HybridSearch] Query: "${query}", vectorTopK: ${vectorTopK}, keywordLimit: ${keywordLimit}`);

  // 1. 执行向量搜索
  const vectorResults = await vectorSearch(index, query, vectorTopK);
  console.log(`[HybridSearch] Vector search found ${vectorResults.length} results`);

  // 2. 检查 Meilisearch 是否可用
  let keywordResults: MeiliResult[] = [];
  if (useKeyword) {
    const meiliAvailable = await meilisearchService.isAvailable();
    
    if (meiliAvailable) {
      // 3. 执行关键词搜索
      keywordResults = await meilisearchService.search(knowledgeBaseId, query, keywordLimit);
      console.log(`[HybridSearch] Keyword search found ${keywordResults.length} results`);
    } else {
      console.log(`[HybridSearch] Meilisearch not available, using vector only`);
    }
  }

  // 4. RRF 融合
  if (keywordResults.length > 0) {
    const fusedResults = reciprocalRankFusion(vectorResults, keywordResults);
    console.log(`[HybridSearch] RRF fusion: ${fusedResults.length} unique results`);
    
    // 统计来源分布
    const sources = { vector: 0, keyword: 0, both: 0 };
    fusedResults.forEach(r => sources[r.source]++);
    console.log(`[HybridSearch] Sources: vector=${sources.vector}, keyword=${sources.keyword}, both=${sources.both}`);
    
    return fusedResults;
  }

  // Meilisearch 不可用时，只返回向量结果
  return vectorResults.map(r => ({
    ...r,
    source: 'vector' as const,
  }));
}

/**
 * 格式化搜索结果为文本
 */
export function formatSearchResults(results: HybridSearchResult[], maxResults: number = 5): string {
  return results
    .slice(0, maxResults)
    .map((r, i) => {
      const sourceTag = r.source === 'both' ? '🎯' : r.source === 'vector' ? '📊' : '🔤';
      return `[来源${i + 1}: ${r.documentName}] ${sourceTag}\n${r.content}`;
    })
    .join('\n\n');
}

