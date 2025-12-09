import { VectorStoreIndex, storageContextFromDefaults, Settings, SentenceSplitter, ReActAgent, QueryEngineTool, FunctionTool } from 'llamaindex';
import { SimpleDirectoryReader } from '@llamaindex/readers/directory';
import { OpenAIEmbedding, OpenAI } from '@llamaindex/openai';
import * as fs from 'fs-extra';
import * as path from 'path';
import { prisma } from './prisma';
import { meilisearchService } from './meilisearch';
import { hybridSearch, formatSearchResults } from './hybrid-search';

const indexCache = new Map<string, VectorStoreIndex>();
let isConfigured = false;

import { cleanMermaidSyntax } from './mermaid-cleaner';

/**
 * 工具名称到友好描述的映射
 */
const toolNameMap: Record<string, string> = {
  'search_knowledge': '🔍 混合检索知识库',
  'deep_search': '📚 深度混合检索',
  'keyword_search': '🔤 关键词精确搜索',
  'summarize_topic': '📋 获取文档原文',
  'decompose_question': '🔀 拆解复杂问题',
  'verify_answer': '✅ 验证答案质量',
  'get_current_datetime': '📅 获取当前日期时间',
  'web_search': '🌐 搜索互联网',
  'fetch_webpage': '📄 抓取网页内容',
  'generate_diagram': '🎨 生成可视化图表',
};

/**
 * 工具调用记录
 */
interface ToolCall {
  tool: string;
  input: string;
  output: string;
}

/**
 * 执行链路（用于质量评估）
 */
interface ExecutionTrace {
  // 用户问题
  question: string;
  
  // 意图判断
  intent: {
    type: string;
    description: string;
    keywords: string[];
    suggestedTool: string | null;
  };
  
  // 预检索结果
  preSearch: {
    executed: boolean;
    query: string;
    results: Array<{ docName: string; preview: string; score: number }>;
  };
  
  // Agent 工具调用链
  toolCalls: ToolCall[];
  
  // 最终回答
  answer: string;
}

/**
 * 解析 ReAct Agent 的输出，提取思考过程、最终答案和工具调用记录
 * 注意：保留答案中的换行符以保持格式
 */
function parseAgentOutput(rawOutput: string): { thinking: string[]; answer: string; toolCalls: ToolCall[] } {
  if (!rawOutput) return { thinking: [], answer: '', toolCalls: [] };
  
  const thinkingSteps: string[] = [];
  const toolCalls: ToolCall[] = [];
  let finalAnswer = '';
  
  // 特殊处理：如果包含 Mermaid 图表，直接提取完整图表
  // 格式1: 完整的 [MERMAID_DIAGRAM]...[/MERMAID_DIAGRAM]
  const mermaidMatch = rawOutput.match(/\[MERMAID_DIAGRAM\][\s\S]*?\[\/MERMAID_DIAGRAM\]/);
  if (mermaidMatch) {
    console.log(`[parseAgentOutput] ✅ 找到完整 Mermaid 格式`);
    return {
      thinking: ['🎨 生成流程图'],
      answer: mermaidMatch[0],
      toolCalls: [{ tool: 'generate_diagram', input: '', output: '' }],
    };
  }
  
  // 格式2: 有 flowchart/sequenceDiagram 但没有标签，自动包裹
  const flowchartMatch = rawOutput.match(/(flowchart\s+(?:TD|LR|TB|RL|BT)[\s\S]*?)(?=\n\n|$)/i);
  const sequenceMatch = rawOutput.match(/(sequenceDiagram[\s\S]*?)(?=\n\n|$)/i);
  const mermaidContent = flowchartMatch?.[1] || sequenceMatch?.[1];
  
  if (mermaidContent && mermaidContent.includes('-->')) {
    console.log(`[parseAgentOutput] ⚠️ 找到裸 Mermaid，自动包裹标签`);
    const wrappedMermaid = `[MERMAID_DIAGRAM]\n${mermaidContent.trim()}\n[/MERMAID_DIAGRAM]`;
    return {
      thinking: ['🎨 生成流程图'],
      answer: wrappedMermaid,
      toolCalls: [{ tool: 'generate_diagram', input: '', output: '' }],
    };
  }
  
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
  
  // 提取 Action 和 Observation（工具调用记录）
  const actionPattern = /Action:\s*(\w+)\s*Action Input:\s*(\{[^}]*\}|"[^"]*")\s*"*\s*Observation:\s*([\s\S]*?)(?=\s*(?:Thought:|Action:|Answer:|$))/gi;
  let actionMatch;
  while ((actionMatch = actionPattern.exec(compressedContent)) !== null) {
    const toolName = actionMatch[1];
    const toolInput = actionMatch[2];
    const toolOutput = actionMatch[3]?.substring(0, 200) || ''; // 截取前200字符
    
    toolCalls.push({
      tool: toolName,
      input: toolInput,
      output: toolOutput.trim(),
    });
    
    const friendlyName = toolNameMap[toolName] || `使用工具: ${toolName}`;
    if (!thinkingSteps.some(s => s.includes(friendlyName))) {
      thinkingSteps.push(friendlyName);
    }
  }
  
  // 如果上面没匹配到，用简单模式再试一次
  if (toolCalls.length === 0) {
    const simpleActionMatches = compressedContent.matchAll(/Action:\s*(\w+)/gi);
    for (const match of simpleActionMatches) {
    const toolName = match[1];
      toolCalls.push({ tool: toolName, input: '', output: '' });
      
    const friendlyName = toolNameMap[toolName] || `使用工具: ${toolName}`;
    if (!thinkingSteps.some(s => s.includes(friendlyName))) {
      thinkingSteps.push(friendlyName);
      }
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
    toolCalls,
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
      
      // 清除旧缓存，确保使用新索引
      if (indexCache.has(knowledgeBaseId)) {
        indexCache.delete(knowledgeBaseId);
        console.log(`[LLM] Cleared cached index for KB ${knowledgeBaseId}`);
      }
      
      const storageDir = this.getStorageDir(knowledgeBaseId);
      
      // 删除旧的存储目录，确保完全重建
      if (await fs.pathExists(storageDir)) {
        await fs.remove(storageDir);
        console.log(`[LLM] Removed old storage dir: ${storageDir}`);
      }
      
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

      // 为每个文档添加文件名到 metadata，便于按书名/文件名检索
      // 同时收集原文用于保存到数据库和 Meilisearch
      const documentContents: Map<string, { content: string; chunks: string[] }> = new Map();
      
      for (const doc of documents) {
        const filePath = doc.metadata?.file_path || doc.metadata?.filePath || '';
        const fileName = filePath ? path.basename(filePath) : '';
        const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, ''); // 去掉扩展名
        
        doc.metadata = {
          ...doc.metadata,
          fileName: fileName,
          documentName: fileNameWithoutExt,
        };
        
        // 收集文档内容（用于保存原文）
        if (fileName && doc.text) {
          const existing = documentContents.get(fileName);
          if (existing) {
            existing.content += '\n\n' + doc.text;
            existing.chunks.push(doc.text);
          } else {
            documentContents.set(fileName, {
              content: doc.text,
              chunks: [doc.text],
            });
          }
        }
        
        // 在文档内容前添加文件名标识
        if (fileNameWithoutExt && doc.text) {
          doc.text = `【文档: ${fileNameWithoutExt}】\n\n${doc.text}`;
        }
        
        console.log(`[LLM] Document metadata: ${fileName} -> ${fileNameWithoutExt}`);
      }

      console.log(`[LLM] Loaded ${documents.length} documents for KB ${knowledgeBaseId}`);
      onProgress?.(35, `已加载 ${documents.length} 个文档`);

      // ========== 保存原文到数据库（直接读取文件）==========
      console.log(`[LLM] Saving document content to database...`);
      onProgress?.(40, '保存文档原文到数据库...');
      
      // 直接读取文件内容，不依赖 llamaindex 的 Document 对象
      const pdfParse = require('pdf-parse');
      const mammoth = require('mammoth');
      
      // 遍历目录下所有文件（复用前面的 files 变量）
      for (const fileName of files) {
        const filePath = path.join(documentsPath, fileName);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        
        const ext = path.extname(fileName).toLowerCase();
        let content = '';
        
        try {
          if (ext === '.pdf') {
            const buffer = await fs.readFile(filePath);
            const pdfData = await pdfParse(buffer);
            content = pdfData.text || '';
            console.log(`[LLM] Extracted PDF content: ${fileName} (${content.length} chars)`);
          } else if (ext === '.docx') {
            const buffer = await fs.readFile(filePath);
            const result = await mammoth.extractRawText({ buffer });
            content = result.value || '';
            console.log(`[LLM] Extracted DOCX content: ${fileName} (${content.length} chars)`);
          } else if (ext === '.txt' || ext === '.md') {
            content = await fs.readFile(filePath, 'utf-8');
            console.log(`[LLM] Read text file: ${fileName} (${content.length} chars)`);
          }
        } catch (extractError) {
          console.error(`[LLM] Failed to extract content from ${fileName}:`, extractError);
          // 使用 documentContents 的备用内容
          const fallback = documentContents.get(fileName);
          if (fallback) {
            content = fallback.content;
          }
        }
        
        if (!content) continue;
        
        // 保存到数据库
        try {
          const searchName = fileName.replace(/^\d+_/, ''); // 移除时间戳前缀
          const dbDoc = await prisma.document.findFirst({
            where: {
              knowledgeBaseId,
              name: searchName,
            },
          });
          
          if (dbDoc) {
            await prisma.document.update({
              where: { id: dbDoc.id },
              data: {
                content: content,
                wordCount: content.length,
              },
            });
            console.log(`[LLM] ✅ Saved content for ${fileName} (${content.length} chars)`);
            
            // 收集用于 Meilisearch 索引
            documentContents.set(fileName, {
              content: content,
              chunks: [content], // 完整内容作为一个 chunk
            });
          } else {
            console.log(`[LLM] ⚠️ Document not found in DB: ${searchName}`);
          }
        } catch (dbError) {
          console.error(`[LLM] Failed to save content for ${fileName}:`, dbError);
        }
      }

      // ========== 索引到 Meilisearch ==========
      console.log(`[LLM] Indexing documents to Meilisearch...`);
      onProgress?.(45, '索引到 Meilisearch...');
      
      try {
        const meiliDocs = [];
        for (const [fileName, data] of documentContents) {
          const searchName = fileName.replace(/^\d+_/, '');
          const dbDoc = await prisma.document.findFirst({
            where: {
              knowledgeBaseId,
              name: searchName,
            },
          });
          
          if (dbDoc) {
            meiliDocs.push({
              documentId: dbDoc.id,
              documentName: fileName.replace(/\.[^/.]+$/, ''),
              content: data.content,
              chunks: data.chunks,
            });
          }
        }
        
        if (meiliDocs.length > 0) {
          await meilisearchService.indexDocuments(knowledgeBaseId, meiliDocs);
        }
      } catch (meiliError) {
        console.error(`[LLM] Meilisearch indexing failed (continuing without it):`, meiliError);
      }

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
   * @param chatHistory 对话历史，用于多轮对话上下文
   */
  static async query(
    knowledgeBaseId: string, 
    question: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<any> {
    configureLLM(); // 确保配置已加载
    console.log(`[LLM] Query: "${question}" in KB ${knowledgeBaseId}`);
    console.log(`[LLM] Chat history: ${chatHistory.length} messages`);
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

    // 如果有对话历史，将其作为上下文加入查询
    let queryWithContext = question;
    if (chatHistory.length > 0) {
      const historyContext = chatHistory
        .slice(-6) // 最多取最近 3 轮对话
        .map(msg => `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content}`)
        .join('\n');
      queryWithContext = `以下是之前的对话历史：\n${historyContext}\n\n用户当前问题：${question}\n\n请根据对话上下文回答当前问题。`;
      console.log(`[LLM] Query with context length: ${queryWithContext.length} chars`);
    }

    console.log(`[LLM] Executing query...`);
    const t3 = Date.now();
    const response = await queryEngine.query({
      query: queryWithContext,
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
   * 意图分析结果类型
   */
  private static intentTypes = {
    greeting: '问候/打招呼',
    small_talk: '闲聊',
    document_summary: '文档/书籍总结',
    knowledge_query: '知识库查询',
    draw_diagram: '画图/生成流程图',
    web_search: '网络搜索',
    datetime: '日期时间查询',
  };

  /**
   * 分析用户意图
   */
  private static async analyzeIntent(
    question: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<{
    intent: string;
    needsKnowledgeBase: boolean;
    keywords: string[];
    suggestedTool: string | null;
  }> {
    const llm = Settings.llm;
    
    // 构建对话上下文（最近 3 轮）
    const recentHistory = chatHistory.slice(-6);
    let contextStr = '';
    if (recentHistory.length > 0) {
      contextStr = '\n【最近对话】\n' + recentHistory.map(m => 
        `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`
      ).join('\n') + '\n';
    }
    
    const intentPrompt = `分析用户问题的意图，输出 JSON。
${contextStr}
用户当前问题: "${question}"

意图类型：
- greeting: 问候打招呼（你好、Hi、早上好等）
- small_talk: 闲聊（只有单纯的"谢谢、再见、好的"才是闲聊）
- document_summary: 总结某个文档/书籍（"xxx讲了什么"、"总结xxx"、"介绍xxx"）
- knowledge_query: 查询知识库中的具体信息（"什么是xxx"、"如何xxx"、"xxx的定义"）
- draw_diagram: 画图请求（"画个图"、"生成流程图"、"画架构图"、"重新生成"等）
- web_search: 需要实时网络信息（天气、新闻、最新消息）
- datetime: 日期时间查询（今天几号、现在几点）

【重要】意图判断规则：
1. 如果用户追问/抱怨上一轮的回答（如"重新生成"、"不对"、"你这啥"），意图应该和上一轮一样
2. 如果上一轮是画图，用户说"重新画"、"再详细点"，意图仍然是 draw_diagram
3. 只有纯粹的客套话才是 small_talk，带有任务要求的不是
4. needsKnowledgeBase: 只有 greeting、small_talk、datetime 不需要，其他都需要

输出 JSON 格式（不要其他内容）：
{"intent": "意图类型", "needsKnowledgeBase": true/false, "keywords": ["关键词"], "suggestedTool": "建议工具或null"}

示例：
问题: "Agents_v8.pdf 讲了什么"
输出: {"intent": "document_summary", "needsKnowledgeBase": true, "keywords": ["Agents_v8"], "suggestedTool": "summarize_topic"}

问题: "你好"
输出: {"intent": "greeting", "needsKnowledgeBase": false, "keywords": [], "suggestedTool": null}

问题: "画一个体检的流程图"
输出: {"intent": "draw_diagram", "needsKnowledgeBase": true, "keywords": ["体检", "流程"], "suggestedTool": "generate_diagram"}

问题: "重新生成" (上一轮是画图)
输出: {"intent": "draw_diagram", "needsKnowledgeBase": true, "keywords": ["重新生成"], "suggestedTool": "generate_diagram"}

问题: "你这啥玩意 我要时间地点" (上一轮是画图)
输出: {"intent": "draw_diagram", "needsKnowledgeBase": true, "keywords": ["时间", "地点"], "suggestedTool": "generate_diagram"}`;

    try {
      const response = await llm.complete({ prompt: intentPrompt });
      const text = response.text.trim();
      
      // 解析 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          intent: result.intent || 'knowledge_query',
          needsKnowledgeBase: result.needsKnowledgeBase !== false,
          keywords: result.keywords || [],
          suggestedTool: result.suggestedTool || null,
        };
      }
    } catch (error) {
      console.log(`[LLM] 🎯 Intent analysis error: ${error}`);
    }
    
    // 默认返回知识库查询
    return {
      intent: 'knowledge_query',
      needsKnowledgeBase: true,
      keywords: [],
      suggestedTool: null,
    };
  }

  /**
   * 生成直接回复（用于闲聊/问候）
   */
  private static async generateDirectResponse(question: string, intent: string): Promise<string> {
    const llm = Settings.llm;
    
    const responsePrompt = intent === 'greeting'
      ? `用户说: "${question}"
请用友好的中文回复问候，并简单介绍你是一个智能知识库助手，可以帮用户查询知识库内容、总结文档、画流程图等。回复要简洁自然。`
      : `用户说: "${question}"
请用友好的中文回复，保持简洁自然。你是一个智能知识库助手。`;

    try {
      const response = await llm.complete({ prompt: responsePrompt });
      return response.text.trim();
    } catch (error) {
      return intent === 'greeting' 
        ? '你好！我是智能知识库助手，可以帮你查询知识库内容、总结文档、画流程图等。有什么可以帮你的吗？'
        : '好的，有什么我可以帮你的吗？';
    }
  }

  /**
   * Agentic RAG 模式查询
   * @param chatHistory 对话历史，用于多轮对话上下文
   */
  static async agenticQuery(
    knowledgeBaseId: string, 
    question: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<any> {
    configureLLM(); // 确保配置已加载
    console.log(`[LLM] Agentic Query: "${question}" in KB ${knowledgeBaseId}`);
    console.log(`[LLM] Chat history: ${chatHistory.length} messages`);
    const startTime = Date.now();

    // ========== 第一步：意图判断（结合对话历史）==========
    console.log(`[LLM] ════════════════════════════════════════════════════════`);
    console.log(`[LLM] 🎯 Step 1: Intent Analysis...`);
    
    const intentResult = await this.analyzeIntent(question, chatHistory);
    console.log(`[LLM] 🎯 Intent: ${intentResult.intent}`);
    console.log(`[LLM] 🎯 Needs KB: ${intentResult.needsKnowledgeBase}`);
    console.log(`[LLM] 🎯 Keywords: ${intentResult.keywords.join(', ')}`);
    console.log(`[LLM] 🎯 Suggested Tool: ${intentResult.suggestedTool || 'none'}`);
    
    // 如果是闲聊/问候，直接回复，不走 Agent
    if (intentResult.intent === 'greeting' || intentResult.intent === 'small_talk') {
      console.log(`[LLM] 🎯 Direct response for ${intentResult.intent}, skipping Agent`);
      const directResponse = await this.generateDirectResponse(question, intentResult.intent);
      return {
        answer: directResponse,
        thinking: [`🎯 意图识别: ${intentResult.intent}，直接回复`],
        sourceNodes: [],
        isAgentic: true,
      };
    }
    
    console.log(`[LLM] ════════════════════════════════════════════════════════`);

    console.log(`[LLM] Loading index for agent...`);
    const index = await this.loadIndex(knowledgeBaseId);

    // ========== 工具 1: 混合检索（向量 + 关键词 RRF 融合）==========
    console.log(`[LLM] Creating tools for agent...`);
    const searchTool = FunctionTool.from(
      async ({ query }: { query: string }): Promise<string> => {
        console.log(`[LLM] 🔍 Hybrid search: "${query}"`);
        
        const results = await hybridSearch(index, knowledgeBaseId, query, {
          vectorTopK: 5,
          keywordLimit: 5,
        });
        
        if (results.length === 0) {
          actualToolCalls.push({ tool: 'search_knowledge', input: query, output: '未找到相关内容' });
          return '未找到相关内容';
        }
        
        const formatted = formatSearchResults(results, 3);
        console.log(`[LLM] 🔍 Found ${results.length} results (showing top 3)`);
        actualToolCalls.push({ tool: 'search_knowledge', input: query, output: formatted.substring(0, 200) });
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

    // ========== 工具 2: 深度检索 ==========
    const deepSearchTool = FunctionTool.from(
      async ({ query }: { query: string }): Promise<string> => {
        console.log(`[LLM] 📚 Deep hybrid search: "${query}"`);
        
        const results = await hybridSearch(index, knowledgeBaseId, query, {
          vectorTopK: 10,
          keywordLimit: 10,
        });
        
        if (results.length === 0) {
          actualToolCalls.push({ tool: 'deep_search', input: query, output: '未找到相关内容' });
          return '未找到相关内容';
        }
        
        const formatted = formatSearchResults(results, 8);
        console.log(`[LLM] 📚 Found ${results.length} results (showing top 8)`);
        actualToolCalls.push({ tool: 'deep_search', input: query, output: formatted.substring(0, 200) });
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

    // ========== 工具 3: 关键词精确搜索 ==========
    const keywordSearchTool = FunctionTool.from(
      async ({ query }: { query: string }): Promise<string> => {
        console.log(`[LLM] 🔤 Keyword search: "${query}"`);
        
        const results = await meilisearchService.search(knowledgeBaseId, query, 5);
        
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

    // ========== 工具 4: 总结工具（优化：直接读取原文）==========
    const summarizeTool = FunctionTool.from(
      async ({ topic }: { topic: string }): Promise<string> => {
        console.log(`[LLM] ────────────────────────────────────────────────────────`);
        console.log(`[LLM] 📋 Summarize tool called with topic: "${topic}"`);
        
        // 1. 尝试从数据库直接读取原文（快速）
        try {
          const doc = await prisma.document.findFirst({
            where: {
              knowledgeBaseId,
              OR: [
                { name: { contains: topic } },
                { content: { contains: topic } },
              ],
            },
            select: { name: true, content: true, wordCount: true },
          });
          
          if (doc?.content && doc.content.length > 100) {
            console.log(`[LLM] 📋 Found document "${doc.name}" (${doc.wordCount} chars) in database`);
            // 返回原文给 Agent，让 Agent 自己总结（省去一次 LLM 调用）
            const content = doc.content.length > 8000 
              ? doc.content.substring(0, 8000) + '\n\n...(内容截断，共' + doc.wordCount + '字)'
              : doc.content;
            console.log(`[LLM] 📋 Returning raw content (${content.length} chars)`);
            console.log(`[LLM] ────────────────────────────────────────────────────────`);
            return `【文档: ${doc.name}】\n\n${content}`;
          }
        } catch (dbError) {
          console.log(`[LLM] 📋 Database lookup failed, falling back to retriever`);
        }
        
        // 2. Fallback: 使用 retriever 检索（不调用 LLM）
        const retriever = index.asRetriever({ similarityTopK: 15 });
        const nodes = await retriever.retrieve(topic);
        
        if (nodes.length === 0) {
          console.log(`[LLM] 📋 No content found for topic: ${topic}`);
          return '未找到相关内容';
        }
        
        // 直接拼接检索结果，不调用 LLM
        const contents = nodes
          .map((n, i) => `[片段${i + 1}] ${(n.node as any).text || ''}`)
          .join('\n\n');
        
        console.log(`[LLM] 📋 Retrieved ${nodes.length} chunks (${contents.length} chars)`);
        console.log(`[LLM] ────────────────────────────────────────────────────────`);
        return contents;
      },
      {
        name: 'summarize_topic',
        description: '获取知识库中关于某个主题/文档的完整内容。输入文档名或主题关键词，返回原始内容供你总结。',
        parameters: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: '文档名或主题关键词',
            },
          },
          required: ['topic'],
        },
      }
    );

    // ========== 工具 4: 网络搜索 ==========
    // 追踪无效调用次数，防止死循环
    let webSearchInvalidCount = 0;
    const MAX_INVALID_CALLS = 3;
    
    const webSearchTool = FunctionTool.from(
      async (params: { query: string } | string): Promise<string> => {
        // 兼容不同的参数格式
        let query: string;
        if (typeof params === 'string' && params.trim()) {
          query = params.trim();
        } else if (params && typeof params === 'object' && params.query && params.query.trim()) {
          query = params.query.trim();
        } else {
          webSearchInvalidCount++;
          console.log(`[LLM] 🌐 Web search: invalid params (${webSearchInvalidCount}/${MAX_INVALID_CALLS})`, params);
          
          if (webSearchInvalidCount >= MAX_INVALID_CALLS) {
            // 达到最大无效调用次数，返回强停止信号
            return '[ERROR] 网络搜索工具调用失败次数过多，请停止调用此工具，直接基于已有信息回答。';
          }
          return '搜索参数无效，请提供有效的搜索关键词，格式为 {"query": "搜索内容"}';
        }
        
        // 有效调用，重置计数器
        webSearchInvalidCount = 0;
        
        console.log(`[LLM] 🌐 Web search: original query "${query}"`);
        
        // 用 LLM 分析用户意图，生成最佳搜索词
        let optimizedQuery = query;
        try {
          const llm = Settings.llm;
          const intentResponse = await llm.complete({
            prompt: `你是一个搜索优化专家。用户想搜索的内容是："${query}"

请分析用户意图，生成一个最适合在搜索引擎中使用的简洁搜索词。

要求：
1. 只输出搜索词本身，不要任何解释
2. 搜索词要简洁有效，通常 2-5 个关键词
3. 去掉口语化的词（如"啊"、"呢"、"吗"）
4. 如果是查天气，格式为"城市名+天气"
5. 如果是查新闻，加上时间词如"最新"

直接输出搜索词：`,
          });
          
          optimizedQuery = intentResponse.text.trim().replace(/["""'']/g, '');
          console.log(`[LLM] 🌐 Intent analysis: "${query}" → "${optimizedQuery}"`);
        } catch (e) {
          console.log(`[LLM] 🌐 Intent analysis failed, using original query`);
        }
        
        // SearXNG 实例列表（优先使用自建实例）
        const instances = [
          'http://39.96.203.251:8888',  // 自建实例（优先） 
        ];
        
        for (const instance of instances) {
          try {
            const url = `${instance}/search?q=${encodeURIComponent(optimizedQuery)}&format=json&language=zh-CN`;
            console.log(`[LLM] 🌐 Trying instance: ${instance}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时
            
            const response = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'application/json',
              },
              signal: controller.signal,
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
              console.log(`[LLM] 🌐 Instance ${instance} returned ${response.status}`);
              continue;
            }
            
            const data = await response.json();
            
            if (!data.results || data.results.length === 0) {
              console.log(`[LLM] 🌐 Instance ${instance} returned no results`);
              continue;
            }
            
            const results = data.results.slice(0, 3);
            const top3 = results.map((r: any, i: number) => 
              `[${i + 1}] ${r.title || '无标题'}\n${r.content || r.description || '无描述'}\n来源: ${r.url}`
            ).join('\n\n');
            
            console.log(`[LLM] 🌐 Web search found ${data.results.length} results from ${instance}`);
            console.log(`[LLM] 🌐 Search results returned to Agent:\n${top3}`);
            
            // 自动抓取第一个结果的网页内容（因为千问对工具调用支持不好）
            if (results.length > 0 && results[0].url) {
              try {
                console.log(`[LLM] 🌐 Auto-fetching first result: ${results[0].url}`);
                const pageResponse = await fetch(results[0].url, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'text/html',
                  },
                  signal: AbortSignal.timeout(8000),
                });
                
                if (pageResponse.ok) {
                  let pageText = await pageResponse.text();
                  // 简单清理 HTML
                  pageText = pageText
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 2000);
                  
                  console.log(`[LLM] 🌐 Auto-fetched page content: ${pageText.length} chars`);
                  
                  return `搜索结果摘要:\n${top3}\n\n第一个网页的详细内容:\n${pageText}`;
                }
              } catch (e) {
                console.log(`[LLM] 🌐 Auto-fetch failed, returning search results only`);
              }
            }
            
            return top3;
          } catch (error: any) {
            console.log(`[LLM] 🌐 Instance ${instance} failed: ${error.message}`);
            continue;
          }
        }
        
        console.log(`[LLM] 🌐 All SearXNG instances failed`);
        return '网络搜索暂时不可用，所有搜索节点均无响应';
      },
      {
        name: 'web_search',
        description: '搜索互联网获取最新信息。当知识库中没有答案，或需要实时资讯、新闻、最新技术动态时使用。',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键词',
            },
          },
          required: ['query'],
        },
      }
    );

    // ========== 工具 5: 获取当前日期时间 ==========
    const dateTimeTool = FunctionTool.from(
      async (): Promise<string> => {
        const now = new Date();
        
        // 格式化日期时间（中国时区）
        const options: Intl.DateTimeFormatOptions = {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        };
        
        const formatter = new Intl.DateTimeFormat('zh-CN', options);
        const formatted = formatter.format(now);
        
        // 额外提供一些有用信息
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const dayOfYear = Math.ceil((now.getTime() - new Date(year, 0, 1).getTime()) / 86400000);
        const weekNumber = Math.ceil(dayOfYear / 7);
        
        const result = `当前日期时间：${formatted}
- 公历日期：${year}年${month}月${day}日
- 今天是 ${year} 年的第 ${dayOfYear} 天
- 今天是 ${year} 年的第 ${weekNumber} 周`;
        
        console.log(`[LLM] 📅 DateTime tool called, result: ${formatted}`);
        actualToolCalls.push({ tool: 'get_current_datetime', input: '', output: result });
        return result;
      },
      {
        name: 'get_current_datetime',
        description: '获取当前的日期和时间。当用户询问"今天是几号"、"现在几点"、"今天星期几"、"什么时候"等与日期时间相关的问题时使用此工具。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      }
    );

    // ========== 工具 6: 网页抓取 ==========
    const fetchWebpageTool = FunctionTool.from(
      async (params: { url: string } | string): Promise<string> => {
        // 兼容不同的参数格式
        let url: string;
        if (typeof params === 'string') {
          url = params;
        } else if (params && typeof params === 'object' && params.url) {
          url = params.url;
        } else {
          console.log(`[LLM] 📄 Fetch webpage: invalid params`, params);
          return '网页URL参数无效';
        }
        
        console.log(`[LLM] 📄 Fetching webpage: ${url}`);
        
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
          
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            return `无法访问该网页: HTTP ${response.status}`;
          }
          
          const html = await response.text();
          
          // 提取正文内容（简单清理 HTML）
          let text = html
            // 移除 script 和 style
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            // 移除 HTML 标签
            .replace(/<[^>]+>/g, ' ')
            // 解码 HTML 实体
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            // 清理多余空白
            .replace(/\s+/g, ' ')
            .trim();
          
          // 限制长度（避免内容过长）
          if (text.length > 3000) {
            text = text.substring(0, 3000) + '...(内容已截断)';
          }
          
          console.log(`[LLM] 📄 Webpage content length: ${text.length} chars`);
          return text || '网页内容为空';
        } catch (error: any) {
          console.error(`[LLM] 📄 Fetch webpage failed: ${error.message}`);
          return `抓取网页失败: ${error.message}`;
        }
      },
      {
        name: 'fetch_webpage',
        description: '抓取指定网页的内容。当 web_search 返回的摘要不够详细时，使用此工具获取网页的完整内容。输入网页 URL，返回网页正文。',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '要抓取的网页 URL',
            },
          },
          required: ['url'],
        },
      }
    );

    // ========== 工具 7: 生成可视化图表 ==========
    const generateDiagramTool = FunctionTool.from(
      async (params: { description: string; chartType?: string }): Promise<string> => {
        const { description, chartType = 'flowchart' } = params;
        console.log(`[LLM] 🎨 Generate diagram: "${description?.substring(0, 100)}...", type: ${chartType}`);
        
        // 校验：description 必须有有效内容
        if (!description || description === 'undefined' || description.length < 20) {
          console.log(`[LLM] 🎨 ❌ Invalid description, length: ${description?.length || 0}`);
          const errMsg = `图表生成失败：description 参数无效或内容太短。请先使用 deep_search 或 summarize_topic 获取详细内容，然后将内容作为 description 传入。`;
          actualToolCalls.push({ tool: 'generate_diagram', input: description || '', output: errMsg });
          return errMsg;
        }
        
        try {
          const llm = Settings.llm;
          
          // ========== 第一步：逻辑分析 ==========
          const analysisPrompt = `请分析以下内容的逻辑结构，整理出正确的执行顺序。

## 内容描述
${description}

## 请分析并输出：
1. 【前置准备】：需要提前做的事（时间上在前的）
2. 【核心步骤】：主要执行的步骤（按先后顺序）
3. 【后续处理】：完成后的事情

## 输出格式（按正确的时间/逻辑顺序列出，每行一个步骤）：
1. xxx（前置）
2. xxx（前置）
3. xxx（核心）
4. xxx（核心）
...

请直接输出编号列表，不要其他内容：`;

          console.log(`[LLM] 🎨 Step 1: Analyzing logic structure...`);
          const analysisResponse = await llm.complete({ prompt: analysisPrompt });
          const analysisResult = analysisResponse.text.trim();
          console.log(`[LLM] 🎨 Analysis result:\n${analysisResult}`);

          // ========== 第二步：生成 Mermaid ==========
          const diagramPrompt = `你是一个 Mermaid 图表专家。请严格按照给定的步骤顺序生成流程图。

## 已分析的正确顺序（必须严格按此顺序）
${analysisResult}

## 图表类型
${chartType === 'sequenceDiagram' ? '时序图 (sequenceDiagram)' : '流程图 (flowchart)'}

## 输出要求
1. 直接输出 Mermaid 语法，不要代码块
2. 严格按照上面的顺序，不要调整顺序！
3. 节点内容包含具体信息（时间、地点等）
4. ⚠️【重要】节点内容不要包含"（前置）"、"（核心）"、"（后续）"等分类标签
5. 禁止使用 \\n 换行符
6. 8-12 个节点

## 语法示例
flowchart TD
  A[体检前3天饮食清淡] --> B[体检前1天晚8点后禁食]
  B --> C[体检当天到达医院]
  C --> D[完成各项检查]
  D --> E[交回导引单]

请直接输出 Mermaid（不要分类标签）：`;

          console.log(`[LLM] 🎨 Step 2: Generating Mermaid...`);
          const diagramResponse = await llm.complete({ prompt: diagramPrompt });
          let mermaidSyntax = diagramResponse.text.trim();
          
          // 使用 mermaid-cleaner 清洗语法
          const cleanResult = cleanMermaidSyntax(mermaidSyntax);
          
          if (!cleanResult.success) {
            console.log(`[LLM] 🎨 Mermaid clean failed: ${cleanResult.error}`);
            const errMsg = `图表生成失败: ${cleanResult.error}`;
            actualToolCalls.push({ tool: 'generate_diagram', input: description.substring(0, 100), output: errMsg });
            return errMsg;
          }
          
          mermaidSyntax = cleanResult.data!;
          console.log(`[LLM] 🎨 Generated Mermaid (${mermaidSyntax.length} chars):\n${mermaidSyntax}`);
          
          // 返回特殊格式，前端可以识别并渲染
          // 同时告诉 Agent 直接使用这个结果
          const result = `图表已生成成功！请直接将以下内容作为回答（不要修改）：

[MERMAID_DIAGRAM]
${mermaidSyntax}
[/MERMAID_DIAGRAM]

请直接输出上面的内容，不要用其他格式。`;
          actualToolCalls.push({ tool: 'generate_diagram', input: description.substring(0, 100), output: '图表生成成功' });
          return result;
        } catch (error: any) {
          console.error(`[LLM] 🎨 Generate diagram failed: ${error.message}`);
          const errMsg = `图表生成失败: ${error.message}`;
          actualToolCalls.push({ tool: 'generate_diagram', input: description?.substring(0, 100) || '', output: errMsg });
          return errMsg;
        }
      },
      {
        name: 'generate_diagram',
        description: '生成可视化图表（流程图、架构图、时序图等）。⚠️ 必须先调用 deep_search 或 summarize_topic 获取详细信息，然后将获取的详细内容作为 description 参数传入。不要基于预检索内容直接生成，要确保图表尽可能详细。',
        parameters: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: '图表内容描述，包括要展示的组件、步骤、关系等',
            },
            chartType: {
              type: 'string',
              enum: ['flowchart', 'sequenceDiagram'],
              description: '图表类型：flowchart（流程图/架构图）或 sequenceDiagram（时序图）',
            },
          },
          required: ['description'],
        },
      }
    );

    // ========== System Prompt ==========
    const systemPrompt = `你是一个智能知识库助手。你的任务是基于用户上传的知识库文档回答问题。

## 可用工具
1. search_knowledge - 混合检索（向量+关键词融合）
2. deep_search - 深度混合检索（更多结果）
3. keyword_search - 关键词精确搜索（适合专有名词、文件名）
4. summarize_topic - 获取文档原文（用于总结）
5. web_search - 网络搜索（仅当知识库没有时使用）
6. get_current_datetime - 获取当前日期时间
7. fetch_webpage - 网页抓取
8. generate_diagram - 生成可视化图表

## 意图判断与工具选择

**文档/书籍总结类问题：**
- "xxx讲了什么" / "总结一下xxx" → 使用 summarize_topic 获取原文，然后你来总结

**精确查找（文件名、代码、专有名词）：**
- "找到 xxx.pdf" / "搜索 function_name" → 使用 keyword_search

**语义查询（概念、定义）：**
- "什么是xxx" / "如何做xxx" → 使用 search_knowledge 或 deep_search

**画图请求（重要！）：**
- "画个xxx图" / "流程图" / "时间安排" → 【必须】先调用 deep_search 或 summarize_topic 获取详细信息，再调用 generate_diagram
- ⚠️ 即使已有预检索内容，也必须调用工具获取更完整的信息
- 图表要尽可能详细，包含所有步骤和细节

**网络搜索（最后手段）：**
- 只有当问题明显与知识库无关时才使用 web_search

## ⚠️ 重要规则
1. **必须用中文回答**
2. **优先使用知识库工具**，禁止跳过检索直接回答
3. 回答要详细、有条理，基于知识库内容
4. 如果知识库有相关内容，禁止使用网络搜索
5. **画图前必须调用 deep_search 或 summarize_topic**，预检索内容不够详细`;

    // 创建 ReAct Agent，配备工具
    console.log(`[LLM] Creating ReAct Agent with 8 tools...`);
    console.log(`[LLM]   - search_knowledge: 混合检索 (RRF融合)`);
    console.log(`[LLM]   - deep_search: 深度混合检索`);
    console.log(`[LLM]   - keyword_search: 关键词精确搜索 (Meilisearch)`);
    console.log(`[LLM]   - summarize_topic: 获取文档原文`);
    console.log(`[LLM]   - web_search: 网络搜索 (SearXNG)`);
    console.log(`[LLM]   - get_current_datetime: 获取当前日期时间`);
    console.log(`[LLM]   - fetch_webpage: 网页抓取`);
    console.log(`[LLM]   - generate_diagram: 生成可视化图表`);
    
    // ========== 初始化执行链路 ==========
    const trace: ExecutionTrace = {
      question,
      intent: {
        type: intentResult.intent,
        description: this.intentTypes[intentResult.intent as keyof typeof this.intentTypes] || '未知',
        keywords: intentResult.keywords,
        suggestedTool: intentResult.suggestedTool,
      },
      preSearch: {
        executed: false,
        query: '',
        results: [],
      },
      toolCalls: [],
      answer: '',
    };
    
    // 实际工具调用记录（工具函数中直接记录，比从输出解析更可靠）
    const actualToolCalls: ToolCall[] = [];

    // ========== 根据意图决定是否预检索知识库 ==========
    console.log(`[LLM] ────────────────────────────────────────────────────────`);
    let knowledgeContext = '';
    
    if (intentResult.needsKnowledgeBase) {
      console.log(`[LLM] 📚 Pre-fetching from knowledge base...`);
      
      // 使用意图分析中的关键词优化检索查询
      const searchQuery = intentResult.keywords.length > 0 
        ? intentResult.keywords.join(' ') + ' ' + question
        : question;
      console.log(`[LLM] 📚 Search query: "${searchQuery}"`);
      
      trace.preSearch.executed = true;
      trace.preSearch.query = searchQuery;
      
      // 使用混合搜索（向量 + 关键词）获取更准确的结果
      const results = await hybridSearch(index, knowledgeBaseId, searchQuery, {
        vectorTopK: 5,
        keywordLimit: 5,
      });
      
      if (results && results.length > 0) {
        console.log(`[LLM] 📚 Found ${results.length} relevant documents (hybrid search):`);
        const sources = results.map((result: any, i: number) => {
          const text = result.content || '';
          const docName = result.documentName || '未知文档';
          const score = parseFloat(result.score?.toFixed(3) || '0');
          console.log(`[LLM] 📚   [${i + 1}] ${docName} (score: ${score})`);
          console.log(`[LLM] 📚       ${text.substring(0, 100).replace(/\n/g, ' ')}...`);
          
          // 收集到 trace
          trace.preSearch.results.push({
            docName,
            preview: text.substring(0, 200),
            score,
          });
          
          return `[来源${i + 1}: ${docName}]\n${text.substring(0, 500)}`;
        });
        knowledgeContext = sources.join('\n\n');
      } else {
        console.log(`[LLM] 📚 No relevant documents found in knowledge base`);
      }
    } else {
      console.log(`[LLM] 📚 Skipping pre-fetch (intent: ${intentResult.intent})`);
    }
    console.log(`[LLM] ────────────────────────────────────────────────────────`);

    // 将知识库内容和意图信息注入到问题中
    let enrichedQuestion = question;
    
    if (knowledgeContext) {
      enrichedQuestion = `## 知识库检索结果（必须基于以下内容回答）：\n${knowledgeContext}\n\n`;
    }
    
    // 根据意图添加提示
    if (intentResult.suggestedTool) {
      enrichedQuestion += `## 意图分析：\n- 用户意图: ${intentResult.intent}\n- 建议使用工具: ${intentResult.suggestedTool}\n- 关键词: ${intentResult.keywords.join(', ') || '无'}\n\n`;
    }
    
    enrichedQuestion += `## 用户问题：\n${question}\n\n`;
    
    // 针对画图请求的特殊提示
    if (intentResult.intent === 'draw_diagram') {
      enrichedQuestion += `⚠️ 【画图请求特别说明】：
1. 上面的预检索内容只是概述，不够详细
2. 你【必须】先调用 deep_search 或 summarize_topic 获取更详细的信息
3. 然后将详细内容作为 description 传给 generate_diagram
4. 图表要尽可能详细，包含所有步骤、时间点、注意事项等

`;
    }
    
    if (knowledgeContext) {
      enrichedQuestion += `请基于上述知识库内容用中文回答问题。必须使用知识库内容，不要编造信息。`;
    } else {
      enrichedQuestion += `请用中文回答问题。`;
    }
    
    // 将对话历史转换为 LlamaIndex 格式
    const llamaHistory = chatHistory.slice(-6).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const agent = new ReActAgent({
      tools: [searchTool, deepSearchTool, keywordSearchTool, summarizeTool, webSearchTool, dateTimeTool, fetchWebpageTool, generateDiagramTool],
      chatHistory: llamaHistory, // 传入对话历史
      verbose: true, // 日志显示思考过程
    });

    // Agent 执行查询
    console.log(`[LLM] Agent thinking and executing...`);
    console.log(`[LLM] ════════════════════════════════════════════════════════`);
    const response = await agent.chat({ message: enrichedQuestion });

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

    // 解析 Agent 输出，提取思考过程、最终答案和工具调用记录
    let { thinking, answer, toolCalls: parsedToolCalls } = parseAgentOutput(response.response || '');
    
    // 合并工具调用：优先使用 actualToolCalls（工具函数直接记录，更可靠）
    // 如果 actualToolCalls 为空，则使用从输出解析的 parsedToolCalls
    const toolCalls = actualToolCalls.length > 0 ? actualToolCalls : parsedToolCalls;
    
    // 更新执行链路
    trace.toolCalls = toolCalls;
    trace.answer = answer;
    
    console.log(`[LLM] Thinking steps: ${thinking.length}`);
    thinking.forEach((step, i) => console.log(`[LLM]   ${i + 1}. ${step}`));
    console.log(`[LLM] Tool calls: ${toolCalls.length} (actual: ${actualToolCalls.length}, parsed: ${parsedToolCalls.length})`);
    toolCalls.forEach((call, i) => {
      console.log(`[LLM]   🔧 [${i + 1}] ${call.tool}(${call.input.substring(0, 50)}${call.input.length > 50 ? '...' : ''})`);
      if (call.output) {
        console.log(`[LLM]       → ${call.output.substring(0, 80)}${call.output.length > 80 ? '...' : ''}`);
      }
    });
    console.log(`[LLM] Final answer length: ${answer.length} chars`);

    // ========== LLM 质量评估（宽松模式）==========
    const llm = Settings.llm;
    let qualityPassed = false;
    let lastIssue = '';
    
    // ========== 格式预检查（不需要 LLM）==========
    if (trace.intent.type === 'draw_diagram') {
      const hasMermaidTag = answer.includes('[MERMAID_DIAGRAM]') && answer.includes('[/MERMAID_DIAGRAM]');
      const hasFlowchart = answer.includes('flowchart') && answer.includes('-->');
      
      if (!hasMermaidTag && hasFlowchart) {
        // 格式不对，尝试自动修复
        console.log(`[LLM] 📊 格式预检查：发现裸 Mermaid，自动修复`);
        const mermaidMatch = answer.match(/(flowchart\s+(?:TD|LR|TB|RL|BT)[\s\S]*?)(?=\n\n|$)/i);
        if (mermaidMatch) {
          answer = `[MERMAID_DIAGRAM]\n${mermaidMatch[1].trim()}\n[/MERMAID_DIAGRAM]`;
          console.log(`[LLM] 📊 格式预检查：已修复，新长度 ${answer.length}`);
        }
      } else if (hasMermaidTag) {
        console.log(`[LLM] 📊 格式预检查：✅ Mermaid 格式正确`);
      }
    }
    
    // 构建简洁的评估上下文
    const evalContext = {
      question: trace.question,
      intent: trace.intent.type,
      hasPreSearch: trace.preSearch.executed,
      preSearchCount: trace.preSearch.results.length,
      toolsCalled: trace.toolCalls.map(c => c.tool),
      answerLength: answer.length,
      hasDiagram: answer.includes('[MERMAID_DIAGRAM]') || answer.includes('flowchart')
    };
    
    console.log(`[LLM] 📊 Quality evaluation...`);
    
    const evalPrompt = `请评估 AI 回答的质量，重点检查逻辑正确性。

【上下文】
- 用户问题: "${evalContext.question}"
- 用户意图: ${evalContext.intent}
- 回答长度: ${evalContext.answerLength} 字符
${evalContext.intent === 'draw_diagram' ? `- 包含图表: ${evalContext.hasDiagram ? '是' : '否'}` : ''}

【回答内容】
${answer.substring(0, 2500)}${answer.length > 2500 ? '...(截断)' : ''}

【评估标准】

✅ 通过条件：
1. 回答内容切题，有实质信息
2. 图表问题生成了 mermaid 代码

❌ 不通过条件：
1. 回答跑题或答非所问
2. 回答是空话套话
3. 图表问题但没有生成图表代码
4. ⚠️【仅当回答包含流程/步骤时检查】逻辑关系错误：
   - 只有当回答中有 A→B→C 这样的流程/步骤时才需要检查
   - 如果是单纯的事实回答（如"几点"、"在哪"），不需要检查逻辑关系
   - 逻辑错误示例：
     - "到达医院" → "禁食禁水" ❌（应该先禁食再到达）
     - "安装软件" → "下载软件" ❌（应该先下载再安装）

【输出格式】
只输出 JSON：{"pass": true/false, "reason": "一句话理由"}`;

    const MAX_RETRIES = 3;
    let retryCount = 0;
    
    while (!qualityPassed && retryCount < MAX_RETRIES) {
      try {
        // 构建当前轮次的评估 prompt
        const currentEvalPrompt = evalPrompt
          .replace(/- 回答长度: \d+ 字符/, `- 回答长度: ${answer.length} 字符`)
          .replace(/【回答内容】[\s\S]*?【评估标准】/, `【回答内容】\n${answer.substring(0, 2500)}${answer.length > 2500 ? '...(截断)' : ''}\n\n【评估标准】`);
        
        console.log(`[LLM] 📊 Quality check (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        const evalResponse = await llm.complete({ prompt: currentEvalPrompt });
        const evalText = evalResponse.text.trim();
        console.log(`[LLM] 📊 Eval: ${evalText}`);
        
        const jsonMatch = evalText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const evalResult = JSON.parse(jsonMatch[0]);
          
          if (evalResult.pass) {
            console.log(`[LLM] 📊 Quality: ✅ PASS`);
            qualityPassed = true;
          } else {
            lastIssue = evalResult.reason;
            console.log(`[LLM] 📊 Quality: ❌ FAIL - ${lastIssue}`);
            console.log(`[LLM] 📊 当前回答内容: ${answer.substring(0, 200)}${answer.length > 200 ? '...' : ''}`);
            
            retryCount++;
            if (retryCount < MAX_RETRIES) {
              console.log(`[LLM] 📊 Retrying (${retryCount}/${MAX_RETRIES})...`);
              
              // 重试时提供完整上下文，避免 Agent 不知道原始问题
              // 注意：重试时不要使用网络搜索，只基于已有知识库内容
              const retryMessage = `请改进你的回答。

【问题】${lastIssue}

【原始用户问题】${question}

【已知信息】
${knowledgeContext || '无预检索内容'}

请重新生成，特别注意逻辑顺序：前置准备→核心步骤→后续处理。
注意：请直接基于已有信息回答，不要调用网络搜索工具。`;
              
              // 添加 30 秒超时保护，防止死循环
              const RETRY_TIMEOUT = 30000;
              try {
                const retryResponse = await Promise.race([
                  agent.chat({ message: retryMessage }),
                  new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Retry timeout')), RETRY_TIMEOUT)
                  )
                ]);
              
              const retryParsed = parseAgentOutput(retryResponse.response || '');
              if (retryParsed.answer && retryParsed.answer.length > 50) {
                answer = retryParsed.answer;
                thinking = [...thinking, ...retryParsed.thinking];
                console.log(`[LLM] 📊 Retry done, new answer length: ${answer.length} chars`);
              } else {
                console.log(`[LLM] 📊 Retry failed, keeping previous answer`);
                break; // 重试结果太短，停止重试
                }
              } catch (retryError: any) {
                console.log(`[LLM] 📊 Retry error: ${retryError.message}, keeping previous answer`);
                break; // 重试超时或出错，停止重试
              }
            }
          }
        } else {
          console.log(`[LLM] 📊 Eval parse failed, passing`);
          qualityPassed = true;
        }
      } catch (evalError) {
        console.log(`[LLM] 📊 Eval error (ignored): ${evalError}`);
        qualityPassed = true;
      }
    }
    
    // 达到最大重试次数后，使用最后的结果
    if (!qualityPassed) {
      console.log(`[LLM] 📊 Max retries reached, using last answer`);
      qualityPassed = true;
    }
    
    // 兜底：如果还没通过，但回答有一定长度，也通过
    if (!qualityPassed && answer.length > 100) {
      console.log(`[LLM] 📊 Fallback pass: answer length ${answer.length} > 100`);
      qualityPassed = true;
    }

    // ========== 最终校验：确保图表格式正确 ==========
    let finalAnswer = answer;
    
    // 检查1: 如果意图是画图，但没有正确的 Mermaid 标签
    if (trace.intent.type === 'draw_diagram') {
      const hasMermaidTag = finalAnswer.includes('[MERMAID_DIAGRAM]') && finalAnswer.includes('[/MERMAID_DIAGRAM]');
      const hasFlowchart = finalAnswer.includes('flowchart') && finalAnswer.includes('-->');
      const hasSequence = finalAnswer.includes('sequenceDiagram');
      
      if (!hasMermaidTag && (hasFlowchart || hasSequence)) {
        // 有 Mermaid 代码但没有标签，自动包裹
        console.log(`[LLM] ⚠️ 最终校验：发现裸 Mermaid，自动包裹标签`);
        const mermaidMatch = finalAnswer.match(/(flowchart\s+(?:TD|LR|TB|RL|BT)[\s\S]*?)(?=\n\n|$)/i) 
                          || finalAnswer.match(/(sequenceDiagram[\s\S]*?)(?=\n\n|$)/i);
        if (mermaidMatch) {
          finalAnswer = `[MERMAID_DIAGRAM]\n${mermaidMatch[1].trim()}\n[/MERMAID_DIAGRAM]`;
        }
      } else if (!hasMermaidTag && !hasFlowchart && !hasSequence) {
        // 画图意图但没有任何图表内容
        console.log(`[LLM] ❌ 最终校验：画图请求但没有图表内容`);
      } else if (hasMermaidTag) {
        console.log(`[LLM] ✅ 最终校验：Mermaid 格式正确`);
      }
    }

    return {
      answer: finalAnswer,
      thinking: thinking,
      sourceNodes: response.sourceNodes?.map((node: any) => ({
        text: node.node?.text || node.node?.getContent?.() || '',
        score: node.score,
        metadata: node.node?.metadata,
      })) || [],
      // 新增：返回检索内容供评估使用
      retrievedContent: knowledgeContext || '',
      toolCalls: trace.toolCalls,
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
