/**
 * 语义压缩模块
 * 在保留关键信息的前提下压缩上下文
 */

import { Settings } from 'llamaindex';

/**
 * 压缩配置
 */
interface CompressionConfig {
  targetRatio: number;        // 目标压缩比（0.3 = 压缩到原来的 30%）
  minLength: number;          // 最小保留长度
  preserveKeywords: boolean;  // 是否保留关键词
}

const DEFAULT_CONFIG: CompressionConfig = {
  targetRatio: 0.4,
  minLength: 50,
  preserveKeywords: true,
};

/**
 * 使用 LLM 进行语义压缩
 */
export async function compressWithLLM(
  text: string,
  config: Partial<CompressionConfig> = {}
): Promise<string> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // 文本太短不压缩
  if (text.length < 100) {
    return text;
  }
  
  const targetLength = Math.max(
    cfg.minLength,
    Math.floor(text.length * cfg.targetRatio)
  );
  
  const prompt = `请将以下文本压缩为约 ${targetLength} 字，保留关键信息：

原文：
${text}

压缩要求：
1. 保留核心观点和关键数据
2. 删除冗余表述和修饰词
3. 保持语义完整性
4. 输出长度约 ${targetLength} 字

压缩后：`;

  try {
    const llm = Settings.llm;
    if (!llm) {
      return compressSimple(text, targetLength);
    }
    
    const response = await llm.complete({ prompt });
    return response.text.trim();
  } catch (error) {
    console.error('[Compressor] LLM compression failed:', error);
    return compressSimple(text, targetLength);
  }
}

/**
 * 简单的规则压缩（不使用 LLM）
 */
export function compressSimple(text: string, targetLength: number): string {
  if (text.length <= targetLength) {
    return text;
  }
  
  // 1. 移除多余空白
  let compressed = text.replace(/\s+/g, ' ').trim();
  
  // 2. 移除括号内容（通常是补充说明）
  compressed = compressed.replace(/（[^）]+）/g, '');
  compressed = compressed.replace(/\([^)]+\)/g, '');
  
  // 3. 移除引用标记
  compressed = compressed.replace(/\[\d+\]/g, '');
  
  // 4. 按句子分割，保留重要句子
  const sentences = compressed.split(/[。！？]/);
  const importantSentences: string[] = [];
  let currentLength = 0;
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    
    // 优先保留包含关键词的句子
    const isImportant = 
      trimmed.includes('重要') ||
      trimmed.includes('关键') ||
      trimmed.includes('必须') ||
      trimmed.includes('注意') ||
      /\d+/.test(trimmed);  // 包含数字
    
    if (isImportant || currentLength < targetLength * 0.7) {
      importantSentences.push(trimmed + '。');
      currentLength += trimmed.length + 1;
    }
    
    if (currentLength >= targetLength) {
      break;
    }
  }
  
  return importantSentences.join('');
}

/**
 * 提取式摘要（保留原文关键句）
 */
export function extractiveSummary(
  text: string,
  maxSentences: number = 3
): string {
  const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 10);
  
  if (sentences.length <= maxSentences) {
    return text;
  }
  
  // 评分每个句子
  const scored = sentences.map((sentence, index) => {
    let score = 0;
    
    // 位置权重（开头和结尾更重要）
    if (index === 0) score += 2;
    if (index === sentences.length - 1) score += 1;
    
    // 长度权重（太短或太长扣分）
    const len = sentence.length;
    if (len >= 20 && len <= 100) score += 1;
    
    // 关键词权重
    const keywords = ['重要', '关键', '必须', '首先', '其次', '最后', '总之', '因此'];
    for (const kw of keywords) {
      if (sentence.includes(kw)) score += 1;
    }
    
    // 数字权重
    if (/\d+/.test(sentence)) score += 0.5;
    
    return { sentence, score, index };
  });
  
  // 选择得分最高的句子，保持原顺序
  const selected = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map(s => s.sentence);
  
  return selected.join('。') + '。';
}

/**
 * 批量压缩多个文本块
 */
export async function compressBatch(
  chunks: Array<{ content: string; priority: number }>,
  totalBudget: number
): Promise<string[]> {
  // 按优先级排序
  const sorted = [...chunks].sort((a, b) => b.priority - a.priority);
  
  // 分配预算
  const totalLength = sorted.reduce((sum, c) => sum + c.content.length, 0);
  
  const results: string[] = [];
  let usedBudget = 0;
  
  for (const chunk of sorted) {
    // 计算该块的预算份额
    const share = chunk.priority / sorted.reduce((sum, c) => sum + c.priority, 0);
    const chunkBudget = Math.floor(totalBudget * share);
    
    // 压缩
    const compressed = chunk.content.length > chunkBudget
      ? compressSimple(chunk.content, chunkBudget)
      : chunk.content;
    
    results.push(compressed);
    usedBudget += compressed.length;
    
    // 预算用尽
    if (usedBudget >= totalBudget) {
      break;
    }
  }
  
  return results;
}

