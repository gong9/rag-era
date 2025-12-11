/**
 * ReAct Agent 输出解析模块
 * 负责解析 Agent 的原始输出，提取思考过程、工具调用和最终答案
 */

import { cleanMermaidSyntax } from '../mermaid-cleaner';

/**
 * 工具调用记录
 */
export interface ToolCall {
  tool: string;
  input: string;
  output: string;
}

/**
 * 解析后的 Agent 输出
 */
export interface ParsedAgentOutput {
  thinking: string[];
  answer: string;
  toolCalls: ToolCall[];
}

/**
 * 工具名称到友好描述的映射
 */
export const toolNameMap: Record<string, string> = {
  'search_knowledge': '🔍 混合检索知识库',
  'deep_search': '📚 深度混合检索',
  'keyword_search': '🔤 关键词精确搜索',
  'graph_search': '🕸️ 知识图谱检索',
  'summarize_topic': '📋 获取文档原文',
  'decompose_question': '🔀 拆解复杂问题',
  'verify_answer': '✅ 验证答案质量',
  'get_current_datetime': '📅 获取当前日期时间',
  'web_search': '🌐 搜索互联网',
  'fetch_webpage': '📄 抓取网页内容',
  'generate_diagram': '🎨 生成可视化图表',
};

/**
 * 解析 ReAct Agent 的输出
 * 提取思考过程、最终答案和工具调用记录
 * 注意：保留答案中的换行符以保持格式
 */
export function parseAgentOutput(rawOutput: string): ParsedAgentOutput {
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
    const cleanResult = cleanMermaidSyntax(mermaidContent.trim());
    const wrappedMermaid = `[MERMAID_DIAGRAM]\n${cleanResult.success ? cleanResult.data : mermaidContent.trim()}\n[/MERMAID_DIAGRAM]`;
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
    const toolOutput = actionMatch[3]?.substring(0, 200) || '';
    
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
    // 清理 LLM 可能输出的多引号
    finalAnswer = finalAnswer.replace(/^["'`]{2,}|["'`]{2,}$/g, '').trim();
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
    cleaned = cleaned.replace(/^["'\s]+|["'\s]+$/g, '').trim();
    
    if (cleaned.length > 10) {
      finalAnswer = cleaned;
    }
  }
  
  // 清理答案中可能残留的多引号
  if (finalAnswer) {
    finalAnswer = finalAnswer
      .replace(/^["'`]{2,}/gm, '')
      .replace(/["'`]{2,}$/gm, '')
      .replace(/^\s*"""\s*/gm, '')
      .replace(/\s*"""\s*$/gm, '')
      .trim();
  }
  
  // 去重思考步骤
  const uniqueThinking = [...new Set(thinkingSteps)];
  
  return {
    thinking: uniqueThinking,
    answer: finalAnswer || rawOutput,
    toolCalls,
  };
}

/**
 * 修复 Mermaid 图表格式
 * 如果发现裸 Mermaid 代码，自动包裹标签
 */
export function fixMermaidFormat(answer: string): string {
  const hasMermaidTag = answer.includes('[MERMAID_DIAGRAM]') && answer.includes('[/MERMAID_DIAGRAM]');
  const hasFlowchart = answer.includes('flowchart') && answer.includes('-->');
  const hasSequence = answer.includes('sequenceDiagram');
  
  if (!hasMermaidTag && (hasFlowchart || hasSequence)) {
    const mermaidMatch = answer.match(/(flowchart\s+(?:TD|LR|TB|RL|BT)[\s\S]*?)(?=\n\n|$)/i) 
                        || answer.match(/(sequenceDiagram[\s\S]*?)(?=\n\n|$)/i);
    if (mermaidMatch) {
      const cleanResult = cleanMermaidSyntax(mermaidMatch[1].trim());
      return `[MERMAID_DIAGRAM]\n${cleanResult.success ? cleanResult.data : mermaidMatch[1].trim()}\n[/MERMAID_DIAGRAM]`;
    }
  }
  
  return answer;
}

