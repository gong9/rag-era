/**
 * RAG 评估服务
 * 负责运行评估流程、调用 Judges、保存结果
 */

import { prisma } from './prisma';
import { LLMService } from './llm';
import { runAllJudges, EvalInput } from './eval-judges';

// 评测问题结构
export interface EvalQuestion {
  id: string;
  question: string;
  expectedIntent?: string;
  expectedTools?: string[];
  keywords?: string[];
}

// 评估运行状态
export type EvalStatus = 'pending' | 'running' | 'completed' | 'failed';

// 评估运行结果
export interface EvalRunResult {
  id: string;
  status: EvalStatus;
  totalQuestions: number;
  completedCount: number;
  avgRetrievalScore?: number;
  avgFaithScore?: number;
  avgQualityScore?: number;
  avgToolScore?: number;
  avgOverallScore?: number;
}

/**
 * RAG 评估服务类
 */
export class EvalService {
  /**
   * 从数据库获取评估运行的问题列表
   */
  static async getQuestions(evalRunId: string): Promise<EvalQuestion[]> {
    const evalRun = await prisma.evalRun.findUnique({
      where: { id: evalRunId },
      select: { questions: true },
    });

    if (!evalRun?.questions) {
      return [];
    }

    try {
      return JSON.parse(evalRun.questions) as EvalQuestion[];
    } catch (e) {
      console.error(`[EvalService] Failed to parse questions for ${evalRunId}:`, e);
      return [];
    }
  }

  /**
   * 创建新的评估运行（使用动态生成的问题）
   * @param knowledgeBaseId 知识库 ID
   * @param questions 评估问题列表（由 EvalGenerator 生成）
   */
  static async createEvalRun(knowledgeBaseId: string, questions: EvalQuestion[]): Promise<string> {
    // 验证知识库存在
    const kb = await prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    });

    if (!kb) {
      throw new Error(`知识库不存在: ${knowledgeBaseId}`);
    }

    if (!questions || questions.length === 0) {
      throw new Error('评估问题列表不能为空');
    }

    // 创建评估运行记录，将问题列表序列化为 JSON 存储
    const evalRun = await prisma.evalRun.create({
      data: {
        knowledgeBaseId,
        status: 'pending',
        questions: JSON.stringify(questions),
        totalQuestions: questions.length,
        completedCount: 0,
      },
    });

    console.log(`[EvalService] Created EvalRun ${evalRun.id} for KB ${knowledgeBaseId} with ${questions.length} questions`);
    return evalRun.id;
  }

  /**
   * 运行单个问题的评估
   * @returns 评估结果（用于 SSE 推送）
   */
  static async evaluateQuestion(
    evalRunId: string,
    knowledgeBaseId: string,
    question: EvalQuestion
  ): Promise<{
    questionId: string;
    question: string;
    answer: string;
    scores: {
      retrieval: number;
      faithfulness: number;
      quality: number;
      tool: number;
      average: number;
    };
    reasons: {
      retrieval: string;
      faithfulness: string;
      quality: string;
    };
  } | null> {
    console.log(`[EvalService] ──────────────────────────────────────────`);
    console.log(`[EvalService] Evaluating: "${question.question}"`);

    try {
      // 1. 调用 Agentic RAG 获取回答
      const ragResult = await LLMService.agenticQuery(
        knowledgeBaseId,
        question.question,
        [] // 空的聊天历史
      );

      const answer = ragResult.answer || '';
      
      // 直接从 ragResult.toolCalls 获取工具调用信息（更可靠）
      const toolsCalled = ragResult.toolCalls?.map((tc: any) => tc.tool) || [];
      
      console.log(`[EvalService] Tools called: ${toolsCalled.join(', ') || 'none'}`);

      // 提取检索内容 - 优先使用 retrievedContent（预检索），其次使用 sourceNodes
      const retrievedContent = ragResult.retrievedContent 
        || ragResult.sourceNodes?.map((n: any) => n.text || '').join('\n\n') 
        || '';

      // 2. 运行所有 Judge 进行评分
      const evalInput: EvalInput = {
        question: question.question,
        answer,
        retrievedContent,
        toolsCalled,
        expectedTools: question.expectedTools,
        expectedIntent: question.expectedIntent,
      };

      const scores = await runAllJudges(evalInput);

      // 3. 保存评估结果
      await prisma.evalResult.create({
        data: {
          evalRunId,
          questionId: question.id,
          question: question.question,
          answer,
          retrievedContent: retrievedContent.substring(0, 10000), // 限制长度
          toolsCalled: JSON.stringify(toolsCalled),
          retrievalScore: scores.retrieval.score,
          faithScore: scores.faithfulness.score,
          qualityScore: scores.quality.score,
          toolScore: scores.tool.score,
          avgScore: scores.average,
          retrievalReason: scores.retrieval.reason,
          faithReason: scores.faithfulness.reason,
          qualityReason: scores.quality.reason,
          toolReason: scores.tool.reason,
        },
      });

      // 4. 更新运行进度
      await prisma.evalRun.update({
        where: { id: evalRunId },
        data: {
          completedCount: { increment: 1 },
        },
      });

      console.log(`[EvalService] ✅ Question evaluated: avg=${scores.average}`);

      // 返回评估结果（用于 SSE 推送）
      return {
        questionId: question.id,
        question: question.question,
        answer,
        scores: {
          retrieval: scores.retrieval.score,
          faithfulness: scores.faithfulness.score,
          quality: scores.quality.score,
          tool: scores.tool.score,
          average: scores.average,
        },
        reasons: {
          retrieval: scores.retrieval.reason,
          faithfulness: scores.faithfulness.reason,
          quality: scores.quality.reason,
        },
      };
    } catch (error) {
      console.error(`[EvalService] ❌ Error evaluating question ${question.id}:`, error);
      throw error;
    }
  }

  /**
   * 运行完整评估
   */
  static async runEvaluation(evalRunId: string): Promise<EvalRunResult> {
    console.log(`[EvalService] ════════════════════════════════════════════`);
    console.log(`[EvalService] Starting evaluation run: ${evalRunId}`);

    // 获取评估运行信息
    const evalRun = await prisma.evalRun.findUnique({
      where: { id: evalRunId },
    });

    if (!evalRun) {
      throw new Error(`评估运行不存在: ${evalRunId}`);
    }

    // 更新状态为运行中
    await prisma.evalRun.update({
      where: { id: evalRunId },
      data: { status: 'running' },
    });

    try {
      // 从数据库获取问题列表
      const questions = await this.getQuestions(evalRunId);
      if (!questions || questions.length === 0) {
        throw new Error('未找到评估问题列表，请先生成问题');
      }

      // 逐个评估问题
      for (const question of questions) {
        await this.evaluateQuestion(evalRunId, evalRun.knowledgeBaseId, question);
      }

      // 计算平均分
      const results = await prisma.evalResult.findMany({
        where: { evalRunId },
      });

      const avgRetrievalScore = results.reduce((sum, r) => sum + r.retrievalScore, 0) / results.length;
      const avgFaithScore = results.reduce((sum, r) => sum + r.faithScore, 0) / results.length;
      const avgQualityScore = results.reduce((sum, r) => sum + r.qualityScore, 0) / results.length;
      const avgToolScore = results.reduce((sum, r) => sum + r.toolScore, 0) / results.length;
      const avgOverallScore = results.reduce((sum, r) => sum + r.avgScore, 0) / results.length;

      // 更新评估运行为完成状态
      const updatedRun = await prisma.evalRun.update({
        where: { id: evalRunId },
        data: {
          status: 'completed',
          avgRetrievalScore,
          avgFaithScore,
          avgQualityScore,
          avgToolScore,
          avgOverallScore,
        },
      });

      console.log(`[EvalService] ════════════════════════════════════════════`);
      console.log(`[EvalService] ✅ Evaluation completed!`);
      console.log(`[EvalService] Average Scores:`);
      console.log(`[EvalService]   Retrieval:   ${avgRetrievalScore.toFixed(2)}`);
      console.log(`[EvalService]   Faithfulness: ${avgFaithScore.toFixed(2)}`);
      console.log(`[EvalService]   Quality:     ${avgQualityScore.toFixed(2)}`);
      console.log(`[EvalService]   Tool:        ${avgToolScore.toFixed(2)}`);
      console.log(`[EvalService]   Overall:     ${avgOverallScore.toFixed(2)}`);

      return {
        id: updatedRun.id,
        status: updatedRun.status as EvalStatus,
        totalQuestions: updatedRun.totalQuestions,
        completedCount: updatedRun.completedCount,
        avgRetrievalScore: updatedRun.avgRetrievalScore || undefined,
        avgFaithScore: updatedRun.avgFaithScore || undefined,
        avgQualityScore: updatedRun.avgQualityScore || undefined,
        avgToolScore: updatedRun.avgToolScore || undefined,
        avgOverallScore: updatedRun.avgOverallScore || undefined,
      };
    } catch (error) {
      // 更新状态为失败
      await prisma.evalRun.update({
        where: { id: evalRunId },
        data: { status: 'failed' },
      });

      console.error(`[EvalService] ❌ Evaluation failed:`, error);
      throw error;
    }
  }

  /**
   * 运行评估（带 SSE 回调）
   * 每完成一个问题就调用回调函数推送进度
   */
  static async runEvaluationWithCallback(
    evalRunId: string,
    onProgress: (data: {
      questionId: string;
      question: string;
      answer: string;
      scores: {
        retrieval: number;
        faithfulness: number;
        quality: number;
        tool: number;
        average: number;
      };
      reasons: {
        retrieval: string;
        faithfulness: string;
        quality: string;
      };
      progress: {
        completed: number;
        total: number;
      };
    }) => void
  ): Promise<EvalRunResult> {
    console.log(`[EvalService] ════════════════════════════════════════════`);
    console.log(`[EvalService] Starting evaluation run (SSE mode): ${evalRunId}`);

    // 获取评估运行信息
    const evalRun = await prisma.evalRun.findUnique({
      where: { id: evalRunId },
    });

    if (!evalRun) {
      throw new Error(`评估运行不存在: ${evalRunId}`);
    }

    // 更新状态为运行中
    await prisma.evalRun.update({
      where: { id: evalRunId },
      data: { status: 'running' },
    });

    try {
      // 从数据库获取问题列表
      const questions = await this.getQuestions(evalRunId);
      if (!questions || questions.length === 0) {
        throw new Error('未找到评估问题列表，请先生成问题');
      }
      
      const total = questions.length;
      let completed = 0;

      // 逐个评估问题
      for (const question of questions) {
        const result = await this.evaluateQuestion(evalRunId, evalRun.knowledgeBaseId, question);
        completed++;

        // 推送进度
        if (result) {
          onProgress({
            ...result,
            progress: { completed, total },
          });
        }
      }

      // 计算平均分
      const results = await prisma.evalResult.findMany({
        where: { evalRunId },
      });

      const avgRetrievalScore = results.reduce((sum, r) => sum + r.retrievalScore, 0) / results.length;
      const avgFaithScore = results.reduce((sum, r) => sum + r.faithScore, 0) / results.length;
      const avgQualityScore = results.reduce((sum, r) => sum + r.qualityScore, 0) / results.length;
      const avgToolScore = results.reduce((sum, r) => sum + r.toolScore, 0) / results.length;
      const avgOverallScore = results.reduce((sum, r) => sum + r.avgScore, 0) / results.length;

      // 更新评估运行为完成状态
      const updatedRun = await prisma.evalRun.update({
        where: { id: evalRunId },
        data: {
          status: 'completed',
          avgRetrievalScore,
          avgFaithScore,
          avgQualityScore,
          avgToolScore,
          avgOverallScore,
        },
      });

      console.log(`[EvalService] ════════════════════════════════════════════`);
      console.log(`[EvalService] ✅ Evaluation completed (SSE mode)!`);

      return {
        id: updatedRun.id,
        status: updatedRun.status as EvalStatus,
        totalQuestions: updatedRun.totalQuestions,
        completedCount: updatedRun.completedCount,
        avgRetrievalScore: updatedRun.avgRetrievalScore || undefined,
        avgFaithScore: updatedRun.avgFaithScore || undefined,
        avgQualityScore: updatedRun.avgQualityScore || undefined,
        avgToolScore: updatedRun.avgToolScore || undefined,
        avgOverallScore: updatedRun.avgOverallScore || undefined,
      };
    } catch (error) {
      // 更新状态为失败
      await prisma.evalRun.update({
        where: { id: evalRunId },
        data: { status: 'failed' },
      });

      console.error(`[EvalService] ❌ Evaluation failed (SSE mode):`, error);
      throw error;
    }
  }

  /**
   * 获取评估运行详情
   */
  static async getEvalRun(evalRunId: string) {
    const evalRun = await prisma.evalRun.findUnique({
      where: { id: evalRunId },
      include: {
        results: {
          orderBy: { createdAt: 'asc' },
        },
        knowledgeBase: {
          select: { name: true },
        },
      },
    });

    return evalRun;
  }

  /**
   * 获取知识库的所有评估运行
   */
  static async getEvalRuns(knowledgeBaseId: string) {
    const evalRuns = await prisma.evalRun.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { results: true },
        },
      },
    });

    return evalRuns;
  }

  /**
   * 获取所有评估运行（跨知识库）
   */
  static async getAllEvalRuns() {
    const evalRuns = await prisma.evalRun.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        knowledgeBase: {
          select: { name: true },
        },
        _count: {
          select: { results: true },
        },
      },
    });

    return evalRuns;
  }

  /**
   * 删除评估运行
   */
  static async deleteEvalRun(evalRunId: string): Promise<void> {
    await prisma.evalRun.delete({
      where: { id: evalRunId },
    });

    console.log(`[EvalService] Deleted EvalRun ${evalRunId}`);
  }
}

