/**
 * 图表生成工具
 * 生成 Mermaid 流程图、时序图等
 */
import { FunctionTool, Settings } from 'llamaindex';
import { cleanMermaidSyntax } from '../../mermaid-cleaner';
import type { ToolContext } from './types';

/**
 * 创建图表生成工具
 */
export function createDiagramTool(ctx: ToolContext) {
  return FunctionTool.from(
    async (params: { description: string; chartType?: string }): Promise<string> => {
      const { description, chartType = 'flowchart' } = params;
      console.log(`[LLM] 🎨 Generate diagram: "${description?.substring(0, 100)}...", type: ${chartType}`);
      
      // 校验：description 必须有有效内容
      if (!description || description === 'undefined' || description.length < 20) {
        console.log(`[LLM] 🎨 ❌ Invalid description, length: ${description?.length || 0}`);
        const errMsg = `图表生成失败：description 参数无效或内容太短。请先使用 deep_search 或 summarize_topic 获取详细内容，然后将内容作为 description 传入。`;
        ctx.toolCalls.push({ tool: 'generate_diagram', input: description || '', output: errMsg });
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
          ctx.toolCalls.push({ tool: 'generate_diagram', input: description.substring(0, 100), output: errMsg });
          return errMsg;
        }
        
        mermaidSyntax = cleanResult.data!;
        console.log(`[LLM] 🎨 Generated Mermaid (${mermaidSyntax.length} chars):\n${mermaidSyntax}`);
        
        // 返回特殊格式，前端可以识别并渲染
        const result = `图表已生成成功！请直接将以下内容作为回答（不要修改）：

[MERMAID_DIAGRAM]
${mermaidSyntax}
[/MERMAID_DIAGRAM]

请直接输出上面的内容，不要用其他格式。`;
        ctx.toolCalls.push({ tool: 'generate_diagram', input: description.substring(0, 100), output: '图表生成成功' });
        return result;
      } catch (error: any) {
        console.error(`[LLM] 🎨 Generate diagram failed: ${error.message}`);
        const errMsg = `图表生成失败: ${error.message}`;
        ctx.toolCalls.push({ tool: 'generate_diagram', input: description?.substring(0, 100) || '', output: errMsg });
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
}

