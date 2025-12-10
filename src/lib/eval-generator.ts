/**
 * 评估问题自动生成服务
 * 根据知识库内容自动生成评估问题
 */

import { prisma } from './prisma';
import { OpenAI } from '@llamaindex/openai';

// 生成的评估问题结构
export interface GeneratedQuestion {
  id: string;
  question: string;
  expectedIntent: string;
  expectedTools: string[];
  keywords: string[];
}

// 固定问题定义
const FIXED_QUESTIONS: GeneratedQuestion[] = [
  {
    id: 'fixed_summary',
    question: '总结一下知识库中的文档内容',
    expectedIntent: 'document_summary',
    expectedTools: ['summarize_topic'],
    keywords: ['总结', '文档', '内容'],
  },
];

// 二选一问题池
const RANDOM_FIXED_QUESTIONS: GeneratedQuestion[] = [
  {
    id: 'fixed_datetime',
    question: '今天是几号？',
    expectedIntent: 'datetime',
    expectedTools: ['get_current_datetime'],
    keywords: ['今天', '日期', '几号'],
  },
  {
    id: 'fixed_weather',
    question: '北京今天天气怎么样？',
    expectedIntent: 'web_search',
    expectedTools: ['web_search'],
    keywords: ['北京', '今天', '天气'],
  },
];

// LLM 实例缓存
let llmInstance: OpenAI | null = null;

/**
 * 获取 LLM 实例
 */
function getLLM(): OpenAI {
  if (!llmInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = process.env.OPENAI_MODEL || 'qwen-turbo';

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    llmInstance = new OpenAI({
      apiKey,
      model,
      baseURL,
    });
  }
  return llmInstance;
}

/**
 * 评估问题生成器
 */
export class EvalGenerator {
  /**
   * 获取知识库的文档内容
   * @param knowledgeBaseId 知识库 ID
   * @param userId 用户 ID（用于权限验证）
   */
  static async getKnowledgeBaseContent(knowledgeBaseId: string, userId?: string): Promise<{
    kbName: string;
    documents: Array<{ name: string; content: string }>;
  }> {
    const whereClause: any = { id: knowledgeBaseId };
    if (userId) {
      whereClause.userId = userId;
    }

    const kb = await prisma.knowledgeBase.findFirst({
      where: whereClause,
      include: {
        documents: {
          where: { status: 'completed' },
          select: { name: true, content: true },
        },
      },
    });

    if (!kb) {
      throw new Error(`知识库不存在或无权访问: ${knowledgeBaseId}`);
    }

    if (kb.documents.length === 0) {
      throw new Error('知识库中没有已处理的文档，请先上传并处理文档');
    }

    return {
      kbName: kb.name,
      documents: kb.documents.map((doc) => ({
        name: doc.name,
        content: doc.content || '',
      })),
    };
  }

  /**
   * 使用 LLM 生成动态评估问题
   */
  static async generateDynamicQuestions(
    documents: Array<{ name: string; content: string }>,
    count: number = 8
  ): Promise<GeneratedQuestion[]> {
    const llm = getLLM();

    // 准备文档内容摘要（限制长度防止超出 token 限制）
    const contentSummary = documents
      .map((doc) => {
        const truncatedContent = doc.content.substring(0, 2000);
        return `【${doc.name}】\n${truncatedContent}${doc.content.length > 2000 ? '...(内容已截断)' : ''}`;
      })
      .join('\n\n---\n\n')
      .substring(0, 8000);

    const prompt = `你是一个 RAG 系统评估专家。请根据以下知识库文档内容，生成 ${count} 个用于评估 RAG 系统的测试问题。

## 知识库文档内容
${contentSummary}

## 生成要求

1. **问题类型分布**:
   - 6-7 个知识查询问题：直接询问文档中的具体事实、数据、流程、注意事项等
   - 1 个画图/流程图问题：如果文档中有流程、步骤，生成"画一个 XXX 的流程图"这样的问题

2. **问题质量要求**:
   - 问题必须能从文档内容中找到答案
   - 问题要具体、明确，不要太宽泛
   - 问题要有实际价值，是用户可能真正会问的
   - 涵盖文档的不同方面，不要重复

3. **expectedIntent 取值**:
   - knowledge_query: 知识查询类问题
   - draw_diagram: 画图/流程图类问题

4. **expectedTools 取值**:
   - knowledge_query 对应: ["search_knowledge"] 或 ["search_knowledge", "deep_search"]
   - draw_diagram 对应: ["deep_search", "generate_diagram"]

## 输出格式

请直接输出 JSON 数组，不要有其他内容：
[
  {
    "id": "q1",
    "question": "问题内容",
    "expectedIntent": "knowledge_query",
    "expectedTools": ["search_knowledge"],
    "keywords": ["关键词1", "关键词2"]
  },
  ...
]`;

    try {
      const response = await llm.complete({ prompt });
      const text = response.text;

      // 解析 JSON
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('[EvalGenerator] Failed to parse LLM response:', text);
        throw new Error('LLM 返回格式错误，无法解析问题列表');
      }

      const questions: GeneratedQuestion[] = JSON.parse(jsonMatch[0]);

      // 验证并规范化问题
      return questions.slice(0, count).map((q, index) => ({
        id: q.id || `generated_${index + 1}`,
        question: q.question,
        expectedIntent: q.expectedIntent || 'knowledge_query',
        expectedTools: q.expectedTools || ['search_knowledge'],
        keywords: q.keywords || [],
      }));
    } catch (error) {
      console.error('[EvalGenerator] Error generating questions:', error);
      throw new Error(`生成评估问题失败: ${error}`);
    }
  }

  /**
   * 生成完整的评估问题集
   * @param knowledgeBaseId 知识库 ID
   * @param totalCount 总问题数（默认 10）
   * @param userId 用户 ID（用于权限验证）
   */
  static async generate(
    knowledgeBaseId: string,
    totalCount: number = 10,
    userId?: string
  ): Promise<GeneratedQuestion[]> {
    console.log(`[EvalGenerator] Generating ${totalCount} questions for KB: ${knowledgeBaseId}`);

    // 1. 获取知识库内容（带用户权限验证）
    const { kbName, documents } = await this.getKnowledgeBaseContent(knowledgeBaseId, userId);
    console.log(`[EvalGenerator] KB "${kbName}" has ${documents.length} documents`);

    // 2. 准备固定问题
    const fixedQuestions: GeneratedQuestion[] = [...FIXED_QUESTIONS];

    // 随机选择一个二选一问题
    const randomIndex = Math.floor(Math.random() * RANDOM_FIXED_QUESTIONS.length);
    fixedQuestions.push(RANDOM_FIXED_QUESTIONS[randomIndex]);

    console.log(`[EvalGenerator] Fixed questions: ${fixedQuestions.length}`);

    // 3. 生成动态问题
    const dynamicCount = totalCount - fixedQuestions.length;
    let dynamicQuestions: GeneratedQuestion[] = [];

    if (dynamicCount > 0) {
      dynamicQuestions = await this.generateDynamicQuestions(documents, dynamicCount);
      console.log(`[EvalGenerator] Generated ${dynamicQuestions.length} dynamic questions`);
    }

    // 4. 合并问题（动态问题在前，固定问题在后）
    const allQuestions = [...dynamicQuestions, ...fixedQuestions];

    console.log(`[EvalGenerator] Total questions: ${allQuestions.length}`);
    return allQuestions;
  }
}

