/**
 * ReAct Agent 核心模块
 * 实现 Agentic RAG 查询逻辑
 */
import { ReActAgent, Settings } from 'llamaindex';
import { configureLLM } from './config';
import { loadIndex } from './index-manager';
import { parseAgentOutput, fixMermaidFormat, type ToolCall } from './output-parser';
import { createToolContext, createAllTools, getToolCalls, getSearchResults } from './tools';
// 意图分析从上下文工程模块导入
import { 
  analyzeIntent, 
  generateDirectResponse, 
  shouldSkipAgent, 
  intentTypes, 
  type IntentType 
} from '../context';
import { hybridSearch, formatSearchResults } from '../hybrid-search';
import { 
  preCheckFormat, 
  evaluateQuality, 
  buildEvaluationContext, 
  finalValidation 
} from './quality-evaluator';
import { 
  getContextEngine,
  createAdaptiveContextManager,
  wrapAllTools,
  createContextAwareToolContext,
  type ContextAwareToolContext,
} from '../context';

/**
 * 执行链路（用于质量评估）
 */
interface ExecutionTrace {
  question: string;
  intent: {
    type: string;
    description: string;
    keywords: string[];
    suggestedTool: string | null;
  };
  preSearch: {
    executed: boolean;
    query: string;
    results: Array<{ docName: string; preview: string; score: number }>;
  };
  toolCalls: ToolCall[];
  answer: string;
}

/**
 * Agent 查询结果
 */
export interface AgentQueryResult {
  answer: string;
  thinking: string[];
  sourceNodes: Array<{
    text: string;
    score: number;
    type: string;
    documentName?: string;
    metadata?: any;
  }>;
  retrievedContent?: string;
  toolCalls?: ToolCall[];
  isAgentic: boolean;
}

/**
 * System Prompt
 */
const SYSTEM_PROMPT = `你是一个智能知识库助手。你的任务是基于用户上传的知识库文档回答问题。

## 🔥 上下文理解（最重要！）

用户的消息中会包含以下上下文信息，你需要可以使用这些信息：

1. **对话历史 / 对话历史摘要**：之前的对话内容，可以直接引用回答
2. **用户记忆**：系统记住的用户偏好和重要信息
3. **知识库检索结果**：与问题相关的文档内容

⚠️ **重要**：
- 当用户问"之前聊了什么"、"刚才问了啥"等问题时，**直接从上下文的对话历史中提取答案**
- **不要说"无法查看对话历史"**，对话历史已经在上下文中提供了
- 优先使用上下文中的信息，只有上下文不够时才调用工具

## 可用工具
1. search_knowledge - 混合检索（向量+关键词融合）
2. deep_search - 深度混合检索（更多结果）
3. keyword_search - 关键词精确搜索（适合专有名词、文件名）
4. graph_search - 知识图谱检索（基于实体关系，适合复杂问题）
5. summarize_topic - 获取文档原文（用于总结）
6. web_search - 网络搜索（仅当知识库没有时使用）
7. get_current_datetime - 获取当前日期时间
8. fetch_webpage - 网页抓取
9. generate_diagram - 生成可视化图表

## 工具选择策略

**先看上下文，再决定是否调用工具：**
- 如果上下文中已有答案 → 直接回答，不需要调用工具
- 如果上下文不够 → 选择合适的工具补充信息

**工具使用场景：**
- 关系查询（谁是谁的上级等） → graph_search
- 文档总结 → summarize_topic
- 精确查找（文件名、代码） → keyword_search
- 语义查询 → search_knowledge
- 画图 → 先 deep_search 获取信息，再 generate_diagram
- 实时信息（天气、新闻等） → web_search
- 时间查询 → get_current_datetime

## ⚠️ 重要规则
1. **必须用中文回答**
2. **优先使用上下文中的信息**，不要忽略已提供的对话历史和检索结果
3. 如果无法回答，请说"抱歉，我无法回答这个问题，请尝试其他问法或上传相关文档"
4. 回答要详细、有条理
5. 使用 web_search 时请说明信息来源
`;

/**
 * 普通 RAG 查询
 */
export async function query(
  knowledgeBaseId: string, 
  question: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<any> {
  configureLLM();
  console.log(`[LLM] Query: "${question}" in KB ${knowledgeBaseId}`);
  console.log(`[LLM] Chat history: ${chatHistory.length} messages`);
  const startTime = Date.now();
  
  console.log(`[LLM] Loading index...`);
  const t1 = Date.now();
  const index = await loadIndex(knowledgeBaseId);
  console.log(`[LLM] Index loaded in ${Date.now() - t1}ms`);
  
  console.log(`[LLM] Creating query engine with topK=2...`);
  const t2 = Date.now();
  const queryEngine = index.asQueryEngine({
    similarityTopK: 2,
  });
  console.log(`[LLM] Query engine created in ${Date.now() - t2}ms`);

  // 处理对话历史
  let queryWithContext = question;
  if (chatHistory.length > 0) {
    const historyContext = chatHistory
      .slice(-6)
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
 * Agentic RAG 查询
 */
export async function agenticQuery(
  knowledgeBaseId: string, 
  question: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  sessionId?: string,
): Promise<AgentQueryResult> {
  configureLLM();
  console.log(`[LLM] Agentic Query: "${question}" in KB ${knowledgeBaseId}`);
  console.log(`[LLM] Chat history: ${chatHistory.length} messages`);
  const startTime = Date.now();

  // ========== 第一步：意图判断 ==========
  console.log(`[LLM 意图] ════════════════════════════════════════════════════════`);
  console.log(`[LLM 意图] 🎯 Step 1: Intent Analysis...`);
  
  const intentResult = await analyzeIntent(question, chatHistory);
  console.log(`[LLM 意图] 🎯 Intent: ${intentResult.intent}`);
  console.log(`[LLM 意图] 🎯 Needs KB: ${intentResult.needsKnowledgeBase}`);
  console.log(`[LLM 意图] 🎯 Keywords: ${intentResult.keywords.join(', ')}`);
  console.log(`[LLM 意图] 🎯 Suggested Tool: ${intentResult.suggestedTool || 'none'}`);
  
  // 如果是闲聊/问候，使用上下文工程但跳过 Agent
  if (shouldSkipAgent(intentResult.intent)) {
    console.log(`[LLM] 🎯 Direct response for ${intentResult.intent}, using ContextEngine but skipping Agent`);
    
    // 使用完整的上下文工程
    const contextEngine = getContextEngine();
    let contextResult: Awaited<ReturnType<typeof contextEngine.buildContext>> | null = null;
    
    try {
      contextResult = await contextEngine.buildContext({
        knowledgeBaseId,
        sessionId: sessionId || 'default',
        userId: 'default',
        query: question,
        chatHistory,
        maxTokens: 1500,  // 闲聊用中等预算（记忆+历史摘要，少量RAG）
        intent: intentResult,
      });
      console.log(`[LLM] 🎯 Context built: ${contextResult.memories.length} memories, ${contextResult.ragResults.length} RAG, tokens: ${contextResult.stats.totalTokens}`);
    } catch (error) {
      console.log(`[LLM] 🎯 Context build failed, using default response`);
    }
    
    // 提取上下文用于个性化回复
    const fullContext = contextResult?.context || '';
    const memoryContext = contextResult?.memories.map(m => m.content).join('; ') || '';
    
    const directResponse = await generateDirectResponse(question, intentResult.intent, chatHistory, memoryContext, fullContext);
    
    // 异步提取记忆
    contextEngine.processConversationEnd(knowledgeBaseId, question, directResponse)
      .catch(err => console.error('[LLM] Memory extraction failed:', err));
    
    return {
      answer: directResponse,
      thinking: [`🎯 意图识别: ${intentResult.intent}，上下文工程 → 直接回复`],
      sourceNodes: contextResult?.ragResults.map(r => ({
        text: r.content,
        score: r.score,
        type: r.source,
        documentName: r.documentName,
      })) || [],
      isAgentic: true,
    };
  }
  
  console.log(`[LLM] ════════════════════════════════════════════════════════`);

  // ========== 第二步：上下文引擎构建智能上下文 ==========
  const contextEngine = getContextEngine();
  let contextResult: Awaited<ReturnType<typeof contextEngine.buildContext>> | null = null;
  let useContextEngine = false;
  
  console.log(`[LLM] 🧠 Building intelligent context...`);
  try {
    contextResult = await contextEngine.buildContext({
      knowledgeBaseId,
      sessionId: sessionId || 'default',
      userId: 'default',
      query: question,
      chatHistory,
      maxTokens: 3000,
      intent: intentResult,  // 传入意图，避免重复分析
    });
    console.log(`[LLM] 🧠 Context built: ${contextResult.memories.length} memories, ${contextResult.ragResults.length} RAG results`);
    console.log(`[LLM] 🧠 Token usage: ${contextResult.stats.totalTokens}/${contextResult.stats.budgetTokens} (${(contextResult.stats.usageRatio * 100).toFixed(1)}%)`);
    // 🔥 ContextEngine 成功执行就用它，不管有没有结果
    // 0 条结果也是有效结果（说明没有相关内容），不应该回退到无过滤的预检索
    useContextEngine = true;
  } catch (error) {
    console.error(`[LLM] 🧠 Context build failed, falling back to legacy search:`, error);
  }

  // 加载索引
  console.log(`[LLM] Loading index for agent...`);
  const index = await loadIndex(knowledgeBaseId);

  // 创建工具上下文和工具
  const toolContext = createToolContext(index, knowledgeBaseId);
  let tools = createAllTools(toolContext);
  
  // ========== 自适应上下文管理 ==========
  let adaptiveManager: ReturnType<typeof createAdaptiveContextManager> | null = null;
  let contextAwareToolContext: ContextAwareToolContext | null = null;
  
  if (contextResult) {
    console.log(`[LLM] 🔄 Enabling adaptive context for complex knowledge/code explanation...`);
    
    // 创建自适应上下文管理器
    adaptiveManager = createAdaptiveContextManager({
      initialContext: contextResult,
      knowledgeBaseId,
      sessionId: sessionId || 'default',
      query: question,
      intent: intentResult,
      chatHistory,
      conditions: {
        afterToolCalls: 3,        // 每 3 次工具调用后检查
        tokenThreshold: 2500,     // token 超过 2500 时更新
        onFollowUpDetected: true, // 追问时更新
        onNewEntityDiscovered: true, // 发现新实体时更新
      },
    });
    
    // 创建上下文感知工具上下文
    contextAwareToolContext = createContextAwareToolContext(
      adaptiveManager,
      contextResult.context,
      true  // 启用自适应
    );
    
    // 包装所有工具，添加上下文感知能力
    tools = wrapAllTools(tools, contextAwareToolContext);
    console.log(`[LLM] 🔄 Tools wrapped with context-awareness`);
  }
  
  console.log(`[LLM 工具生成] Creating ReAct Agent with ${tools.length} tools...`);

  // ========== 初始化执行链路 ==========
  const trace: ExecutionTrace = {
    question,
    intent: {
      type: intentResult.intent,
      description: intentTypes[intentResult.intent as keyof typeof intentTypes] || '未知',
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

  // ========== 预检索知识库（仅当上下文引擎未成功时）==========
  let knowledgeContext = '';
  
  if (useContextEngine) {
    // 上下文引擎已成功，使用其 RAG 结果
    console.log(`[LLM] 📚 Using ContextEngine results, skipping legacy search`);
    trace.preSearch.executed = true;
    trace.preSearch.query = question;
    
    // 将上下文引擎的结果保存到工具上下文
    if (contextResult && contextResult.ragResults.length > 0) {
      toolContext.searchResults.push(...contextResult.ragResults.map(r => ({
        id: r.id,
        documentId: r.metadata?.documentId,
        documentName: r.documentName,
        content: r.content,
        score: r.score,
        source: r.source as 'vector' | 'keyword' | 'both',
      })));
      
      contextResult.ragResults.forEach((r, i) => {
        trace.preSearch.results.push({
          docName: r.documentName,
          preview: r.content.substring(0, 200),
          score: r.score,
        });
      });
    }
  } else if (intentResult.needsKnowledgeBase) {
    // 回退：使用原有的预检索逻辑
    console.log(`[LLM] ───────────────────正在预检索知识库（回退模式）─────────────────────────────────────`);
    console.log(`[LLM 预检索] 📚 Pre-fetching from knowledge base...`);
    
    const searchQuery = intentResult.keywords.length > 0 
      ? intentResult.keywords.join(' ') + ' ' + question
      : question;
    console.log(`[LLM 预检索] 📚 Search query: "${searchQuery}"`);
    
    trace.preSearch.executed = true;
    trace.preSearch.query = searchQuery;
    
    const results = await hybridSearch(index, knowledgeBaseId, searchQuery, {
      vectorTopK: 5,
      keywordLimit: 5,
    });
    
    if (results && results.length > 0) {
      // 保存到工具上下文
      toolContext.searchResults.push(...results);
      
      console.log(`[LLM] 📚 Found ${results.length} 相关文档 (预检索结果)`);
      const sources = results.map((result: any, i: number) => {
        const text = result.content || '';
        const docName = result.documentName || '未知文档';
        const score = parseFloat(result.score?.toFixed(3) || '0');
        console.log(`[LLM 预检索] 📚   [${i + 1}] ${docName} (score: ${score})`);
        console.log(`[LLM 预检索] 📚       ${text.substring(0, 100).replace(/\n/g, ' ')}...`);
        
        trace.preSearch.results.push({
          docName,
          preview: text.substring(0, 200),
          score,
        });
        
        return `[来源${i + 1}: ${docName}]\n${text.substring(0, 500)}`;
      });
      knowledgeContext = sources.join('\n\n');
    } else {
      console.log(`[LLM 预检索] 📚 No relevant documents found in knowledge base`);
    }
    console.log(`[LLM 预检索] ────────────────────────────────────────────────────────`);
  } else {
    console.log(`[LLM] 📚 Skipping pre-fetch (intent: ${intentResult.intent})`);
  }

  // 构建背景知识增强问题
  let enrichedQuestion = '';
  const hasKnowledgeContent = useContextEngine 
    ? (contextResult && (contextResult.ragResults.length > 0 || contextResult.memories.length > 0))
    : !!knowledgeContext;
  
  // 🔥 添加上下文说明，让 Agent 理解消息结构
  enrichedQuestion += `【以下是系统提供的上下文信息】\n\n`;
  
  // 添加上下文内容（对话历史 + 记忆 + RAG，由 ContextEngine 统一管理）
  if (useContextEngine && contextResult?.context) {
    enrichedQuestion += `${contextResult.context}\n\n`;
  } else if (knowledgeContext) {
    // 回退：使用原有的预检索结果
    enrichedQuestion += `## 知识库检索结果\n${knowledgeContext}\n\n`;
  } else {
    enrichedQuestion += `（当前没有相关的知识库内容或对话历史）\n\n`;
  }
  
  enrichedQuestion += `【上下文信息结束】\n\n`;
  
  // 添加意图分析提示
  if (intentResult.suggestedTool) {
    enrichedQuestion += `## 意图分析：\n- 用户意图: ${intentResult.intent}\n- 建议使用工具: ${intentResult.suggestedTool}\n- 关键词: ${intentResult.keywords.join(', ') || '无'}\n\n`;
  }
  
  enrichedQuestion += `## 当前问题：\n${question}\n\n`;
  
  // 画图请求特殊提示
  if (intentResult.intent === 'draw_diagram') {
    enrichedQuestion += `⚠️ 【画图请求特别说明】：
1. 上面的预检索内容只是概述，不够详细
2. 你【必须】先调用 deep_search 或 summarize_topic 获取更详细的信息
3. 然后将详细内容作为 description 传给 generate_diagram
4. 图表要尽可能详细，包含所有步骤、时间点、注意事项等

`;
  }
  
  // 🔥 网络搜索请求特殊提示
  if (intentResult.intent === 'web_search' || intentResult.suggestedTool === 'web_search') {
    enrichedQuestion += `⚠️ 【网络搜索请求】：
这个问题需要调用 web_search 工具获取实时信息。
请【必须】使用 web_search 工具搜索相关内容，然后基于搜索结果回答。

`;
  }
  
  // 🔥 时间查询特殊提示
  if (intentResult.intent === 'datetime') {
    enrichedQuestion += `⚠️ 【时间查询】：
请调用 get_current_datetime 工具获取当前时间。

`;
  }
  
  
  // 添加回答指引（意图优先于知识库内容）
  if (intentResult.intent === 'web_search') {
    // 🔥 网络搜索意图：即使有知识库内容，也应该调用 web_search
    enrichedQuestion += `请调用 web_search 工具获取实时信息后用中文回答。`;
  } else if (intentResult.intent === 'datetime') {
    // 🔥 时间查询意图：调用时间工具
    enrichedQuestion += `请调用 get_current_datetime 工具获取时间后用中文回答。`;
  } else if (hasKnowledgeContent) {
    // 有知识库内容：基于知识库回答
    enrichedQuestion += `请基于上述知识库内容用中文回答问题。必须使用知识库内容，不要编造信息。如果你觉得信息不够可以调用相应工具获取。`;
  } else {
    // 没有知识库内容：直接回答或调用工具
    enrichedQuestion += `请用中文回答问题。如果需要更多信息，请调用相应工具获取。`;
  }
  
  // 转换对话历史（使用智能摘要后的历史，或回退到简单截取）
  const llamaHistory = chatHistory.slice(-6).map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  // 创建 Agent
  const agent = new ReActAgent({
    tools,
    systemPrompt: SYSTEM_PROMPT,
    chatHistory: llamaHistory,
    verbose: true,
  });

  // ========== 打印传给 Agent 的完整上下文 ==========
  console.log(`[LLM Agentic] ════════════════════════════════════════════════════════`);
  console.log(`[LLM Agentic] 📝 CONTEXT SENT TO AGENT:`);
  console.log(`[LLM Agentic] ────────────────────────────────────────────────────────`);
  // 打印完整上下文（限制长度避免日志过长）
  const contextPreview = enrichedQuestion.length > 2000 
    ? enrichedQuestion.substring(0, 2000) + `\n... (truncated, total ${enrichedQuestion.length} chars)`
    : enrichedQuestion;
  console.log(contextPreview);
  console.log(`[LLM Agentic] ────────────────────────────────────────────────────────`);
  console.log(`[LLM Agentic] 📊 Context stats: ${enrichedQuestion.length} chars, ~${Math.ceil(enrichedQuestion.length / 3)} tokens`);
  console.log(`[LLM Agentic] ════════════════════════════════════════════════════════`);

  // 执行查询
  console.log(`[LLM Agentic] thinking and executing...`);
  const response = await agent.chat({ message: enrichedQuestion });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[LLM Agentic] ════════════════════════════════════════════════════════`);
  console.log(`[LLM Agentic] ✅ Agentic Query completed in ${totalTime}s`);
  
  // 打印原始输出
  console.log(`[LLM Agentic] ────────────────────────────────────────────────────────`);
  console.log(`[LLM Agentic] 推理过程`);
  console.log(`[LLM Agentic] ${response.response}`);
  console.log(`[LLM Agentic] ────────────────────────────────────────────────────────`);
  
  // 打印检索到的文档
  // if (response.sourceNodes && response.sourceNodes.length > 0) {
  //   console.log(`[LLM Agentic] 📚 Retrieved ${response.sourceNodes.length} source(s):`);
  //   response.sourceNodes.forEach((node: any, i: number) => {
  //     const text = node.node?.text || node.node?.getContent?.() || '';
  //     const preview = text.substring(0, 100).replace(/\n/g, ' ');
  //     console.log(`[LLM Agentic]   [${i + 1}] Score: ${node.score?.toFixed(3) || 'N/A'} | ${preview}...`);
  //   });
  // }

  // 解析输出
  let { thinking, answer, toolCalls: parsedToolCalls } = parseAgentOutput(response.response || '');
  
  // 合并工具调用记录
  const actualToolCalls = getToolCalls(toolContext);
  const toolCalls = actualToolCalls.length > 0 ? actualToolCalls : parsedToolCalls;
  
  trace.toolCalls = toolCalls;
  trace.answer = answer;
  
  console.log(`[LLM Agentic] Thinking length: ${thinking.length}`);
  console.log(`[LLM Agentic] Tool calls: ${toolCalls.length} (actual: ${actualToolCalls.length}, parsed: ${parsedToolCalls.length})`);
  toolCalls.forEach((call, i) => {
    console.log(`[LLM Agentic]   🔧 [${i + 1}] ${call.tool}(${call.input.substring(0, 50)}${call.input.length > 50 ? '...' : ''})`);
    if (call.output) {
      console.log(`[LLM Agentic]       → ${call.output.substring(0, 80)}${call.output.length > 80 ? '...' : ''}`);
    }
  });
  console.log(`[LLM Agentic] Final answer: ${answer}`);


  // ========== 格式预检查 ==========
  const preCheck = preCheckFormat(answer, intentResult.intent as IntentType);
  if (preCheck.needsFix && preCheck.fixedAnswer) {
    answer = preCheck.fixedAnswer;
  }

  // ========== 质量评估 ==========
  const evalContext = buildEvaluationContext(
    trace.question,
    intentResult.intent as IntentType,
    answer,
    trace.toolCalls.map(c => c.tool),
    trace.preSearch.executed,
    trace.preSearch.results.length
  );
  
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let qualityPassed = false;
  let lastIssue = '';
  
  while (!qualityPassed && retryCount < MAX_RETRIES) {
    console.log(`[LLM] 📊 Quality check (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
    const evalResult = await evaluateQuality(answer, evalContext);
    
    if (evalResult.pass) {
      console.log(`[LLM] 📊 Quality: ✅ PASS`);
      qualityPassed = true;
    } else {
      lastIssue = evalResult.reason;
      console.log(`[LLM] 📊 Quality: ❌ FAIL - ${lastIssue}`);
      
      retryCount++;
      if (retryCount < MAX_RETRIES) {
        console.log(`[LLM] 📊 Retrying (${retryCount}/${MAX_RETRIES})...`);
        
        const retryMessage = `请改进你的回答。

【问题】${lastIssue}

【原始用户问题】${question}

【已知信息】
${knowledgeContext || '无预检索内容'}

请重新生成，特别注意逻辑顺序：前置准备→核心步骤→后续处理。
注意：请直接基于已有信息回答，不要调用网络搜索工具。`;
        
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
            break;
          }
        } catch (retryError: any) {
          console.log(`[LLM] 📊 Retry error: ${retryError.message}, keeping previous answer`);
          break;
        }
      }
    }
  }
  
  if (!qualityPassed) {
    console.log(`[LLM] 📊 Max retries reached, using last answer`);
  }
  
  // 兜底：长度足够也通过
  if (!qualityPassed && answer.length > 100) {
    console.log(`[LLM] 📊 Fallback pass: answer length ${answer.length} > 100`);
    qualityPassed = true;
  }

  // ========== 最终校验 ==========
  const finalAnswer = finalValidation(answer, intentResult.intent as IntentType);

  // 构建 sourceNodes
  const searchResults = getSearchResults(toolContext);
  let sourceNodes: AgentQueryResult['sourceNodes'] = [];
  
  if (searchResults && searchResults.length > 0) {
    sourceNodes = searchResults.map((result: any) => ({
      text: result.content || '',
      score: result.score,
      type: result.source || 'hybrid',
      documentName: result.documentName,
    }));
  } else if (response.sourceNodes) {
    sourceNodes = response.sourceNodes.map((node: any) => ({
      text: node.node?.text || node.node?.getContent?.() || '',
      score: node.score,
      type: 'vector',
      metadata: node.node?.metadata,
    }));
  }
  
  // ========== 自适应上下文统计 ==========
  if (adaptiveManager) {
    const adaptiveStats = adaptiveManager.getStats();
    console.log(`[LLM] 🔄 Adaptive context stats:`);
    console.log(`[LLM]    - Tool calls: ${adaptiveStats.toolCallCount}`);
    console.log(`[LLM]    - Context updates: ${adaptiveStats.updateCount}`);
    console.log(`[LLM]    - Discovered entities: ${adaptiveStats.discoveredEntities}`);
    console.log(`[LLM]    - Final tokens: ${adaptiveStats.currentTokens}`);
  }
  
  // ========== 记忆提取（异步，不阻塞返回）==========
  contextEngine.processConversationEnd(knowledgeBaseId, question, finalAnswer)
    .catch(err => console.error('[LLM] Memory extraction failed:', err));
  
  return {
    answer: finalAnswer,
    thinking,
    sourceNodes,
    retrievedContent: knowledgeContext || contextAwareToolContext?.enhancedContext || contextResult?.context || '',
    toolCalls: trace.toolCalls,
    isAgentic: true,
  };
}

