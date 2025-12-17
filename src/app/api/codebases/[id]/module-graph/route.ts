import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * 获取模块图数据
 */
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

    // 获取所有模块
    const modules = await prisma.repoModule.findMany({
      where: { codeBaseId },
      select: {
        id: true,
        name: true,
        path: true,
        summary: true,
        responsibilities: true,
        publicAPI: true,
        deepIndexed: true,
        _count: {
          select: {
            symbols: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // 获取模块依赖关系
    const dependencies = await prisma.moduleDependency.findMany({
      where: {
        from: { codeBaseId },
      },
      select: {
        fromId: true,
        toId: true,
        type: true,
      },
    });

    // 转换格式
    const formattedModules = modules.map(m => ({
      id: m.id,
      name: m.name,
      path: m.path,
      summary: m.summary,
      responsibilities: m.responsibilities ? JSON.parse(m.responsibilities) : [],
      publicAPI: m.publicAPI ? JSON.parse(m.publicAPI) : [],
      deepIndexed: m.deepIndexed,
      symbolCount: m._count.symbols,
    }));

    return NextResponse.json({
      modules: formattedModules,
      dependencies,
      stats: {
        moduleCount: modules.length,
        dependencyCount: dependencies.length,
        deepIndexedCount: modules.filter(m => m.deepIndexed).length,
      },
    });
  } catch (error: any) {
    console.error('Module graph API error:', error);
    return NextResponse.json({ error: error.message || '获取模块图失败' }, { status: 500 });
  }
}
