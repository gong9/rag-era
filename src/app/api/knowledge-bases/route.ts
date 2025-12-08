import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const createKBSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;

    const knowledgeBases = await prisma.knowledgeBase.findMany({
      where: { userId },
      include: {
        _count: {
          select: { documents: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(knowledgeBases);
  } catch (error) {
    console.error('Get knowledge bases error:', error);
    return NextResponse.json({ error: '获取知识库列表失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const body = await request.json();
    const { name, description } = createKBSchema.parse(body);

    const knowledgeBase = await prisma.knowledgeBase.create({
      data: {
        name,
        description,
        userId,
      },
    });

    return NextResponse.json(knowledgeBase, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: '输入数据格式错误' }, { status: 400 });
    }
    console.error('Create knowledge base error:', error);
    return NextResponse.json({ error: '创建知识库失败' }, { status: 500 });
  }
}

