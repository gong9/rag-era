import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * 按需加载文件树 API
 * GET /api/codebases/[id]/files/tree?path=packages
 * 
 * 返回指定目录下的直接子文件和子文件夹
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
    
    // 获取查询参数 path，默认为空（根目录）
    const { searchParams } = new URL(request.url);
    const parentPath = searchParams.get('path') || '';

    // 验证代码库所有权
    const codeBase = await prisma.codeBase.findUnique({
      where: { id: codeBaseId },
      select: { userId: true },
    });

    if (!codeBase) {
      return NextResponse.json({ error: '代码库不存在' }, { status: 404 });
    }

    if (codeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此代码库' }, { status: 403 });
    }

    // 查询该目录下的所有文件
    // 使用 path LIKE 'parentPath/%' 来匹配子路径
    const files = await prisma.codeFile.findMany({
      where: {
        codeBaseId,
        path: parentPath 
          ? { startsWith: parentPath + '/' }
          : { not: '' }, // 根目录查所有
      },
      select: {
        id: true,
        path: true,
        language: true,
        lineCount: true,
      },
      orderBy: { path: 'asc' },
    });

    // 构建当前目录的直接子项
    const items: Array<{
      name: string;
      path: string;
      type: 'file' | 'folder';
      language?: string;
      lineCount?: number;
      childCount?: number;
    }> = [];

    const seenFolders = new Set<string>();
    const folderChildCounts = new Map<string, number>();

    for (const file of files) {
      // 获取相对于 parentPath 的路径
      const relativePath = parentPath 
        ? file.path.slice(parentPath.length + 1)
        : file.path;
      
      const parts = relativePath.split('/');
      
      if (parts.length === 1) {
        // 直接子文件
        items.push({
          name: parts[0],
          path: file.path,
          type: 'file',
          language: file.language,
          lineCount: file.lineCount,
        });
      } else {
        // 子文件夹
        const folderName = parts[0];
        const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
        
        // 计算文件夹下的文件数
        folderChildCounts.set(folderPath, (folderChildCounts.get(folderPath) || 0) + 1);
        
        if (!seenFolders.has(folderPath)) {
          seenFolders.add(folderPath);
          items.push({
            name: folderName,
            path: folderPath,
            type: 'folder',
          });
        }
      }
    }

    // 添加子文件数量到文件夹
    for (const item of items) {
      if (item.type === 'folder') {
        item.childCount = folderChildCounts.get(item.path) || 0;
      }
    }

    // 排序：文件夹在前，文件在后，各自按名称排序
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      path: parentPath,
      items,
    });
  } catch (error) {
    console.error('Get file tree error:', error);
    return NextResponse.json({ error: '获取文件树失败' }, { status: 500 });
  }
}

