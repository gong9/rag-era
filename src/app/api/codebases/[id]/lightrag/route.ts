import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { lightragClient } from '@/lib/lightrag-client';
import { prisma } from '@/lib/prisma';
import { shouldIncludeForLightRAG } from '@/lib/github/repo-fetcher';

// SSE 响应头
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
};

// 发送 SSE 事件（带错误处理）
function createSafeEventSender(controller: ReadableStreamDefaultController) {
  let isClosed = false;
  
  const sendEvent = (event: string, data: any) => {
    if (isClosed) return false;
    try {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(new TextEncoder().encode(message));
      return true;
    } catch (e) {
      isClosed = true;
      console.log('[LightRAG] Stream closed by client');
      return false;
    }
  };
  
  const markClosed = () => { isClosed = true; };
  const isClosedFn = () => isClosed;
  
  return { sendEvent, markClosed, isClosed: isClosedFn };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    // 解析请求体获取选项
    let quickMode = true; // 默认使用快速模式
    try {
      const body = await request.json();
      quickMode = body.quickMode !== false; // 除非明确设置为 false，否则使用快速模式
    } catch {
      // 没有请求体，使用默认值
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

    if (codeBase.status !== 'completed') {
      return NextResponse.json({ error: '代码库尚未完成索引，请先完成基础索引' }, { status: 400 });
    }

    // 检查 LightRAG 服务是否可用
    const available = await lightragClient.isAvailable();
    if (!available) {
      return NextResponse.json({ 
        error: 'LightRAG 服务未启动。请运行 ./dev.sh start 启动服务。' 
      }, { status: 503 });
    }

    // 获取代码库的所有代码文件
    const codeFiles = await prisma.codeFile.findMany({
      where: {
        codeBaseId: codeBaseId,
      },
      select: {
        id: true,
        path: true,
        language: true,
        content: true,
      },
    });

    if (codeFiles.length === 0) {
      return NextResponse.json({ error: '没有可索引的代码文件' }, { status: 400 });
    }

    // 读取代码文件内容
    const fs = await import('fs-extra');
    const path = await import('path');
    const uploadsDir = path.join(
      process.env.UPLOADS_DIR || './uploads',
      `codebase_${codeBaseId}`
    );

    // 创建 SSE 流
    let streamHelper: ReturnType<typeof createSafeEventSender> | null = null;
    
    const stream = new ReadableStream({
      async start(controller) {
        streamHelper = createSafeEventSender(controller);
        const { sendEvent, isClosed } = streamHelper;
        
        try {
          // 过滤文件：只处理核心代码，排除测试、示例、文档等
          const filteredFiles = codeFiles.filter(file => {
            // 只处理核心代码语言
            const coreLanguages = ['ts', 'tsx', 'js', 'jsx', 'vue', 'py', 'go', 'rs', 'java'];
            if (!coreLanguages.includes(file.language)) {
              return false;
            }
            // 应用 LightRAG 过滤规则（使用快速模式时只处理核心目录）
            return shouldIncludeForLightRAG(file.path, quickMode);
          });

          const skipped = codeFiles.length - filteredFiles.length;
          const modeLabel = quickMode ? '快速模式' : '完整模式';
          console.log(`[LightRAG] ${modeLabel}: Filtered ${filteredFiles.length}/${codeFiles.length} files (skipped ${skipped})`);

          sendEvent('start', { 
            message: `开始构建代码知识图谱... (${filteredFiles.length}/${codeFiles.length} 核心文件)`,
            total: filteredFiles.length,
            skipped: skipped,
          });

          // 准备文档数据（直接使用数据库中存储的内容）
          const lightragDocs: { id: string; name: string; content: string }[] = [];
          
          for (const file of filteredFiles) {
            // 优先使用数据库中的内容
            let content = file.content;
            
            // 如果数据库中没有内容，尝试从文件系统读取
            if (!content) {
              try {
                const filePath = path.join(uploadsDir, file.path);
                if (await fs.pathExists(filePath)) {
                  content = await fs.readFile(filePath, 'utf-8');
                }
              } catch (e) {
                console.error(`[LightRAG] Failed to read file ${file.path}:`, e);
              }
            }
            
            if (content) {
              // 为代码添加元信息，帮助 LightRAG 理解代码结构
              const enrichedContent = `
# 文件: ${file.path}
# 语言: ${file.language || '未知'}

${content}

---
文件路径: ${file.path}
`.trim();

              lightragDocs.push({
                id: file.id,
                name: file.path, // 使用完整路径作为名称
                content: enrichedContent,
              });
            }
          }

          if (lightragDocs.length === 0) {
            sendEvent('error', {
              message: '没有可读取的代码文件内容',
              status: 'failed',
            });
            controller.close();
            return;
          }

          sendEvent('progress', { 
            message: `准备索引 ${lightragDocs.length} 个代码文件...`,
            progress: 10,
          });

          // 使用 codebase_ 前缀区分代码库的知识图谱
          const graphId = `codebase_${codeBaseId}`;

          // 调用 LightRAG 索引
          await lightragClient.index({
            kb_id: graphId,
            documents: lightragDocs,
          });

          sendEvent('progress', { 
            message: '索引任务已提交到 LightRAG 服务',
            progress: 30,
          });

          // 轮询检查索引状态
          let attempts = 0;
          const maxAttempts = 120; // 代码库可能更大，最多等待 4 分钟
          
          while (attempts < maxAttempts && !isClosed()) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 每 2 秒检查一次
            attempts++;

            // 如果流已关闭，停止轮询
            if (isClosed()) {
              console.log('[LightRAG] Client disconnected, stopping poll');
              break;
            }

            try {
              const status = await lightragClient.getIndexStatus(graphId);
              
              sendEvent('progress', {
                message: status.message || `处理中... (${attempts}/${maxAttempts})`,
                progress: Math.min(30 + (status.progress * 60), 90),
                status: status.status,
              });

              if (status.status === 'completed') {
                sendEvent('complete', {
                  message: `✅ 代码知识图谱构建完成！已索引 ${lightragDocs.length} 个文件`,
                  progress: 100,
                  status: 'completed',
                });
                break;
              }

              if (status.status === 'failed') {
                sendEvent('error', {
                  message: `索引失败: ${status.message}`,
                  status: 'failed',
                  error: status.message,
                });
                break;
              }
            } catch (e) {
              // 检查状态失败，继续等待
              console.log('[LightRAG] Check status failed, continuing...', e);
            }
          }

          if (attempts >= maxAttempts && !isClosed()) {
            sendEvent('timeout', {
              message: '⏰ 索引任务仍在后台执行中，请稍后刷新页面查看结果',
              progress: 90,
              status: 'pending',
            });
          }

        } catch (error: any) {
          console.error('[LightRAG] Codebase index error:', error);
          sendEvent('error', {
            message: `索引失败: ${error.message}`,
            status: 'failed',
            error: error.message,
          });
        } finally {
          controller.close();
        }
      },
      cancel() {
        console.log('[LightRAG] Client disconnected, cleaning up...');
        if (streamHelper) {
          streamHelper.markClosed();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error: any) {
    console.error('[LightRAG] Codebase index error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 获取知识图谱状态
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

    // 检查 LightRAG 服务是否可用
    const available = await lightragClient.isAvailable();
    if (!available) {
      return NextResponse.json({ 
        available: false,
        status: 'unavailable',
        message: 'LightRAG 服务未启动'
      });
    }

    const graphId = `codebase_${codeBaseId}`;

    try {
      const status = await lightragClient.getIndexStatus(graphId);
      return NextResponse.json({
        available: true,
        ...status,
      });
    } catch (e) {
      return NextResponse.json({
        available: true,
        status: 'not_indexed',
        message: '尚未构建知识图谱',
      });
    }
  } catch (error: any) {
    console.error('[LightRAG] Get status error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

