/**
 * 混合搜索模块
 * 结合向量搜索和关键词搜索，使用 RRF 算法融合结果
 * 
 * 支持两种预设场景：
 * - document: 文本知识库（语义理解为主）
 * - code: 代码知识库（精确匹配为主）
 */

import { VectorStoreIndex } from 'llamaindex';
import { meilisearchService, SearchResult as MeiliResult } from './meilisearch';

// ========================
// 类型定义
// ========================

// 统一的搜索结果结构
export interface HybridSearchResult {
  id: string;
  documentId?: string;
  documentName: string;
  content: string;
  score: number;
  source: 'vector' | 'keyword' | 'both';
  contentType: 'document' | 'memory' | 'code';
  metadata?: Record<string, any>;
}

// 向量搜索结果
interface VectorResult {
  id: string;
  documentName: string;
  content: string;
  score: number;
  contentType: 'document' | 'memory' | 'code';
  metadata?: Record<string, any>;
}

// RRF 配置
export interface RRFConfig {
  k: number;                    // RRF 常数，越小头部权重越高
  vectorWeight: number;         // 向量检索权重倍数
  keywordWeight: number;        // 关键词检索权重倍数
  bothBonus: number;            // 同时命中的额外加成
}

// 搜索预设
export type SearchPreset = 'document' | 'code';

// 搜索选项
export interface HybridSearchOptions {
  vectorTopK?: number;
  keywordLimit?: number;
  useKeyword?: boolean;
  minVectorScore?: number;
  preset?: SearchPreset;        // 使用预设配置
  rrfConfig?: Partial<RRFConfig>; // 自定义 RRF 配置（覆盖预设）
}

// ========================
// 预设配置
// ========================

/**
 * 预设配置表
 * 
 * 文本知识库 (document):
 * - 语义理解为主，向量检索权重高
 * - k=60 标准值，平滑融合
 * - 关键词作为补充
 * 
 * 代码知识库 (code):
 * - 精确匹配极其重要，关键词权重高
 * - k=40 更锐利，头部结果权重更高
 * - 同时命中（函数名+语义）额外加分
 */
const PRESET_CONFIGS: Record<SearchPreset, {
  rrf: RRFConfig;
  vectorTopK: number;
  keywordLimit: number;
  minVectorScore: number;
}> = {
  document: {
    rrf: {
      k: 60,              // 标准 RRF 常数
      vectorWeight: 1.0,  // 向量检索基准权重
      keywordWeight: 1.0, // 关键词检索基准权重
      bothBonus: 0.1,     // 同时命中加成 10%
    },
    vectorTopK: 8,
    keywordLimit: 8,
    minVectorScore: 0.3,
  },
  code: {
    rrf: {
      k: 40,              // 更锐利，头部权重更高
      vectorWeight: 1.0,  // 向量检索基准权重
      keywordWeight: 1.3, // 关键词权重提升 30%（代码精确匹配更重要）
      bothBonus: 0.15,    // 同时命中加成 15%（函数名+语义双重匹配很有价值）
    },
    vectorTopK: 6,
    keywordLimit: 5,
    minVectorScore: 0.25, // 代码语义相似度天然较低
  },
};

/**
 * 获取预设配置
 */
export function getPresetConfig(preset: SearchPreset) {
  return PRESET_CONFIGS[preset];
}

// ========================
// RRF 算法
// ========================

/**
 * RRF (Reciprocal Rank Fusion) 算法
 * 将多个排序列表融合为一个统一排序
 * 
 * 公式: score = Σ (weight / (k + rank + 1))
 * 
 * @param vectorResults 向量搜索结果
 * @param keywordResults 关键词搜索结果
 * @param config RRF 配置
 * @returns 融合后的结果
 */
export function reciprocalRankFusion(
  vectorResults: VectorResult[],
  keywordResults: MeiliResult[],
  config: RRFConfig = PRESET_CONFIGS.document.rrf
): HybridSearchResult[] {
  const { k, vectorWeight, keywordWeight, bothBonus } = config;
  
  const scoreMap = new Map<string, {
    score: number;
    content: string;
    documentName: string;
    documentId?: string;
    source: 'vector' | 'keyword' | 'both';
    contentType: 'document' | 'memory' | 'code';
    metadata?: Record<string, any>;
  }>();

  // 处理向量搜索结果
  vectorResults.forEach((result, rank) => {
    const rrfScore = vectorWeight / (k + rank + 1);
    const key = result.content.substring(0, 100); // 用内容前100字符作为去重key
    
    const existing = scoreMap.get(key);
    if (existing) {
      // 已存在于关键词结果中，变成 both
      existing.score += rrfScore;
      existing.source = 'both';
    } else {
      scoreMap.set(key, {
        score: rrfScore,
        content: result.content,
        documentName: result.documentName,
        source: 'vector',
        contentType: result.contentType,
        metadata: result.metadata,
      });
    }
  });

  // 处理关键词搜索结果
  keywordResults.forEach((result, rank) => {
    const rrfScore = keywordWeight / (k + rank + 1);
    const key = result.content.substring(0, 100);
    
    const existing = scoreMap.get(key);
    if (existing) {
      // 已存在于向量结果中，变成 both，并应用加成
      existing.score += rrfScore + (bothBonus * existing.score);
      existing.source = 'both';
    } else {
      scoreMap.set(key, {
        score: rrfScore,
        content: result.content,
        documentName: result.documentName,
        documentId: result.documentId,
        source: 'keyword',
        contentType: 'document',
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
      contentType: data.contentType,
      metadata: data.metadata,
    }))
    .sort((a, b) => b.score - a.score);

  // 日志：RRF 配置信息
  console.log(`[RRF] Config: k=${k}, vectorWeight=${vectorWeight}, keywordWeight=${keywordWeight}, bothBonus=${bothBonus}`);

  return results;
}

// ========================
// 向量搜索
// ========================

/**
 * 执行向量搜索
 */
async function vectorSearch(
  index: VectorStoreIndex,
  query: string,
  topK: number,
  isCodebase: boolean = false
): Promise<VectorResult[]> {
  const retriever = index.asRetriever({ similarityTopK: topK });
  const nodes = await retriever.retrieve(query);

  return nodes.map((node) => {
    const metadata = node.node.metadata || {};
    // 根据 metadata.type 区分类型
    const isMemory = metadata.type === 'memory';
    const isCode = isCodebase || metadata.language !== undefined;
    
    let contentType: 'document' | 'memory' | 'code' = 'document';
    if (isMemory) contentType = 'memory';
    else if (isCode) contentType = 'code';
    
    return {
      id: node.node.id_,
      documentName: isMemory 
        ? '用户记忆' 
        : (metadata.documentName || metadata.relativePath || metadata.filePath || '未知文档'),
      content: (node.node as any).text || '',
      score: node.score || 0,
      contentType,
      metadata,
    };
  });
}

// ========================
// 混合搜索主函数
// ========================

/**
 * 混合搜索主函数
 * 
 * @param index 向量索引
 * @param knowledgeBaseId 知识库 ID
 * @param query 搜索查询
 * @param options 搜索选项
 * @returns 融合后的搜索结果
 * 
 * @example
 * // 文本知识库（默认）
 * const results = await hybridSearch(index, kbId, query);
 * 
 * // 代码知识库
 * const results = await hybridSearch(index, kbId, query, { preset: 'code' });
 * 
 * // 自定义配置
 * const results = await hybridSearch(index, kbId, query, {
 *   preset: 'code',
 *   rrfConfig: { keywordWeight: 1.5 }  // 覆盖预设
 * });
 */
export async function hybridSearch(
  index: VectorStoreIndex,
  knowledgeBaseId: string,
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult[]> {
  // 获取预设配置
  const preset = options.preset || 'document';
  const presetConfig = PRESET_CONFIGS[preset];
  
  // 合并选项（options > preset）
  const vectorTopK = options.vectorTopK ?? presetConfig.vectorTopK;
  const keywordLimit = options.keywordLimit ?? presetConfig.keywordLimit;
  const useKeyword = options.useKeyword ?? true;
  const minVectorScore = options.minVectorScore ?? presetConfig.minVectorScore;
  
  // 合并 RRF 配置
  const rrfConfig: RRFConfig = {
    ...presetConfig.rrf,
    ...options.rrfConfig,
  };

  const isCodebase = preset === 'code' || knowledgeBaseId.startsWith('codebase_');

  console.log(`[HybridSearch] Preset: ${preset}, Query: "${query.substring(0, 50)}..."`);
  console.log(`[HybridSearch] vectorTopK=${vectorTopK}, keywordLimit=${keywordLimit}, minScore=${minVectorScore}`);

  // 1. 执行向量搜索
  let vectorResults = await vectorSearch(index, query, vectorTopK, isCodebase);
  console.log(`[HybridSearch] Vector search found ${vectorResults.length} results`);
  
  // 2. 用原始余弦相似度过滤低相关性结果（在 RRF 之前！）
  const beforeFilter = vectorResults.length;
  vectorResults = vectorResults.filter(r => {
    if (r.score < minVectorScore) {
      console.log(`[HybridSearch] Filtered low score (${r.score.toFixed(3)} < ${minVectorScore}): ${r.content.substring(0, 40)}...`);
      return false;
    }
    return true;
  });
  if (vectorResults.length < beforeFilter) {
    console.log(`[HybridSearch] Filtered out ${beforeFilter - vectorResults.length} low relevance results`);
  }

  // 3. 检查 Meilisearch 是否可用
  let keywordResults: MeiliResult[] = [];
  if (useKeyword) {
    const meiliAvailable = await meilisearchService.isAvailable();
    
    if (meiliAvailable) {
      keywordResults = await meilisearchService.search(knowledgeBaseId, query, keywordLimit);
      console.log(`[HybridSearch] Keyword search found ${keywordResults.length} results`);
    } else {
      console.log(`[HybridSearch] Meilisearch not available, using vector only`);
    }
  }

  // 4. RRF 融合
  if (keywordResults.length > 0) {
    const fusedResults = reciprocalRankFusion(vectorResults, keywordResults, rrfConfig);
    console.log(`[HybridSearch] RRF fusion: ${fusedResults.length} unique results`);
    
    // 统计来源分布
    const sources = { vector: 0, keyword: 0, both: 0 };
    fusedResults.forEach(r => sources[r.source]++);
    console.log(`[HybridSearch] Sources: vector=${sources.vector}, keyword=${sources.keyword}, both=${sources.both}`);
    
    return fusedResults;
  }

  // Meilisearch 不可用时，只返回向量结果
  return vectorResults.map(r => ({
    id: r.id,
    documentName: r.documentName,
    content: r.content,
    score: r.score,
    source: 'vector' as const,
    contentType: r.contentType,
    metadata: r.metadata,
  }));
}

// ========================
// 工具函数
// ========================

/**
 * 格式化搜索结果为文本
 */
export function formatSearchResults(results: HybridSearchResult[], maxResults: number = 5): string {
  return results
    .slice(0, maxResults)
    .map((r, i) => {
      const sourceTag = r.source === 'both' ? '🎯' : r.source === 'vector' ? '📊' : '🔤';
      const typeTag = r.contentType === 'code' ? '💻' : r.contentType === 'memory' ? '🧠' : '📄';
      return `[来源${i + 1}: ${r.documentName}] ${sourceTag}${typeTag}\n${r.content}`;
    })
    .join('\n\n');
}

/**
 * 获取结果来源统计
 */
export function getSourceStats(results: HybridSearchResult[]): {
  total: number;
  vector: number;
  keyword: number;
  both: number;
  byType: Record<string, number>;
} {
  const stats = {
    total: results.length,
    vector: 0,
    keyword: 0,
    both: 0,
    byType: {} as Record<string, number>,
  };

  for (const r of results) {
    stats[r.source]++;
    stats.byType[r.contentType] = (stats.byType[r.contentType] || 0) + 1;
  }

  return stats;
}
