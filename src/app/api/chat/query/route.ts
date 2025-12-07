import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { LLMService } from '@/lib/llm';
import { z } from 'zod';

const querySchema = z.object({
  knowledgeBaseId: z.string(),
  sessionId: z.string(),
  question: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const body = await request.json();
    const { knowledgeBaseId, sessionId, question } = querySchema.parse(body);

    // 验证知识库所有权
    const knowledgeBase = await prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    });

    if (!knowledgeBase) {
      return NextResponse.json({ error: '知识库不存在' }, { status: 404 });
    }

    if (knowledgeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此知识库' }, { status: 403 });
    }

    // 检查是否有文档
    const documentCount = await prisma.document.count({
      where: {
        knowledgeBaseId,
        status: 'completed',
      },
    });

    if (documentCount === 0) {
      return NextResponse.json({ error: '知识库中没有可用的文档' }, { status: 400 });
    }

    // 验证会话所有权
    const chatSession = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        chatHistories: {
          take: 1,
        },
      },
    });

    if (!chatSession) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }

    if (chatSession.userId !== userId) {
      return NextResponse.json({ error: '无权访问此会话' }, { status: 403 });
    }

    // 查询
    const result = await LLMService.query(knowledgeBaseId, question);

    // 保存聊天历史
    await prisma.chatHistory.create({
      data: {
        sessionId,
        knowledgeBaseId,
        userId,
        question,
        answer: result.answer,
        sourceNodes: JSON.stringify(result.sourceNodes),
      },
    });

    // 如果这是会话的第一条消息，更新会话标题
    if (chatSession.chatHistories.length === 0) {
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          title: question.length > 30 ? question.substring(0, 30) + '...' : question,
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: '输入数据格式错误' }, { status: 400 });
    }
    console.error('Query error:', error);
    return NextResponse.json({ error: '查询失败: ' + (error as Error).message }, { status: 500 });
  }
}

