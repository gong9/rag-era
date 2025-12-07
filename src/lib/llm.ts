import { VectorStoreIndex, storageContextFromDefaults, Settings, SentenceSplitter, ReActAgent, QueryEngineTool, FunctionTool } from 'llamaindex';
import { SimpleDirectoryReader } from '@llamaindex/readers/directory';
import { OpenAIEmbedding, OpenAI } from '@llamaindex/openai';
import * as fs from 'fs-extra';
import * as path from 'path';

const indexCache = new Map<string, VectorStoreIndex>();
let isConfigured = false;

/**
 * 工具名称到友好描述的映射
 */
const toolNameMap: Record<string, string> = {
  'search_knowledge': '🔍 在知识库中搜索',
  'deep_search': '📚 深度搜索知识库',
  'summarize_topic': '📋 总结主题内容',
  'decompose_question': '🔀 拆解复杂问题',
  'verify_answer': '✅ 验证答案质量',
};

/**
 * 解析 ReAct Agent 的输出，提取思考过程和最终答案
 * 注意：保留答案中的换行符以保持格式
 */
function parseAgentOutput(rawOutput: string): { thinking: string[]; answer: string } {
  if (!rawOutput) return { thinking: [], answer: '' };
  
  const thinkingSteps: string[] = [];
  let finalAnswer = '';
  
  // 用于提取 thinking 的内容（可以压缩空白）
  const compressedContent = rawOutput.replace(/\s+/g, ' ').trim();
  
  // 提取所有 Thought
  const thoughtMatches = compressedContent.matchAll(/Thought:\s*([^A][^c][^t][^i][^o][^n][^\n]*?)(?=\s*(?:Action:|Answer:|Thought:|$))/gi);
  for (const match of thoughtMatches) {
    const thought = match[1].trim();
    if (thought && thought.length > 5 && !thought.startsWith('{')) {
      // 过滤掉技术性的思考
      if (!thought.includes('Action Input') && !thought.includes('Observation')) {
        thinkingSteps.push(`💭 ${thought}`);
      }
    }
  }
  
  // 提取 Action（转换成友好描述）
  const actionMatches = compressedContent.matchAll(/Action:\s*(\w+)/gi);
  for (const match of actionMatches) {
    const toolName = match[1];
    const friendlyName = toolNameMap[toolName] || `使用工具: ${toolName}`;
    // 避免重复
    if (!thinkingSteps.some(s => s.includes(friendlyName))) {
      thinkingSteps.push(friendlyName);
    }
  }
  
  // 提取最终答案 - 保留原始格式（换行符）
  const lastAnswerIndex = rawOutput.lastIndexOf('Answer:');
  if (lastAnswerIndex !== -1) {
    finalAnswer = rawOutput.substring(lastAnswerIndex + 7).trim();
    // 清理答案中可能残留的 ReAct 格式
    finalAnswer = finalAnswer.replace(/Thought:[\s\S]*/gi, '').trim();
    finalAnswer = finalAnswer.replace(/Action:[\s\S]*/gi, '').trim();
  }
  
  // 如果没找到 Answer，尝试其他方法
  if (!finalAnswer || finalAnswer.length < 10) {
    // 移除所有 ReAct 格式内容，但保留换行
    let cleaned = rawOutput;
    cleaned = cleaned.replace(/Action:\s*\w+\s*Action Input:\s*\{[^}]*\}\s*"*/g, '');
    cleaned = cleaned.replace(/Action:\s*\w+\s*/g, '');
    cleaned = cleaned.replace(/Observation:\s*\{[\s\S]*?\}\s*"*/g, '');
    cleaned = cleaned.replace(/Observation:\s*"[^"]*"\s*/g, '');
    cleaned = cleaned.replace(/Observation:\s*\[[^\]]*\]\s*/g, '');
    cleaned = cleaned.replace(/Thought:\s*[^A]*?(?=Action:|Answer:|$)/gi, '');
    cleaned = cleaned.replace(/Answer:\s*/g, '');
    cleaned = cleaned.replace(/^["'\s]+|["'\s]+$/g, '').trim(); // 只清理首尾
    
    if (cleaned.length > 10) {
      finalAnswer = cleaned;
    }
  }
  
  // 去重思考步骤
  const uniqueThinking = [...new Set(thinkingSteps)];
  
  return {
    thinking: uniqueThinking,
    answer: finalAnswer || rawOutput,
  };
}

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

  // 配置文档切分器 - 适合个人学习场景
  Settings.nodeParser = new SentenceSplitter({
    chunkSize: 512,      // 更小的切片，检索更精准
    chunkOverlap: 50,    // 适当重叠，避免边界信息丢失
  });
  console.log('[LLM Config] Node Parser: SentenceSplitter(chunkSize=512, chunkOverlap=50)');

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
   * 查询知识库（普通 RAG 模式）
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
   * 查询知识库（Agentic RAG 模式 - ReAct Agent）
   * Agent 会自主决定：是否需要检索、如何检索、是否需要多轮迭代
   * 
   * 可用工具：
   * 1. search_knowledge - 精准检索（Top-3）
   * 2. deep_search - 深度检索（Top-8），用于全面分析
   * 3. summarize_topic - 总结某个主题的所有相关内容
   */
  static async agenticQuery(knowledgeBaseId: string, question: string): Promise<any> {
    configureLLM(); // 确保配置已加载
    console.log(`[LLM] Agentic Query: "${question}" in KB ${knowledgeBaseId}`);
    const startTime = Date.now();

    console.log(`[LLM] Loading index for agent...`);
    const index = await this.loadIndex(knowledgeBaseId);

    // ========== 工具 1: 精准检索 ==========
    console.log(`[LLM] Creating tools for agent...`);
    const searchTool = new QueryEngineTool({
      queryEngine: index.asQueryEngine({ similarityTopK: 3 }),
      metadata: {
        name: 'search_knowledge',
        description: '在知识库中搜索具体信息。适用于查找特定概念、定义或事实。返回最相关的 3 个文档片段。',
      },
    });

    // ========== 工具 2: 深度检索 ==========
    const deepSearchTool = new QueryEngineTool({
      queryEngine: index.asQueryEngine({ similarityTopK: 8 }),
      metadata: {
        name: 'deep_search',
        description: '深度搜索知识库，获取更全面的信息。适用于需要全面了解某个主题、对比分析或总结时使用。返回最相关的 8 个文档片段。',
      },
    });

    // ========== 工具 3: 总结工具 ==========
    // 使用 FunctionTool 包装一个总结功能
    const summarizeTool = FunctionTool.from(
      async ({ topic }: { topic: string }): Promise<string> => {
        console.log(`[LLM] 📋 Summarize tool called with topic: "${topic}"`);
        
        // 先深度检索相关内容
        const queryEngine = index.asQueryEngine({ similarityTopK: 10 });
        const result = await queryEngine.query({
          query: `总结关于 "${topic}" 的所有内容，包括定义、特点、应用场景等。`,
        });
        
        console.log(`[LLM] 📋 Summarize result length: ${result.response?.length || 0} chars`);
        return result.response || '未找到相关内容';
      },
      {
        name: 'summarize_topic',
        description: '总结知识库中关于某个主题的所有内容。输入一个主题关键词，返回该主题的全面总结。适用于"总结一下..."、"介绍一下..."等问题。',
        parameters: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: '要总结的主题或关键词',
            },
          },
          required: ['topic'],
        },
      }
    );

    // ========== System Prompt ==========
    const systemPrompt = `你是一个智能知识库助手，擅长深度分析和准确回答问题。

你有以下工具可以使用：
1. search_knowledge - 精准检索，返回 3 个最相关的文档片段
2. deep_search - 深度检索，返回 8 个相关文档片段，适合需要全面了解的问题
3. summarize_topic - 主题总结，输入关键词，返回该主题的全面总结

工作策略：
- 简单问题（如"什么是X"）：使用 search_knowledge
- 复杂问题（如"对比A和B"）：先用 search_knowledge 查 A，再查 B，然后综合回答
- 总结类问题（如"总结X的内容"）：使用 summarize_topic
- 需要全面信息时：使用 deep_search

回答要求：
- 用中文回答
- 答案要准确、完整、有条理
- 如果知识库中没有相关信息，请明确说明`;

    // 创建 ReAct Agent，配备工具
    console.log(`[LLM] Creating ReAct Agent with 3 tools...`);
    console.log(`[LLM]   - search_knowledge: 精准检索 (Top-3)`);
    console.log(`[LLM]   - deep_search: 深度检索 (Top-8)`);
    console.log(`[LLM]   - summarize_topic: 主题总结 (Top-10)`);
    
    const agent = new ReActAgent({
      tools: [searchTool, deepSearchTool, summarizeTool],
      verbose: true, // 日志显示思考过程
    });

    // Agent 执行查询
    console.log(`[LLM] Agent thinking and executing...`);
    console.log(`[LLM] ════════════════════════════════════════════════════════`);
    const response = await agent.chat({ message: question });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[LLM] ════════════════════════════════════════════════════════`);
    console.log(`[LLM] ✅ Agentic Query completed in ${totalTime}s`);
    
    // 打印完整的 Agent 推理过程
    console.log(`[LLM] ────────────────────────────────────────────────────────`);
    console.log(`[LLM] 📝 Agent Raw Output:`);
    console.log(`[LLM] ${response.response}`);
    console.log(`[LLM] ────────────────────────────────────────────────────────`);
    
    // 如果有 sources，打印检索到的文档片段
    if (response.sourceNodes && response.sourceNodes.length > 0) {
      console.log(`[LLM] 📚 Retrieved ${response.sourceNodes.length} source(s):`);
      response.sourceNodes.forEach((node: any, i: number) => {
        const text = node.node?.text || node.node?.getContent?.() || '';
        const preview = text.substring(0, 100).replace(/\n/g, ' ');
        console.log(`[LLM]   [${i + 1}] Score: ${node.score?.toFixed(3) || 'N/A'} | ${preview}...`);
      });
    }

    // 解析 Agent 输出，提取思考过程和最终答案
    const { thinking, answer } = parseAgentOutput(response.response || '');
    
    console.log(`[LLM] Thinking steps: ${thinking.length}`);
    thinking.forEach((step, i) => console.log(`[LLM]   ${i + 1}. ${step}`));
    console.log(`[LLM] Final answer length: ${answer.length} chars`);

    return {
      answer: answer,
      thinking: thinking, // 思考过程，供前端展示
      sourceNodes: response.sourceNodes?.map((node: any) => ({
        text: node.node?.text || node.node?.getContent?.() || '',
        score: node.score,
        metadata: node.node?.metadata,
      })) || [],
      isAgentic: true,
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
