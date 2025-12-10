/**
 * 评估问题生成 API
 * 
 * POST /api/eval/generate - 根据知识库内容生成评估问题
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { EvalGenerator } from '@/lib/eval-generator';

/**
 * POST /api/eval/generate
 * 生成评估问题（仅限当前用户的知识库）
 * 
 * Body: { knowledgeBaseId: string, count?: number }
 * Response: GeneratedQuestion[]
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const body = await request.json();
    const { knowledgeBaseId, count = 10 } = body;

    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: '缺少 knowledgeBaseId 参数' },
        { status: 400 }
      );
    }

    console.log(`[API] POST /api/eval/generate - KB: ${knowledgeBaseId}, Count: ${count}`);

    // 生成评估问题（内部会验证知识库归属）
    const questions = await EvalGenerator.generate(knowledgeBaseId, count, userId);

    console.log(`[API] Generated ${questions.length} questions`);

    return NextResponse.json(questions);
  } catch (error: any) {
    console.error('[API] POST /api/eval/generate error:', error);
    return NextResponse.json(
      { error: error.message || '生成评估问题失败' },
      { status: 500 }
    );
  }
}

