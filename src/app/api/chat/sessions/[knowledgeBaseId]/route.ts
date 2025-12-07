import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// 获取知识库的所有会话列表
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

    // 验证知识库所有权
    const knowledgeBase = await prisma.knowledgeBase.findUnique({
      where: { id: params.knowledgeBaseId },
    });

    if (!knowledgeBase) {
      return NextResponse.json({ error: '知识库不存在' }, { status: 404 });
    }

    if (knowledgeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此知识库' }, { status: 403 });
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

    // 验证知识库所有权
    const knowledgeBase = await prisma.knowledgeBase.findUnique({
      where: { id: params.knowledgeBaseId },
    });

    if (!knowledgeBase) {
      return NextResponse.json({ error: '知识库不存在' }, { status: 404 });
    }

    if (knowledgeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此知识库' }, { status: 403 });
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

