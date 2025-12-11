/**
 * ReAct Agent 核心模块
 * 实现 Agentic RAG 查询逻辑
 */
import { ReActAgent, Settings } from 'llamaindex';
import { configureLLM } from './config';
import { loadIndex } from './index-manager';
import { parseAgentOutput, fixMermaidFormat, type ToolCall } from './output-parser';
import { analyzeIntent, generateDirectResponse, shouldSkipAgent, intentTypes, type IntentType } from './intent-analyzer';
import { createToolContext, createAllTools, getToolCalls, getSearchResults } from './tools';
import { hybridSearch, formatSearchResults } from '../hybrid-search';
import { 
  preCheckFormat, 
  evaluateQuality, 
  buildEvaluationContext, 
  finalValidation 
} from './quality-evaluator';

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

## 可用工具
1. search_knowledge - 混合检索（向量+关键词融合）
2. deep_search - 深度混合检索（更多结果）
3. keyword_search - 关键词精确搜索（适合专有名词、文件名）
4. graph_search - 🆕 知识图谱检索（基于实体关系，适合复杂问题）
5. summarize_topic - 获取文档原文（用于总结）
6. web_search - 网络搜索（仅当知识库没有时使用）
7. get_current_datetime - 获取当前日期时间
8. fetch_webpage - 网页抓取
9. generate_diagram - 生成可视化图表

## 意图判断与工具选择

**关系查询（推荐使用 graph_search）：**
- "谁是xxx的上级" / "A和B有什么关系" / "xxx负责什么" → 使用 graph_search（mode: local）
- 涉及人物、组织、事件之间关系的问题，优先使用 graph_search

**文档/书籍总结类问题：**
- "xxx讲了什么" / "总结一下xxx" → 使用 summarize_topic 获取原文，或使用 graph_search（mode: global）

**精确查找（文件名、代码、专有名词）：**
- "找到 xxx.pdf" / "搜索 function_name" → 使用 keyword_search

**语义查询（概念、定义）：**
- "什么是xxx" / "如何做xxx" → 使用 search_knowledge 或 graph_search

**画图请求（重要！）：**
- "画个xxx图" / "流程图" / "时间安排" → 【必须】先调用 deep_search 或 summarize_topic 获取详细信息，再调用 generate_diagram
- ⚠️ 即使已有预检索内容，也必须调用工具获取更完整的信息
- 图表要尽可能详细，包含所有步骤和细节

**网络搜索（最后手段）：**
- 只有当问题明显与知识库无关时才使用 web_search

## ⚠️ 重要规则
1. **必须用中文回答，包括无法回答时也必须用中文**
2. **禁止使用任何英文回复**，包括 "Sorry, I cannot answer" 这类
3. **如果无法回答，请说"抱歉，我无法回答这个问题，请尝试其他问法或上传相关文档"**
4. **优先使用知识库工具**，禁止跳过检索直接回答
5. **涉及实体或者关系的问题，优先使用 graph_search**
6. 回答要详细、有条理，基于知识库内容
7. **画图前必须调用 deep_search 或 summarize_topic** 获取信息
8. 如果使用了web_search工具，请在回答中说明是使用了web_search工具获取的信息
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
  
  // 如果是闲聊/问候，直接回复
  if (shouldSkipAgent(intentResult.intent)) {
    console.log(`[LLM] 🎯 Direct response for ${intentResult.intent}, skipping Agent`);
    const directResponse = await generateDirectResponse(question, intentResult.intent, chatHistory);
    return {
      answer: directResponse,
      thinking: [`🎯 意图识别: ${intentResult.intent}，直接回复`],
      sourceNodes: [],
      isAgentic: true,
    };
  }
  
  console.log(`[LLM] ════════════════════════════════════════════════════════`);

  // 加载索引
  console.log(`[LLM] Loading index for agent...`);
  const index = await loadIndex(knowledgeBaseId);

  // 创建工具上下文和工具
  const toolContext = createToolContext(index, knowledgeBaseId);
  const tools = createAllTools(toolContext);
  
  console.log(`[LLM 工具生成] Creating ReAct Agent with 9 tools...`);

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

  // ========== 预检索知识库 ==========
  console.log(`[LLM] ───────────────────正在预检索知识库─────────────────────────────────────`);
  let knowledgeContext = '';
  
  if (intentResult.needsKnowledgeBase) {
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
  } else {
    console.log(`[LLM 预检索] 📚 Skipping pre-fetch (intent: ${intentResult.intent})`);
  }
  console.log(`[LLM 预检索] ────────────────────────────────────────────────────────`);

  // 构建背景知识增强问题
  let enrichedQuestion = question;
  
  if (knowledgeContext) {
    enrichedQuestion = `## 知识库检索结果（必须基于以下内容回答）：\n${knowledgeContext}\n\n`;
  }
  
  if (intentResult.suggestedTool) {
    enrichedQuestion += `## 意图分析：\n- 用户意图: ${intentResult.intent}\n- 建议使用工具: ${intentResult.suggestedTool}\n- 关键词: ${intentResult.keywords.join(', ') || '无'}\n\n`;
  }
  
  enrichedQuestion += `## 用户问题：\n${question}\n\n`;
  
  // 画图请求特殊提示
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
  
  // 转换对话历史
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
  
  return {
    answer: finalAnswer,
    thinking,
    sourceNodes,
    retrievedContent: knowledgeContext || '',
    toolCalls: trace.toolCalls,
    isAgentic: true,
  };
}

