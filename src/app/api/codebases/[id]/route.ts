import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import * as fs from 'fs-extra';
import * as path from 'path';

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

    // 不再返回完整的 codeFiles，改为按需加载
    const codeBase = await prisma.codeBase.findUnique({
      where: { id: codeBaseId },
      include: {
        _count: {
          select: { 
            codeFiles: true,
            repoModules: true,
            codeSymbols: true,
          },
        },
      },
    });

    if (!codeBase) {
      return NextResponse.json({ error: '代码库不存在' }, { status: 404 });
    }

    if (codeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此代码库' }, { status: 403 });
    }

    return NextResponse.json(codeBase);
  } catch (error) {
    console.error('Get codebase error:', error);
    return NextResponse.json({ error: '获取代码库失败' }, { status: 500 });
  }
}

export async function DELETE(
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

    // 验证所有权
    const codeBase = await prisma.codeBase.findUnique({
      where: { id: codeBaseId },
    });

    if (!codeBase) {
      return NextResponse.json({ error: '代码库不存在' }, { status: 404 });
    }

    if (codeBase.userId !== userId) {
      return NextResponse.json({ error: '无权删除此代码库' }, { status: 403 });
    }

    // 删除存储的文件
    const storageDir = path.join(
      process.env.STORAGE_DIR || './storage',
      `codebase_${codeBaseId}`
    );
    if (await fs.pathExists(storageDir)) {
      await fs.remove(storageDir);
    }

    // 删除克隆的仓库目录
    const repoDir = path.join(
      process.env.UPLOAD_DIR || './uploads',
      `codebase_${codeBaseId}`
    );
    if (await fs.pathExists(repoDir)) {
      await fs.remove(repoDir);
    }

    // 删除数据库记录
    await prisma.codeBase.delete({
      where: { id: codeBaseId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete codebase error:', error);
    return NextResponse.json({ error: '删除代码库失败' }, { status: 500 });
  }
}

