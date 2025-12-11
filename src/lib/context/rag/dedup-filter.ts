/**
 * 去重过滤模块
 * 对检索结果进行去重、过滤、重排
 */

import type { SearchResult, FusedResult } from '../types';

/**
 * 去重配置
 */
interface DedupConfig {
  similarityThreshold: number;  // 相似度阈值（超过则视为重复）
  minContentLength: number;     // 最小内容长度
  maxResults: number;           // 最大结果数
}

const DEFAULT_CONFIG: DedupConfig = {
  similarityThreshold: 0.85,
  minContentLength: 20,
  maxResults: 10,
};

/**
 * 计算两个文本的相似度（Jaccard 相似度）
 */
function calculateSimilarity(text1: string, text2: string): number {
  // 分词（简单按字符）
  const set1 = new Set(text1.split(''));
  const set2 = new Set(text2.split(''));
  
  // 交集
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  // 并集
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * 语义去重
 */
export function deduplicateResults(
  results: SearchResult[],
  config: Partial<DedupConfig> = {}
): FusedResult[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const deduplicated: FusedResult[] = [];
  
  for (const result of results) {
    // 过滤太短的内容
    if (result.content.length < cfg.minContentLength) {
      continue;
    }
    
    // 检查是否与已有结果重复
    let isDuplicate = false;
    let mergeTarget: FusedResult | null = null;
    
    for (const existing of deduplicated) {
      const similarity = calculateSimilarity(
        result.content.substring(0, 200),
        existing.content.substring(0, 200)
      );
      
      if (similarity >= cfg.similarityThreshold) {
        isDuplicate = true;
        // 如果新结果分数更高，替换
        if (result.score > existing.fusionScore) {
          mergeTarget = existing;
        }
        break;
      }
    }
    
    if (!isDuplicate) {
      deduplicated.push({
        ...result,
        fusionScore: result.score,
        sources: [result.source],
        deduplicated: false,
      });
    } else if (mergeTarget) {
      // 合并来源
      mergeTarget.sources.push(result.source);
      mergeTarget.fusionScore = Math.max(mergeTarget.fusionScore, result.score);
      mergeTarget.deduplicated = true;
    }
  }
  
  return deduplicated.slice(0, cfg.maxResults);
}

/**
 * 噪音过滤规则
 */
const NOISE_PATTERNS = [
  /^[\s\n]+$/,                    // 纯空白
  /^[.。,，;；:：!！?？]+$/,      // 纯标点
  /^\d+$/,                        // 纯数字
  /^第?\d+[章节页条款]$/,         // 章节编号
  /^(目录|索引|参考文献)$/,       // 目录类
];

/**
 * 过滤噪音内容
 */
export function filterNoise(results: SearchResult[]): SearchResult[] {
  return results.filter(result => {
    const content = result.content.trim();
    
    // 检查噪音模式
    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(content)) {
        return false;
      }
    }
    
    // 信息密度检查（标点符号比例）
    const punctuationCount = (content.match(/[，。！？、；：""''【】（）]/g) || []).length;
    const contentLength = content.length;
    if (contentLength > 0 && punctuationCount / contentLength > 0.3) {
      return false;
    }
    
    return true;
  });
}

/**
 * 相关性重排
 */
export function rerankByRelevance(
  results: FusedResult[],
  query: string
): FusedResult[] {
  // 提取查询关键词
  const queryKeywords = extractKeywords(query);
  
  // 计算关键词覆盖度
  const scored = results.map(result => {
    const contentKeywords = extractKeywords(result.content);
    const coverage = calculateKeywordCoverage(queryKeywords, contentKeywords);
    
    // 综合评分 = 原始分数 * 0.7 + 关键词覆盖度 * 0.3
    const adjustedScore = result.fusionScore * 0.7 + coverage * 0.3;
    
    return {
      ...result,
      fusionScore: adjustedScore,
    };
  });
  
  // 排序
  return scored.sort((a, b) => b.fusionScore - a.fusionScore);
}

/**
 * 提取关键词（简单实现）
 */
function extractKeywords(text: string): Set<string> {
  // 移除标点，分词
  const cleaned = text.replace(/[，。！？、；：""''【】（）\s]/g, ' ');
  const words = cleaned.split(' ').filter(w => w.length >= 2);
  return new Set(words);
}

/**
 * 计算关键词覆盖度
 */
function calculateKeywordCoverage(
  queryKeywords: Set<string>,
  contentKeywords: Set<string>
): number {
  if (queryKeywords.size === 0) return 0;
  
  let covered = 0;
  for (const keyword of queryKeywords) {
    // 精确匹配或包含
    for (const contentWord of contentKeywords) {
      if (contentWord.includes(keyword) || keyword.includes(contentWord)) {
        covered++;
        break;
      }
    }
  }
  
  return covered / queryKeywords.size;
}

/**
 * 综合处理：去重 + 过滤 + 重排
 */
export function processResults(
  results: SearchResult[],
  query: string,
  options: {
    dedupConfig?: Partial<DedupConfig>;
    enableNoiseFiltler?: boolean;
    enableRerank?: boolean;
    minRelevanceScore?: number;  // 🔥 最小相关性阈值
  } = {}
): FusedResult[] {
  const { 
    dedupConfig, 
    enableNoiseFiltler = true, 
    enableRerank = true,
    minRelevanceScore = 0.4,  // 默认阈值
  } = options;
  
  let processed: SearchResult[] = results;
  
  // 🔥 0. 相关性阈值过滤
  // 注意：RRF 分数范围约 0.01~0.03，不是 0~1！
  // 需要根据实际分数分布来过滤，这里用关键词匹配作为补充
  const queryKeywords = query.split(/[\s，。！？、]+/).filter(w => w.length >= 2);
  
  const beforeCount = processed.length;
  processed = processed.filter(r => {
    // 检查内容是否包含查询关键词
    const hasKeywordMatch = queryKeywords.some(kw => r.content.includes(kw));
    
    // 如果没有任何关键词匹配，认为不相关
    if (!hasKeywordMatch && queryKeywords.length > 0) {
      console.log(`[DedupFilter] Skipping no-keyword-match result: ${r.content.substring(0, 40)}...`);
      return false;
    }
    return true;
  });
  if (processed.length < beforeCount) {
    console.log(`[DedupFilter] Filtered out ${beforeCount - processed.length} irrelevant results (no keyword match)`);
  }
  
  // 1. 噪音过滤
  if (enableNoiseFiltler) {
    processed = filterNoise(processed);
  }
  
  // 2. 去重
  let fused = deduplicateResults(processed, dedupConfig);
  
  // 3. 重排
  if (enableRerank) {
    fused = rerankByRelevance(fused, query);
  }
  
  return fused;
}

