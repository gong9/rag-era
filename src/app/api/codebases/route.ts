import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const createCodeBaseSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  githubUrl: z.string().url().refine(
    (url) => url.includes('github.com'),
    { message: '请输入有效的 GitHub 仓库地址' }
  ),
  branch: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;

    const codeBases = await prisma.codeBase.findMany({
      where: { userId },
      include: {
        _count: {
          select: { codeFiles: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(codeBases);
  } catch (error) {
    console.error('Get codebases error:', error);
    return NextResponse.json({ error: '获取代码库列表失败' }, { status: 500 });
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
    const validated = createCodeBaseSchema.parse(body);

    // 从 GitHub URL 中提取仓库名作为默认名称
    const repoName = validated.githubUrl
      .replace(/\.git$/, '')
      .split('/')
      .slice(-2)
      .join('/');

    const codeBase = await prisma.codeBase.create({
      data: {
        name: validated.name?.trim() || repoName,
        description: validated.description,
        githubUrl: validated.githubUrl,
        branch: validated.branch || 'main',
        userId,
        status: 'pending',
      },
    });

    return NextResponse.json(codeBase, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message || '输入数据格式错误' }, { status: 400 });
    }
    console.error('Create codebase error:', error);
    return NextResponse.json({ error: '创建代码库失败' }, { status: 500 });
  }
}

