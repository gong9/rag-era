/**
 * RAG 评估 API 端点
 * 
 * GET /api/eval - 获取所有评估运行
 * POST /api/eval - 创建并运行新评估
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { EvalService } from '@/lib/eval-service';

/**
 * GET /api/eval
 * 获取所有评估运行列表
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 可选：通过 query 参数过滤特定知识库
    const { searchParams } = new URL(request.url);
    const knowledgeBaseId = searchParams.get('knowledgeBaseId');

    let evalRuns;
    if (knowledgeBaseId) {
      evalRuns = await EvalService.getEvalRuns(knowledgeBaseId);
    } else {
      evalRuns = await EvalService.getAllEvalRuns();
    }

    return NextResponse.json(evalRuns);
  } catch (error: any) {
    console.error('[API] GET /api/eval error:', error);
    return NextResponse.json(
      { error: error.message || '获取评估列表失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/eval
 * 创建新的评估（不立即运行，通过 SSE 订阅来运行）
 * 
 * Body: { knowledgeBaseId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { knowledgeBaseId } = body;

    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: '缺少 knowledgeBaseId 参数' },
        { status: 400 }
      );
    }

    // 创建评估运行（不立即执行，等待 SSE 订阅）
    const evalRunId = await EvalService.createEvalRun(knowledgeBaseId);

    return NextResponse.json({
      id: evalRunId,
      status: 'pending',
      message: '评估已创建，请订阅 SSE 流获取实时进度',
      streamUrl: `/api/eval/stream/${evalRunId}`,
    });
  } catch (error: any) {
    console.error('[API] POST /api/eval error:', error);
    return NextResponse.json(
      { error: error.message || '创建评估失败' },
      { status: 500 }
    );
  }
}

