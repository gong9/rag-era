/**
 * 单个评估运行 API 端点
 * 
 * GET /api/eval/[id] - 获取评估详情
 * DELETE /api/eval/[id] - 删除评估运行
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { EvalService } from '@/lib/eval-service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/eval/[id]
 * 获取单个评估运行的详细信息
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { id } = await params;
    const evalRun = await EvalService.getEvalRun(id);

    if (!evalRun) {
      return NextResponse.json(
        { error: '评估运行不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json(evalRun);
  } catch (error: any) {
    console.error(`[API] GET /api/eval/[id] error:`, error);
    return NextResponse.json(
      { error: error.message || '获取评估详情失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/eval/[id]
 * 删除评估运行
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { id } = await params;
    await EvalService.deleteEvalRun(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(`[API] DELETE /api/eval/[id] error:`, error);
    return NextResponse.json(
      { error: error.message || '删除评估失败' },
      { status: 500 }
    );
  }
}

