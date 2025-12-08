import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LLMService } from '@/lib/llm';
import { z } from 'zod';

const querySchema = z.object({
  knowledgeBaseId: z.string(),
  sessionId: z.string(),
  question: z.string().min(1),
  mode: z.enum(['normal', 'agentic']).default('normal'),
});

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const body = await request.json();
    const { knowledgeBaseId, sessionId, question, mode } = querySchema.parse(body);

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

    // 验证会话所有权并获取历史对话
    const chatSession = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        chatHistories: {
          orderBy: { createdAt: 'asc' },
          take: 10, // 最多取最近 10 轮对话作为上下文
        },
      },
    });

    if (!chatSession) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }

    if (chatSession.userId !== userId) {
      return NextResponse.json({ error: '无权访问此会话' }, { status: 403 });
    }

    // 构建对话历史（用于多轮对话记忆）
    const chatHistory = chatSession.chatHistories.flatMap((h: any) => [
      { role: 'user' as const, content: h.question },
      { role: 'assistant' as const, content: h.answer },
    ]);
    console.log(`[API] Chat history: ${chatHistory.length / 2} rounds`);

    // 根据模式选择查询方法，传入对话历史
    console.log(`[API] Query mode: ${mode}`);
    const result = mode === 'agentic'
      ? await LLMService.agenticQuery(knowledgeBaseId, question, chatHistory)
      : await LLMService.query(knowledgeBaseId, question, chatHistory);

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

