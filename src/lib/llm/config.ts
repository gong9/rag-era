/**
 * LLM 配置模块
 * 负责 LLM 和 Embedding 模型的初始化配置
 */
import { Settings, SentenceSplitter } from 'llamaindex';
import { OpenAIEmbedding, OpenAI } from '@llamaindex/openai';

let isConfigured = false;

/**
 * LLM 配置参数
 */
export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  llmModel: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * 获取默认配置（从环境变量）
 */
export function getDefaultConfig(): LLMConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    llmModel: process.env.OPENAI_MODEL || 'qwen-turbo',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-v4',
    chunkSize: parseInt(process.env.CHUNK_SIZE || '512', 10),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '50', 10),
  };
}

/**
 * 配置 LLM 和 Embedding（幂等操作）
 */
export function configureLLM(config?: Partial<LLMConfig>): void {
  if (isConfigured) {
    return;
  }

  const finalConfig = { ...getDefaultConfig(), ...config };
  
  console.log('[LLM Config] Base URL:', finalConfig.baseURL);
  console.log('[LLM Config] LLM Model:', finalConfig.llmModel);
  console.log('[LLM Config] Embedding Model:', finalConfig.embeddingModel);
  console.log('[LLM Config] API Key:', finalConfig.apiKey ? `${finalConfig.apiKey.substring(0, 10)}...` : 'NOT SET');

  if (!finalConfig.apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  // 配置 LLM
  Settings.llm = new OpenAI({
    apiKey: finalConfig.apiKey,
    model: finalConfig.llmModel,
    baseURL: finalConfig.baseURL,
  });

  // 配置 Embedding 模型
  Settings.embedModel = new OpenAIEmbedding({
    apiKey: finalConfig.apiKey,
    model: finalConfig.embeddingModel,
    baseURL: finalConfig.baseURL,
  });

  // 配置文档切分器
  Settings.nodeParser = new SentenceSplitter({
    chunkSize: finalConfig.chunkSize,
    chunkOverlap: finalConfig.chunkOverlap,
  });
  console.log(`[LLM Config] Node Parser: SentenceSplitter(chunkSize=${finalConfig.chunkSize}, chunkOverlap=${finalConfig.chunkOverlap})`);

  isConfigured = true;
  console.log('[LLM Config] ✅ Configuration completed');
}

/**
 * 重置配置状态（用于测试）
 */
export function resetConfig(): void {
  isConfigured = false;
}

/**
 * 检查是否已配置
 */
export function isLLMConfigured(): boolean {
  return isConfigured;
}

