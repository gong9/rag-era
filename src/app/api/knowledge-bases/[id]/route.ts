import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LLMService } from '@/lib/llm';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const knowledgeBase = await prisma.knowledgeBase.findUnique({
      where: { id: params.id },
      include: {
        documents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!knowledgeBase) {
      return NextResponse.json({ error: '知识库不存在' }, { status: 404 });
    }

    if (knowledgeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此知识库' }, { status: 403 });
    }

    return NextResponse.json(knowledgeBase);
  } catch (error) {
    console.error('Get knowledge base error:', error);
    return NextResponse.json({ error: '获取知识库失败' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const knowledgeBase = await prisma.knowledgeBase.findUnique({
      where: { id: params.id },
    });

    if (!knowledgeBase) {
      return NextResponse.json({ error: '知识库不存在' }, { status: 404 });
    }

    if (knowledgeBase.userId !== userId) {
      return NextResponse.json({ error: '无权删除此知识库' }, { status: 403 });
    }

    // 删除向量索引
    await LLMService.deleteIndex(params.id);

    // 删除数据库记录
    await prisma.knowledgeBase.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('Delete knowledge base error:', error);
    return NextResponse.json({ error: '删除知识库失败' }, { status: 500 });
  }
}

