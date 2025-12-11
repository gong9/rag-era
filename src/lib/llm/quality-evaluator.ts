/**
 * 回答质量评估模块
 * 负责评估 Agent 回答的质量并决定是否重试
 */
import { Settings } from 'llamaindex';
import type { IntentType } from '../context';

/**
 * 评估上下文
 */
export interface EvaluationContext {
  question: string;
  intent: IntentType;
  answerLength: number;
  hasDiagram: boolean;
  hasPreSearch: boolean;
  preSearchCount: number;
  toolsCalled: string[];
}

/**
 * 评估结果
 */
export interface EvaluationResult {
  pass: boolean;
  reason: string;
}

/**
 * 格式预检查（不需要 LLM）
 * 检查图表格式是否正确
 */
export function preCheckFormat(answer: string, intent: IntentType): {
  needsFix: boolean;
  fixedAnswer?: string;
} {
  if (intent !== 'draw_diagram') {
    return { needsFix: false };
  }
  
  const hasMermaidTag = answer.includes('[MERMAID_DIAGRAM]') && answer.includes('[/MERMAID_DIAGRAM]');
  const hasFlowchart = answer.includes('flowchart') && answer.includes('-->');
  
  if (!hasMermaidTag && hasFlowchart) {
    // 格式不对，尝试自动修复
    console.log(`[LLM] 📊 格式预检查：发现裸 Mermaid，自动修复`);
    const mermaidMatch = answer.match(/(flowchart\s+(?:TD|LR|TB|RL|BT)[\s\S]*?)(?=\n\n|$)/i);
    if (mermaidMatch) {
      const fixedAnswer = `[MERMAID_DIAGRAM]\n${mermaidMatch[1].trim()}\n[/MERMAID_DIAGRAM]`;
      console.log(`[LLM] 📊 格式预检查：已修复，新长度 ${fixedAnswer.length}`);
      return { needsFix: true, fixedAnswer };
    }
  } else if (hasMermaidTag) {
    console.log(`[LLM] 📊 格式预检查：✅ Mermaid 格式正确`);
  }
  
  return { needsFix: false };
}

/**
 * 使用 LLM 评估回答质量
 */
export async function evaluateQuality(
  answer: string,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const llm = Settings.llm;
  
  const evalPrompt = `请评估 AI 回答的质量，重点检查逻辑正确性。

【上下文】
- 用户问题: "${context.question}"
- 用户意图: ${context.intent}
- 回答长度: ${context.answerLength} 字符
${context.intent === 'draw_diagram' ? `- 包含图表: ${context.hasDiagram ? '是' : '否'}` : ''}

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

  try {
    console.log(`[LLM] 📊 Quality evaluation...`);
    const evalResponse = await llm.complete({ prompt: evalPrompt });
    const evalText = evalResponse.text.trim();
    console.log(`[LLM] 📊 Eval: ${evalText}`);
    
    const jsonMatch = evalText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const evalResult = JSON.parse(jsonMatch[0]);
      return {
        pass: !!evalResult.pass,
        reason: evalResult.reason || '',
      };
    }
  } catch (error) {
    console.log(`[LLM] 📊 Eval error (ignored): ${error}`);
  }
  
  // 解析失败，默认通过
  return { pass: true, reason: 'Eval parse failed, passing' };
}

/**
 * 构建评估上下文
 */
export function buildEvaluationContext(
  question: string,
  intent: IntentType,
  answer: string,
  toolsCalled: string[],
  hasPreSearch: boolean,
  preSearchCount: number
): EvaluationContext {
  return {
    question,
    intent,
    answerLength: answer.length,
    hasDiagram: answer.includes('[MERMAID_DIAGRAM]') || answer.includes('flowchart'),
    hasPreSearch,
    preSearchCount,
    toolsCalled,
  };
}

/**
 * 最终校验：确保图表格式正确
 */
export function finalValidation(answer: string, intent: IntentType): string {
  if (intent !== 'draw_diagram') {
    return answer;
  }
  
  const hasMermaidTag = answer.includes('[MERMAID_DIAGRAM]') && answer.includes('[/MERMAID_DIAGRAM]');
  const hasFlowchart = answer.includes('flowchart') && answer.includes('-->');
  const hasSequence = answer.includes('sequenceDiagram');
  
  if (!hasMermaidTag && (hasFlowchart || hasSequence)) {
    // 有 Mermaid 代码但没有标签，自动包裹
    console.log(`[LLM] ⚠️ 最终校验：发现裸 Mermaid，自动包裹标签`);
    const mermaidMatch = answer.match(/(flowchart\s+(?:TD|LR|TB|RL|BT)[\s\S]*?)(?=\n\n|$)/i) 
                        || answer.match(/(sequenceDiagram[\s\S]*?)(?=\n\n|$)/i);
    if (mermaidMatch) {
      return `[MERMAID_DIAGRAM]\n${mermaidMatch[1].trim()}\n[/MERMAID_DIAGRAM]`;
    }
  } else if (!hasMermaidTag && !hasFlowchart && !hasSequence) {
    console.log(`[LLM] ❌ 最终校验：画图请求但没有图表内容`);
  } else if (hasMermaidTag) {
    console.log(`[LLM] ✅ 最终校验：Mermaid 格式正确`);
  }
  
  return answer;
}

