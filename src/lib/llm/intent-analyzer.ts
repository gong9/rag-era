/**
 * 意图分析模块
 * 负责分析用户问题的意图，决定使用什么工具和策略
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
  draw_diagram: '画图/生成流程图',
  web_search: '网络搜索',
  datetime: '日期时间查询',
} as const;

export type IntentType = keyof typeof intentTypes;

/**
 * 意图分析结果
 */
export interface IntentResult {
  intent: IntentType;
  needsKnowledgeBase: boolean;
  keywords: string[];
  suggestedTool: string | null;
}

/**
 * 分析用户意图
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
 * @param question 用户问题
 * @param intent 意图类型
 * @param chatHistory 对话历史（可选，用于生成更自然的回复）
 */
export async function generateDirectResponse(
  question: string, 
  intent: IntentType,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<string> {
  const llm = Settings.llm;
  
  // 构建最近对话上下文（最多 2 轮）
  const recentHistory = chatHistory.slice(-4);
  let contextStr = '';
  if (recentHistory.length > 0) {
    contextStr = '【最近对话】\n' + recentHistory.map(m => 
      `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}`
    ).join('\n') + '\n\n';
  }
  
  const responsePrompt = intent === 'greeting'
    ? `${contextStr}用户说: "${question}"
请用友好的中文回复问候。${recentHistory.length === 0 ? '这是首次对话，请简单介绍你是一个智能知识库助手，可以帮用户查询知识库内容、总结文档、画流程图等。' : '这是继续对话，不需要再次自我介绍，简单回复即可。'}回复要简洁自然。`
    : `${contextStr}用户说: "${question}"
请用友好的中文回复，保持简洁自然。${recentHistory.length > 0 ? '可以根据之前的对话内容给出更贴切的回复。' : ''}你是一个智能知识库助手。`;

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

