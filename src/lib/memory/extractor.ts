/**
 * 记忆提取器模块
 * 使用 LLM 从对话中提取关键记忆
 */

import { Settings } from 'llamaindex';
import type { ExtractedMemory, MemoryType } from './types';

/**
 * 记忆提取 Prompt
 */
const EXTRACTION_PROMPT = `你是一个记忆提取助手。请从以下对话中提取值得记住的关键信息。

## 提取规则
1. 只提取有长期价值的信息，忽略临时性的问答
2. 每条记忆应该是简洁的陈述句
3. 记忆类型说明：
   - preference: 用户偏好（如"用户喜欢简洁的回答"）
   - fact: 重要事实（如"用户在北京工作"）
   - context: 背景信息（如"用户正在准备体检"）
   - instruction: 用户指令（如"回答时请使用中文"）

## 对话内容
用户: {question}
AI: {answer}

## 输出格式
请以 JSON 数组格式输出提取的记忆，如果没有值得记住的信息则输出空数组 []。
每条记忆包含：
- content: 记忆内容（简洁陈述句）
- type: 记忆类型（preference/fact/context/instruction）
- confidence: 置信度（0-1，表示这条信息的重要程度）

示例输出：
[
  {"content": "用户偏好简洁的回答", "type": "preference", "confidence": 0.9},
  {"content": "用户在准备下周的体检", "type": "context", "confidence": 0.8}
]

请只输出 JSON 数组，不要包含其他内容。`;

/**
 * 从对话中提取记忆
 * 
 * @param question 用户问题
 * @param answer AI 回答
 * @returns 提取的记忆列表
 */
export async function extractMemories(
  question: string,
  answer: string
): Promise<ExtractedMemory[]> {
  // 构建 prompt
  const prompt = EXTRACTION_PROMPT
    .replace('{question}', question)
    .replace('{answer}', answer);
  
  try {
    // 调用 LLM
    const llm = Settings.llm;
    if (!llm) {
      console.warn('[Memory] LLM not configured, skipping extraction');
      return [];
    }
    
    const response = await llm.complete({ prompt });
    const responseText = response.text.trim();
    
    // 解析 JSON
    const memories = parseMemoryResponse(responseText);
    
    console.log(`[Memory] Extracted ${memories.length} memories from conversation`);
    memories.forEach((m, i) => {
      console.log(`[Memory]   ${i + 1}. [${m.type}] ${m.content} (conf: ${m.confidence})`);
    });
    
    return memories;
  } catch (error) {
    console.error('[Memory] Failed to extract memories:', error);
    return [];
  }
}

/**
 * 解析 LLM 返回的记忆 JSON
 */
function parseMemoryResponse(responseText: string): ExtractedMemory[] {
  try {
    // 尝试提取 JSON 数组
    let jsonStr = responseText;
    
    // 如果被 markdown 代码块包裹，提取出来
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    // 解析 JSON
    const parsed = JSON.parse(jsonStr);
    
    // 验证并过滤
    if (!Array.isArray(parsed)) {
      console.warn('[Memory] Response is not an array');
      return [];
    }
    
    return parsed
      .filter(isValidMemory)
      .map(normalizeMemory);
  } catch (error) {
    console.warn('[Memory] Failed to parse memory response:', error);
    return [];
  }
}

/**
 * 验证记忆对象是否有效
 */
function isValidMemory(obj: any): boolean {
  return (
    obj &&
    typeof obj.content === 'string' &&
    obj.content.length > 0 &&
    typeof obj.type === 'string' &&
    ['preference', 'fact', 'context', 'instruction'].includes(obj.type)
  );
}

/**
 * 标准化记忆对象
 */
function normalizeMemory(obj: any): ExtractedMemory {
  return {
    content: obj.content.trim(),
    type: obj.type as MemoryType,
    confidence: typeof obj.confidence === 'number' 
      ? Math.max(0, Math.min(1, obj.confidence)) 
      : 0.8,
  };
}

/**
 * 判断对话是否值得提取记忆
 * 用于过滤简单的问答，避免不必要的 LLM 调用
 */
export function shouldExtractMemory(question: string, answer: string): boolean {
  // 问题太短，可能是简单问候
  if (question.length < 5) return false;
  
  // 答案太短，可能没有有价值的信息
  if (answer.length < 20) return false;
  
  // 包含明显的偏好表达
  const preferenceKeywords = ['喜欢', '偏好', '习惯', '希望', '请用', '不要'];
  if (preferenceKeywords.some(k => question.includes(k))) return true;
  
  // 包含个人信息
  const personalKeywords = ['我是', '我在', '我的', '我们'];
  if (personalKeywords.some(k => question.includes(k))) return true;
  
  // 较长的对话更可能包含有价值的信息
  if (question.length > 50 || answer.length > 200) return true;
  
  // 默认不提取，避免过度消耗
  return false;
}

/**
 * 批量提取记忆（用于历史对话迁移）
 */
export async function batchExtractMemories(
  conversations: Array<{ question: string; answer: string }>
): Promise<ExtractedMemory[]> {
  const allMemories: ExtractedMemory[] = [];
  
  for (const conv of conversations) {
    if (shouldExtractMemory(conv.question, conv.answer)) {
      const memories = await extractMemories(conv.question, conv.answer);
      allMemories.push(...memories);
    }
  }
  
  // 去重（基于内容相似度）
  return deduplicateMemories(allMemories);
}

/**
 * 去重记忆（简单的内容比较）
 */
function deduplicateMemories(memories: ExtractedMemory[]): ExtractedMemory[] {
  const seen = new Set<string>();
  const unique: ExtractedMemory[] = [];
  
  for (const memory of memories) {
    // 简化内容作为去重 key
    const key = memory.content.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(memory);
    }
  }
  
  return unique;
}

