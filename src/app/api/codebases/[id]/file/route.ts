import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const codeBaseId = params.id;

    // 获取查询参数
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    const startLine = parseInt(url.searchParams.get('startLine') || '1');
    const endLine = parseInt(url.searchParams.get('endLine') || '0');

    if (!filePath) {
      return NextResponse.json({ error: '缺少文件路径参数' }, { status: 400 });
    }

    // 验证代码库所有权
    const codeBase = await prisma.codeBase.findUnique({
      where: { id: codeBaseId },
    });

    if (!codeBase) {
      return NextResponse.json({ error: '代码库不存在' }, { status: 404 });
    }

    if (codeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此代码库' }, { status: 403 });
    }

    // 查找文件
    const codeFile = await prisma.codeFile.findFirst({
      where: {
        codeBaseId,
        path: filePath,
      },
      select: {
        id: true,
        path: true,
        content: true,
        language: true,
        lineCount: true,
      },
    });

    if (!codeFile) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 如果指定了行号范围，提取对应的行
    let content = codeFile.content || '';
    let actualStartLine = startLine;
    let actualEndLine = endLine;

    if (content && (startLine > 1 || endLine > 0)) {
      const lines = content.split('\n');
      const start = Math.max(1, startLine) - 1;
      const end = endLine > 0 ? Math.min(lines.length, endLine) : lines.length;
      content = lines.slice(start, end).join('\n');
      actualStartLine = start + 1;
      actualEndLine = end;
    }

    return NextResponse.json({
      filePath: codeFile.path,
      content,
      language: codeFile.language,
      lineCount: codeFile.lineCount,
      startLine: actualStartLine,
      endLine: actualEndLine || codeFile.lineCount,
    });
  } catch (error: any) {
    console.error('Get file content error:', error);
    return NextResponse.json({ error: error.message || '获取文件内容失败' }, { status: 500 });
  }
}

