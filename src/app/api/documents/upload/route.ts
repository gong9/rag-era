import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LLMService } from '@/lib/llm';
import * as fs from 'fs-extra';
import * as path from 'path';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const knowledgeBaseId = formData.get('knowledgeBaseId') as string;

    if (!file || !knowledgeBaseId) {
      return NextResponse.json({ error: '缺少文件或知识库ID' }, { status: 400 });
    }

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

    // 验证文件类型
    const allowedExtensions = ['.txt', '.md', '.pdf', '.docx'];
    const fileExtension = path.extname(file.name).toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
      return NextResponse.json(
        { error: '不支持的文件类型，仅支持 TXT, MD, PDF, DOCX' },
        { status: 400 },
      );
    }

    // 创建上传目录
    const uploadDir = path.join(
      process.env.UPLOAD_DIR || './uploads',
      `kb_${knowledgeBaseId}`,
    );
    await fs.ensureDir(uploadDir);

    // 保存文件
    const fileName = `${Date.now()}_${file.name}`;
    const filePath = path.join(uploadDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // 创建文档记录（待处理状态）
    const document = await prisma.document.create({
      data: {
        name: file.name,
        path: filePath,
        knowledgeBaseId,
        status: 'pending', // 等待处理
      },
    });

    // 返回文档信息，前端将通过 SSE 触发处理
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }
}

// processDocument 函数已移至 SSE 处理端点

