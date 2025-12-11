/**
 * 意图分析模块
 * 上下文工程的核心组件，决定后续的检索和优化策略
 */
import { Settings } from 'llamaindex';

/**
 * 意图类型
 */
export const intentTypes = {
  greeting: '问候/打招呼',
  small_talk: '闲聊',
  document_summary: '文档/书籍总结',
  knowledge_query: '知识库查询',
  comparison: '对比分析',
  draw_diagram: '画图/生成流程图',
  web_search: '网络搜索',
  datetime: '日期时间查询',
  instruction: '指令执行',
} as const;

export type IntentType = keyof typeof intentTypes;

/**
 * 意图分析结果
 */
export interface IntentResult {
  intent: IntentType;
  needsKnowledgeBase: boolean;
  needsMemory: boolean;
  keywords: string[];
  suggestedTool: string | null;
  confidence: number;
}

/**
 * 分析用户意图（LLM 版本）
 */
export async function analyzeIntent(
  question: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<IntentResult> {
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
- comparison: 对比分析（"A和B的区别"、"对比xxx"）
- draw_diagram: 画图请求（"画个图"、"生成流程图"、"画架构图"、"重新生成"等）
- web_search: 需要实时网络信息（天气、新闻、最新消息）
- datetime: 日期时间查询（今天几号、现在几点）
- instruction: 执行指令（"帮我写"、"生成"、"创建"）

【重要】意图判断规则：
1. 如果用户追问/抱怨上一轮的回答（如"重新生成"、"不对"、"你这啥"），意图应该和上一轮一样
2. 如果上一轮是画图，用户说"重新画"、"再详细点"，意图仍然是 draw_diagram
3. 只有纯粹的客套话才是 small_talk，带有任务要求的不是
4. needsKnowledgeBase: 只有 greeting、small_talk、datetime 不需要，其他都需要
5. needsMemory: 多轮对话、个性化问题需要，单次简单问答不需要

输出 JSON 格式（不要其他内容）：
{"intent": "意图类型", "needsKnowledgeBase": true/false, "needsMemory": true/false, "keywords": ["关键词"], "suggestedTool": "建议工具或null", "confidence": 0.8}

示例：
问题: "Agents_v8.pdf 讲了什么"
输出: {"intent": "document_summary", "needsKnowledgeBase": true, "needsMemory": false, "keywords": ["Agents_v8"], "suggestedTool": "summarize_topic", "confidence": 0.9}

问题: "你好"
输出: {"intent": "greeting", "needsKnowledgeBase": false, "needsMemory": false, "keywords": [], "suggestedTool": null, "confidence": 0.95}

问题: "画一个体检的流程图"
输出: {"intent": "draw_diagram", "needsKnowledgeBase": true, "needsMemory": false, "keywords": ["体检", "流程"], "suggestedTool": "generate_diagram", "confidence": 0.9}

问题: "你还记得我之前说的偏好吗"
输出: {"intent": "knowledge_query", "needsKnowledgeBase": false, "needsMemory": true, "keywords": ["偏好"], "suggestedTool": null, "confidence": 0.85}`;

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
        needsMemory: result.needsMemory === true,
        keywords: result.keywords || [],
        suggestedTool: result.suggestedTool || null,
        confidence: result.confidence || 0.8,
      };
    }
  } catch (error) {
    console.log(`[Intent] Analysis error: ${error}`);
  }
  
  // 默认返回知识库查询
  return {
    intent: 'knowledge_query',
    needsKnowledgeBase: true,
    needsMemory: false,
    keywords: [],
    suggestedTool: null,
    confidence: 0.5,
  };
}

/**
 * 快速意图检测（规则版本，不调用 LLM）
 * 用于不需要高精度的场景
 */
export function detectIntentFast(query: string): IntentResult {
  const lowerQuery = query.toLowerCase();
  
  // 问候
  if (/^(你好|hi|hello|嗨|早上好|晚上好|下午好)/i.test(query)) {
    return {
      intent: 'greeting',
      needsKnowledgeBase: false,
      needsMemory: false,
      keywords: [],
      suggestedTool: null,
      confidence: 0.9,
    };
  }
  
  // 闲聊
  if (/^(谢谢|感谢|好的|明白|知道了|再见|拜拜|好|是|否|对|不对)$/.test(query)) {
    return {
      intent: 'small_talk',
      needsKnowledgeBase: false,
      needsMemory: false,
      keywords: [],
      suggestedTool: null,
      confidence: 0.9,
    };
  }
  
  // 时间
  if (/现在几点|什么时间|今天日期|今天几号/.test(query)) {
    return {
      intent: 'datetime',
      needsKnowledgeBase: false,
      needsMemory: false,
      keywords: [],
      suggestedTool: 'get_current_datetime',
      confidence: 0.95,
    };
  }
  
  // 画图
  if (/画|流程图|架构图|图表|mermaid/i.test(query)) {
    return {
      intent: 'draw_diagram',
      needsKnowledgeBase: true,
      needsMemory: false,
      keywords: extractKeywords(query),
      suggestedTool: 'generate_diagram',
      confidence: 0.85,
    };
  }
  
  // 总结
  if (/总结|概述|讲了什么|主要内容|介绍/.test(query)) {
    return {
      intent: 'document_summary',
      needsKnowledgeBase: true,
      needsMemory: false,
      keywords: extractKeywords(query),
      suggestedTool: 'summarize_topic',
      confidence: 0.85,
    };
  }
  
  // 对比
  if (/对比|区别|不同|相同|比较|vs/i.test(query)) {
    return {
      intent: 'comparison',
      needsKnowledgeBase: true,
      needsMemory: false,
      keywords: extractKeywords(query),
      suggestedTool: null,
      confidence: 0.8,
    };
  }
  
  // 默认：知识库查询
  return {
    intent: 'knowledge_query',
    needsKnowledgeBase: true,
    needsMemory: query.includes('之前') || query.includes('记得'),
    keywords: extractKeywords(query),
    suggestedTool: null,
    confidence: 0.6,
  };
}

/**
 * 提取关键词
 */
function extractKeywords(query: string): string[] {
  // 移除常见停用词
  const stopWords = ['的', '是', '在', '了', '和', '与', '或', '这', '那', '个', '什么', '如何', '怎么'];
  const words = query.split(/[\s,，。！？、]+/).filter(w => 
    w.length >= 2 && !stopWords.includes(w)
  );
  return words.slice(0, 5);
}

/**
 * 生成直接回复（用于闲聊/问候）
 * @param question 用户问题
 * @param intent 意图类型
 * @param chatHistory 对话历史
 * @param memoryContext 记忆上下文（可选，用于个性化回复）
 * @param fullContext 完整上下文（可选，来自上下文引擎）
 */
export async function generateDirectResponse(
  question: string, 
  intent: IntentType,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  memoryContext?: string,
  fullContext?: string
): Promise<string> {
  const llm = Settings.llm;
  
  // 如果有完整上下文，直接使用（已包含记忆+历史摘要）
  let contextBlock = '';
  if (fullContext) {
    contextBlock = `【上下文信息】\n${fullContext}\n\n`;
  } else {
    // 回退：构建简单上下文
    const recentHistory = chatHistory.slice(-4);
    if (recentHistory.length > 0) {
      contextBlock += '【最近对话】\n' + recentHistory.map(m => 
        `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}`
      ).join('\n') + '\n\n';
    }
    if (memoryContext) {
      contextBlock += `【用户记忆】\n${memoryContext}\n\n`;
    }
  }
  
  const hasContext = !!fullContext || !!memoryContext || chatHistory.length > 0;
  
  const responsePrompt = intent === 'greeting'
    ? `${contextBlock}用户说: "${question}"

请用友好的中文回复问候。
${hasContext ? '- 根据上下文信息进行个性化回复' : ''}
${!hasContext ? '- 这是首次对话，请简单介绍你是一个智能知识库助手，可以帮用户查询知识库内容、总结文档、画流程图等' : ''}
- 回复要简洁自然，不要生硬`
    : `${contextBlock}用户说: "${question}"

请用友好的中文回复。
${hasContext ? '- 根据上下文信息给出更贴切的回复' : ''}
- 保持简洁自然
- 你是一个智能知识库助手`;

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
 * 判断意图是否需要跳过 Agent（直接回复）
 */
export function shouldSkipAgent(intent: IntentType): boolean {
  return intent === 'greeting' || intent === 'small_talk';
}

/**
 * 根据意图获取上下文权重配置
 */
export function getContextWeights(intent: IntentType): {
  memory: number;
  rag: number;
  history: number;
  tool: number;
} {
  const weights: Record<IntentType, { memory: number; rag: number; history: number; tool: number }> = {
    greeting: { memory: 0.5, rag: 0, history: 0.8, tool: 0 },
    small_talk: { memory: 0.5, rag: 0, history: 1.0, tool: 0 },
    document_summary: { memory: 0.3, rag: 1.5, history: 0.2, tool: 0.5 },
    knowledge_query: { memory: 0.8, rag: 1.2, history: 0.5, tool: 0.6 },
    comparison: { memory: 0.6, rag: 1.3, history: 0.4, tool: 0.5 },
    draw_diagram: { memory: 0.4, rag: 1.0, history: 0.3, tool: 1.2 },
    web_search: { memory: 0.3, rag: 0.3, history: 0.2, tool: 1.5 },
    datetime: { memory: 0, rag: 0, history: 0, tool: 1.0 },
    instruction: { memory: 1.0, rag: 0.8, history: 0.6, tool: 1.0 },
  };
  
  return weights[intent] || weights.knowledge_query;
}

