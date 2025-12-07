import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import * as fs from 'fs-extra';

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const document = await prisma.document.findUnique({
      where: { id: params.id },
      include: { knowledgeBase: true },
    });

    if (!document) {
      return NextResponse.json({ error: '文档不存在' }, { status: 404 });
    }

    if (document.knowledgeBase.userId !== userId) {
      return NextResponse.json({ error: '无权删除此文档' }, { status: 403 });
    }

    // 删除文件
    if (await fs.pathExists(document.path)) {
      await fs.remove(document.path);
    }

    // 删除数据库记录
    await prisma.document.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('Delete document error:', error);
    return NextResponse.json({ error: '删除文档失败' }, { status: 500 });
  }
}

