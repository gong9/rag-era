/**
 * RAG 评估 - 四维度 LLM Judge
 * 
 * 1. Retrieval Judge: 检索内容与问题的相关性
 * 2. Faithfulness Judge: 回答是否基于检索内容
 * 3. Quality Judge: 答案的正确性、完整性、清晰度
 * 4. Tool Judge: 工具调用的合理性（Agentic RAG 特有）
 */

import { Settings } from 'llamaindex';
import { OpenAI } from '@llamaindex/openai';

// Judge 评分结果
export interface JudgeResult {
  score: number;  // 0-5
  reason: string; // 评分理由
}

// 完整评估结果
export interface EvalScores {
  retrieval: JudgeResult;
  faithfulness: JudgeResult;
  quality: JudgeResult;
  tool: JudgeResult;
  average: number;
}

// 评估输入
export interface EvalInput {
  question: string;
  answer: string;
  retrievedContent: string;
  toolsCalled: string[];
  expectedTools?: string[];
  expectedIntent?: string;
}

/**
 * 确保 LLM 已配置
 */
function ensureLLMConfigured(): void {
  if (!Settings.llm) {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = process.env.OPENAI_MODEL || 'qwen-turbo';

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    Settings.llm = new OpenAI({
      apiKey,
      model,
      baseURL,
    });
  }
}

/**
 * 解析 LLM 返回的 JSON 评分
 */
function parseJudgeResponse(text: string): JudgeResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        score: Math.min(5, Math.max(0, parseFloat(result.score) || 0)),
        reason: result.reason || '无评分理由',
      };
    }
  } catch (e) {
    console.error('[EvalJudge] Parse error:', e);
  }
  return { score: 0, reason: '解析评分失败' };
}

/**
 * 1. Retrieval Judge - 检索相关性评估
 * 评估检索到的内容是否与用户问题相关
 */
export async function judgeRetrieval(
  question: string,
  retrievedContent: string,
  toolsCalled: string[] = []
): Promise<JudgeResult> {
  ensureLLMConfigured();
  const llm = Settings.llm;

  // 检查是否有检索内容
  const hasContent = retrievedContent && retrievedContent.trim().length > 0;
  const contentDisplay = hasContent 
    ? retrievedContent.substring(0, 3000) + (retrievedContent.length > 3000 ? '...(截断)' : '')
    : '【空】没有检索到任何内容';

  // 检查是否使用了不需要知识库检索的工具（注意：generate_diagram 需要检索内容作为素材）
  const nonRetrievalTools = ['get_current_datetime', 'web_search', 'fetch_webpage'];
  const usedNonRetrievalTool = toolsCalled.some(t => nonRetrievalTools.includes(t));
  
  // 检查是否是画图任务
  const isDiagramTask = toolsCalled.includes('generate_diagram');
  
  console.log(`[RetrievalJudge] Question: "${question.substring(0, 30)}...", Tools: [${toolsCalled.join(', ')}], isDiagram: ${isDiagramTask}`);

  const prompt = `你是一个 RAG 系统检索质量评估专家。请评估检索结果与用户问题的相关性。
${isDiagramTask ? `
⚠️ **特别注意：这是一个画图/生成图表任务！**
用户要求生成图表/流程图，系统会使用 generate_diagram 工具把文字转换成图表。
因此，你需要评估的是：检索到的**文字内容**是否包含图表所需的信息（如体检流程、步骤、注意事项等）。
- ✅ 检索到关于"体检"的文字描述（流程、步骤、注意事项） = **高分（4-5分）**
- ❌ 绝对不要因为"没有检索到现成的流程图"就给低分！
- ❌ 绝对不要说"未提供结构化步骤或图形素材"这样的理由！检索的就是文字素材！
` : ''}
## 用户问题
${question}

## 检索到的内容
${contentDisplay}

## 使用的工具
${toolsCalled.length > 0 ? toolsCalled.join(', ') : '无'}

## 评分标准（0-5分）
- 5分：检索内容高度相关，完全覆盖问题所需信息
- 4分：检索内容相关，覆盖大部分所需信息
- 3分：检索内容部分相关，有一些有用信息
- 2分：检索内容略微相关，但缺少关键信息
- 1分：检索内容几乎不相关
- 0分：完全无关或没有检索到内容

## 重要提示
- **如果检索内容为【空】，必须给 0 分**
- **评估的是文字内容的相关性，不是格式**

## 输出格式（仅输出 JSON）
{"score": 数字, "reason": "一句话评分理由"}`;

  try {
    // 如果使用了 web_search 或 fetch_webpage 工具，信息来源是网络而非知识库
    // 检索质量评估不适用
    const usedWebSearch = toolsCalled.some(t => ['web_search', 'fetch_webpage'].includes(t));
    if (usedWebSearch) {
      return { score: 5, reason: '此问题通过网络搜索获取信息，不依赖知识库检索' };
    }
    
    // 如果使用了 get_current_datetime 工具，不需要知识库检索
    const usedDatetime = toolsCalled.includes('get_current_datetime');
    if (usedDatetime && !hasContent) {
      return { score: 5, reason: '此问题通过系统时间工具获取信息，不需要知识库检索' };
    }
    
    // 如果没有检索内容，且没有使用工具，直接返回 0 分
    if (!hasContent && toolsCalled.length === 0) {
      return { score: 0, reason: '没有检索到任何内容' };
    }

    const response = await llm.complete({ prompt });
    return parseJudgeResponse(response.text);
  } catch (error) {
    console.error('[RetrievalJudge] Error:', error);
    return { score: 0, reason: `评估出错: ${error}` };
  }
}

/**
 * 2. Faithfulness Judge - 忠实度评估
 * 评估回答是否基于检索内容，是否存在幻觉
 */
export async function judgeFaithfulness(
  answer: string,
  retrievedContent: string,
  toolsCalled: string[] = []
): Promise<JudgeResult> {
  ensureLLMConfigured();
  const llm = Settings.llm;

  // 检查是否有检索内容
  const hasContent = retrievedContent && retrievedContent.trim().length > 0;
  const contentDisplay = hasContent 
    ? retrievedContent.substring(0, 3000) + (retrievedContent.length > 3000 ? '...(截断)' : '')
    : '【空】没有检索到任何内容';

  // 检查是否使用了能提供信息的工具
  const infoTools = ['get_current_datetime', 'web_search', 'fetch_webpage'];
  const usedInfoTool = toolsCalled.some(t => infoTools.includes(t));
  
  // 检查是否是画图任务
  const isDiagramTask = toolsCalled.includes('generate_diagram');

  const prompt = `你是一个 RAG 系统忠实度评估专家。请评估 AI 回答是否忠实于信息来源。

## AI 回答
${answer.substring(0, 2000)}${answer.length > 2000 ? '...(截断)' : ''}

## 检索到的内容（作为依据）
${contentDisplay}

## 使用的工具
${toolsCalled.length > 0 ? toolsCalled.join(', ') : '无'}

## 评分标准（0-5分）
- 5分：回答完全基于可验证的信息来源，无任何幻觉
- 4分：回答主要基于信息来源，极少量推理补充
- 3分：回答部分基于信息来源，有一些未支持的陈述
- 2分：回答有较多内容无法验证
- 1分：回答大部分是幻觉
- 0分：完全是幻觉

## 重要提示
- **如果使用了 get_current_datetime 工具**，日期时间信息来自工具返回，不是幻觉
- **如果使用了 web_search/fetch_webpage 工具**，网络信息来自工具返回，不是幻觉
- **评估的是文字内容的来源，不是格式**
- 对检索内容的重新组织、结构化、格式化都不算幻觉

### 【"无法回答"的情况】
如果回答表示"无法回答"/"找不到相关信息"/"Sorry, I cannot answer"等：
- ✅ 检索内容确实与问题不相关 → 回答是**忠实的**（正确识别了无法回答，没有瞎编）→ 给 **4-5 分**
- ❌ 检索内容明明有相关信息，但回答说找不到 → 不忠实 → 给低分
${isDiagramTask ? `
### 【画图任务】
回答是 Mermaid 格式的图表代码，你需要评估：图表中每个节点的**文字内容**是否来自检索内容。
- 例如：节点 A[体检前禁食] 中的"体检前禁食"这几个字，是否能在检索内容中找到？
- ✅ 图表节点的文字内容能在检索内容中找到依据 = 高分（忠实）
- ✅ 将散乱的文字整理成图表结构 = 不算幻觉，应视为忠实
- ❌ 图表节点包含检索内容中没有的信息 = 幻觉` : ''}

## 输出格式（仅输出 JSON）
{"score": 数字, "reason": "一句话评分理由"}`;

  try {
    // 如果使用了 web_search 或 fetch_webpage 工具，信息来源是网络而非知识库
    // 直接给高分，不用知识库检索内容来评判
    const usedWebSearch = toolsCalled.some(t => ['web_search', 'fetch_webpage'].includes(t));
    if (usedWebSearch) {
      return { score: 5, reason: '回答基于网络搜索结果，信息来源为互联网而非知识库' };
    }
    
    // 如果使用了 get_current_datetime 工具获取时间
    const usedDatetime = toolsCalled.includes('get_current_datetime');
    if (usedDatetime && !hasContent) {
      return { score: 5, reason: '回答基于系统时间工具返回的信息，无幻觉' };
    }

    const response = await llm.complete({ prompt });
    return parseJudgeResponse(response.text);
  } catch (error) {
    console.error('[FaithfulnessJudge] Error:', error);
    return { score: 0, reason: `评估出错: ${error}` };
  }
}

/**
 * 3. Quality Judge - 答案质量评估
 * 评估答案的正确性、完整性、清晰度
 */
export async function judgeQuality(
  question: string,
  answer: string
): Promise<JudgeResult> {
  ensureLLMConfigured();
  const llm = Settings.llm;

  const prompt = `你是一个 AI 回答质量评估专家。请从多个维度评估回答质量。

## 用户问题
${question}

## AI 回答
${answer.substring(0, 2000)}${answer.length > 2000 ? '...(截断)' : ''}

## 评分维度
1. **正确性**：回答是否准确、无误导
2. **完整性**：是否充分回答了问题
3. **清晰度**：表达是否清晰易懂
4. **相关性**：是否切题，没有跑题

## 评分标准（0-5分）
- 5分：优秀 - 准确、完整、清晰、切题
- 4分：良好 - 基本满足上述标准，有小瑕疵
- 3分：合格 - 回答了问题，但有明显不足
- 2分：较差 - 回答不完整或有明显错误
- 1分：很差 - 回答质量很低，几乎无用
- 0分：无效 - 完全没有回答问题

## 输出格式（仅输出 JSON）
{"score": 数字, "reason": "一句话评分理由，指出具体优缺点"}`;

  try {
    const response = await llm.complete({ prompt });
    return parseJudgeResponse(response.text);
  } catch (error) {
    console.error('[QualityJudge] Error:', error);
    return { score: 0, reason: `评估出错: ${error}` };
  }
}

/**
 * 4. Tool Judge - 工具调用评估（Agentic RAG 特有）
 * 评估 Agent 的工具选择和调用是否合理
 */
export async function judgeTool(
  question: string,
  toolsCalled: string[],
  expectedTools?: string[],
  expectedIntent?: string
): Promise<JudgeResult> {
  ensureLLMConfigured();
  const llm = Settings.llm;

  const toolsStr = toolsCalled.length > 0 ? toolsCalled.join(', ') : '无工具调用';
  const expectedStr = expectedTools && expectedTools.length > 0 
    ? expectedTools.join(', ') 
    : '未指定';

  const prompt = `你是一个 Agentic RAG 工具调用评估专家。请评估 Agent 的工具选择是否合理。

## 用户问题
${question}

## 实际调用的工具
${toolsStr}

## 期望调用的工具（参考）
${expectedStr}

## 期望的意图类型
${expectedIntent || '未指定'}

## 可用工具说明
- search_knowledge: 混合检索，适用于一般知识查询
- deep_search: 深度检索，适用于需要更多信息的场景
- keyword_search: 关键词精确搜索，适用于专有名词
- summarize_topic: 获取文档原文，适用于总结类问题
- generate_diagram: 生成图表，适用于画图请求
- web_search: 网络搜索，适用于实时信息
- get_current_datetime: 获取时间，适用于时间查询
- fetch_webpage: 抓取网页，配合网络搜索使用

## 评分标准（0-5分）
- 5分：工具选择完全正确，调用顺序合理
- 4分：工具选择基本正确，可能有更优选择
- 3分：工具选择可接受，但不是最优
- 2分：工具选择有问题，影响了回答质量
- 1分：工具选择明显错误
- 0分：完全没有调用工具或调用完全错误

## 输出格式（仅输出 JSON）
{"score": 数字, "reason": "一句话评分理由"}`;

  try {
    const response = await llm.complete({ prompt });
    return parseJudgeResponse(response.text);
  } catch (error) {
    console.error('[ToolJudge] Error:', error);
    return { score: 0, reason: `评估出错: ${error}` };
  }
}

/**
 * 综合评估 - 运行所有 Judge
 */
export async function runAllJudges(input: EvalInput): Promise<EvalScores> {
  console.log(`[EvalJudges] Running all judges for question: "${input.question.substring(0, 50)}..."`);

  // 并行运行所有 Judge（传入 toolsCalled 以正确处理工具调用场景）
  const [retrieval, faithfulness, quality, tool] = await Promise.all([
    judgeRetrieval(input.question, input.retrievedContent, input.toolsCalled),
    judgeFaithfulness(input.answer, input.retrievedContent, input.toolsCalled),
    judgeQuality(input.question, input.answer),
    judgeTool(input.question, input.toolsCalled, input.expectedTools, input.expectedIntent),
  ]);

  // 计算平均分
  // 平均分只计算 3 个核心维度（不含工具分数）
  const average = (retrieval.score + faithfulness.score + quality.score) / 3;

  console.log(`[EvalJudges] Scores: R=${retrieval.score}, F=${faithfulness.score}, Q=${quality.score}, Avg=${average.toFixed(2)}`);

  return {
    retrieval,
    faithfulness,
    quality,
    tool,
    average: parseFloat(average.toFixed(2)),
  };
}

