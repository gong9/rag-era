import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * 验证知识库或代码库的所有权
 * 支持两种 ID 格式：
 * - 普通知识库 ID：直接查询 KnowledgeBase 表
 * - 代码库 ID：以 "codebase_" 开头，查询 CodeBase 表
 */
async function validateOwnership(resourceId: string, userId: string): Promise<{ valid: boolean; error?: string }> {
  // 检查是否是代码库
  if (resourceId.startsWith('codebase_')) {
    const codeBaseId = resourceId.replace('codebase_', '');
    const codeBase = await prisma.codeBase.findUnique({
      where: { id: codeBaseId },
    });

    if (!codeBase) {
      return { valid: false, error: '代码库不存在' };
    }

    if (codeBase.userId !== userId) {
      return { valid: false, error: '无权访问此代码库' };
    }

    return { valid: true };
  }

  // 普通知识库
  const knowledgeBase = await prisma.knowledgeBase.findUnique({
    where: { id: resourceId },
  });

  if (!knowledgeBase) {
    return { valid: false, error: '知识库不存在' };
  }

  if (knowledgeBase.userId !== userId) {
    return { valid: false, error: '无权访问此知识库' };
  }

  return { valid: true };
}

// 获取知识库/代码库的所有会话列表
export async function GET(
  request: Request,
  { params }: { params: { knowledgeBaseId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;

    // 验证所有权
    const validation = await validateOwnership(params.knowledgeBaseId, userId);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 404 });
    }

    // 获取所有会话，按更新时间倒序
    const sessions = await prisma.chatSession.findMany({
      where: {
        knowledgeBaseId: params.knowledgeBaseId,
        userId,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        chatHistories: {
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: {
            question: true,
          },
        },
        _count: {
          select: {
            chatHistories: true,
          },
        },
      },
    });

    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Get sessions error:', error);
    return NextResponse.json({ error: '获取会话列表失败' }, { status: 500 });
  }
}

// 创建新会话
export async function POST(
  request: Request,
  { params }: { params: { knowledgeBaseId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;

    // 验证所有权
    const validation = await validateOwnership(params.knowledgeBaseId, userId);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 404 });
    }

    // 创建新会话
    const newSession = await prisma.chatSession.create({
      data: {
        knowledgeBaseId: params.knowledgeBaseId,
        userId,
        title: '新对话',
      },
    });

    return NextResponse.json(newSession, { status: 201 });
  } catch (error) {
    console.error('Create session error:', error);
    return NextResponse.json({ error: '创建会话失败' }, { status: 500 });
  }
}
