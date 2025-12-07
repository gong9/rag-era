import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// 获取会话的所有消息
export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;

    // 验证会话所有权
    const chatSession = await prisma.chatSession.findUnique({
      where: { id: params.sessionId },
    });

    if (!chatSession) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }

    if (chatSession.userId !== userId) {
      return NextResponse.json({ error: '无权访问此会话' }, { status: 403 });
    }

    // 获取会话的所有消息
    const messages = await prisma.chatHistory.findMany({
      where: {
        sessionId: params.sessionId,
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(messages);
  } catch (error) {
    console.error('Get session messages error:', error);
    return NextResponse.json({ error: '获取会话消息失败' }, { status: 500 });
  }
}

// 删除会话
export async function DELETE(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;

    // 验证会话所有权
    const chatSession = await prisma.chatSession.findUnique({
      where: { id: params.sessionId },
    });

    if (!chatSession) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }

    if (chatSession.userId !== userId) {
      return NextResponse.json({ error: '无权访问此会话' }, { status: 403 });
    }

    // 删除会话（级联删除所有消息）
    await prisma.chatSession.delete({
      where: { id: params.sessionId },
    });

    return NextResponse.json({ message: '会话已删除' });
  } catch (error) {
    console.error('Delete session error:', error);
    return NextResponse.json({ error: '删除会话失败' }, { status: 500 });
  }
}

