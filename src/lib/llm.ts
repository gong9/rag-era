import { VectorStoreIndex, storageContextFromDefaults, Settings } from 'llamaindex';
import { SimpleDirectoryReader } from '@llamaindex/readers/directory';
import { OpenAIEmbedding, OpenAI } from '@llamaindex/openai';
import * as fs from 'fs-extra';
import * as path from 'path';

const indexCache = new Map<string, VectorStoreIndex>();
let isConfigured = false;

// 配置 LLM 和 Embedding
function configureLLM() {
  if (isConfigured) {
    return; // 已经配置过了
  }

  // 直接使用 .env 中的 OPENAI_* 变量
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const llmModel = process.env.OPENAI_MODEL || 'qwen-turbo';
  const embeddingModel = 'text-embedding-v4'; // 千问最新的 embedding 模型

  console.log('[LLM Config] Base URL:', baseURL);
  console.log('[LLM Config] LLM Model:', llmModel);
  console.log('[LLM Config] Embedding Model:', embeddingModel);
  console.log('[LLM Config] API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT SET');

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  // 配置 LLM - 使用千问的对话模型（与 embedding 保持一致的配置方式）
  Settings.llm = new OpenAI({
    apiKey: apiKey,
    model: llmModel,
    baseURL: baseURL,
  });

  // 配置 Embedding 模型 - 使用千问的 text-embedding-v4
  Settings.embedModel = new OpenAIEmbedding({
    apiKey: apiKey,
    model: embeddingModel,
    baseURL: baseURL,
  });

  isConfigured = true;
  console.log('[LLM Config] ✅ Configuration completed');
}

export class LLMService {
  /**
   * 获取存储目录
   */
  private static getStorageDir(knowledgeBaseId: string): string {
    const baseDir = process.env.STORAGE_DIR || './storage';
    return path.join(baseDir, `kb_${knowledgeBaseId}`);
  }

  /**
   * 创建或更新知识库索引
   */
  static async createOrUpdateIndex(
    knowledgeBaseId: string,
    documentsPath: string,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<void> {
    try {
      configureLLM(); // 确保配置已加载
      console.log(`[LLM] Starting index creation for KB ${knowledgeBaseId}`);
      onProgress?.(5, '初始化处理环境...');
      
      const storageDir = this.getStorageDir(knowledgeBaseId);
      await fs.ensureDir(storageDir);

      // 检查是否有文档
      const files = await fs.readdir(documentsPath);
      if (files.length === 0) {
        console.warn(`No documents found in ${documentsPath}`);
        return;
      }

      // 使用官方的 SimpleDirectoryReader 加载文档
      console.log(`[LLM] Loading documents from ${documentsPath}`);
      onProgress?.(20, '加载文档内容...');
      
      const reader = new SimpleDirectoryReader();
      const documents = await reader.loadData({ directoryPath: documentsPath });

      console.log(`[LLM] Loaded ${documents.length} documents for KB ${knowledgeBaseId}`);
      onProgress?.(40, `已加载 ${documents.length} 个文档`);

      // 创建存储上下文
      console.log(`[LLM] Creating storage context at ${storageDir}`);
      onProgress?.(50, '创建存储上下文...');
      
      const storageContext = await storageContextFromDefaults({
        persistDir: storageDir,
      });

      // 创建索引 - 这一步会调用 embedding API
      console.log(`[LLM] Creating vector index for ${documents.length} documents...`);
      console.log(`[LLM] This will call embedding API ${documents.length} times, please wait...`);
      onProgress?.(60, `正在生成向量索引（${documents.length} 个文档）...`);
      
      const startTime = Date.now();
      const index = await VectorStoreIndex.fromDocuments(documents, { storageContext });
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      onProgress?.(90, '保存索引文件...');

      // 缓存索引
      indexCache.set(knowledgeBaseId, index);

      console.log(`[LLM] ✅ Index created successfully for KB ${knowledgeBaseId}`);
      console.log(`[LLM] Total time: ${duration}s, Average: ${(parseFloat(duration) / documents.length).toFixed(2)}s per document`);
      onProgress?.(100, '索引创建完成！');
    } catch (error) {
      console.error(`[LLM] ❌ Failed to create index for KB ${knowledgeBaseId}:`, error);
      onProgress?.(0, '索引创建失败');
      throw error;
    }
  }

  /**
   * 加载已存在的索引
   */
  static async loadIndex(knowledgeBaseId: string): Promise<VectorStoreIndex> {
    configureLLM(); // 确保配置已加载
    
    // 检查缓存
    if (indexCache.has(knowledgeBaseId)) {
      return indexCache.get(knowledgeBaseId)!;
    }

    const storageDir = this.getStorageDir(knowledgeBaseId);

    // 检查存储目录是否存在
    if (!(await fs.pathExists(storageDir))) {
      throw new Error(`Index not found for knowledge base ${knowledgeBaseId}`);
    }

    // 从持久化存储加载索引
    const storageContext = await storageContextFromDefaults({
      persistDir: storageDir,
    });

    const index = await VectorStoreIndex.init({
      storageContext,
    });

    // 缓存索引
    indexCache.set(knowledgeBaseId, index);

    console.log(`Index loaded for KB ${knowledgeBaseId}`);
    return index;
  }

  /**
   * 查询知识库
   */
  static async query(knowledgeBaseId: string, question: string): Promise<any> {
    configureLLM(); // 确保配置已加载
    console.log(`[LLM] Query: "${question}" in KB ${knowledgeBaseId}`);
    const startTime = Date.now();
    
    console.log(`[LLM] Loading index...`);
    const t1 = Date.now();
    const index = await this.loadIndex(knowledgeBaseId);
    console.log(`[LLM] Index loaded in ${Date.now() - t1}ms`);
    
    console.log(`[LLM] Creating query engine with topK=2...`);
    const t2 = Date.now();
    const queryEngine = index.asQueryEngine({
      similarityTopK: 2, // 只检索最相关的 2 个文档片段
    });
    console.log(`[LLM] Query engine created in ${Date.now() - t2}ms`);

    console.log(`[LLM] Executing query...`);
    const t3 = Date.now();
    const response = await queryEngine.query({
      query: question,
    });
    console.log(`[LLM] Query executed in ${Date.now() - t3}ms`);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[LLM] ✅ Query completed in ${totalTime}s`);
    console.log(`[LLM] Response length: ${response.response?.length || 0} chars`);
    console.log(`[LLM] Source nodes: ${response.sourceNodes?.length || 0}`);

    return {
      answer: response.response,
      sourceNodes: response.sourceNodes?.map((node: any) => ({
        text: node.node.text || node.node.getContent?.() || '',
        score: node.score,
        metadata: node.node.metadata,
      })),
    };
  }

  /**
   * 删除知识库索引
   */
  static async deleteIndex(knowledgeBaseId: string): Promise<void> {
    const storageDir = this.getStorageDir(knowledgeBaseId);

    // 从缓存移除
    indexCache.delete(knowledgeBaseId);

    // 删除存储目录
    if (await fs.pathExists(storageDir)) {
      await fs.remove(storageDir);
      console.log(`Index deleted for KB ${knowledgeBaseId}`);
    }
  }

  /**
   * 检查索引是否存在
   */
  static async indexExists(knowledgeBaseId: string): Promise<boolean> {
    const storageDir = this.getStorageDir(knowledgeBaseId);
    return fs.pathExists(storageDir);
  }
}
