import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { lightragClient } from '@/lib/lightrag-client';
import { prisma } from '@/lib/prisma';

// SSE 响应头
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
};

// 发送 SSE 事件
function sendEvent(controller: ReadableStreamDefaultController, event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(new TextEncoder().encode(message));
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const body = await request.json();
    const { kb_id } = body;

    if (!kb_id) {
      return NextResponse.json({ error: '缺少知识库 ID' }, { status: 400 });
    }

    // 检查 LightRAG 服务是否可用
    const available = await lightragClient.isAvailable();
    if (!available) {
      return NextResponse.json({ 
        error: 'LightRAG 服务未启动。请运行 ./dev.sh start 启动服务。' 
      }, { status: 503 });
    }

    // 获取知识库的所有已完成文档
    const documents = await prisma.document.findMany({
      where: {
        knowledgeBaseId: kb_id,
        status: 'completed',
      },
      select: {
        id: true,
        name: true,
        content: true,
      },
    });

    if (documents.length === 0) {
      return NextResponse.json({ error: '没有可索引的文档' }, { status: 400 });
    }

    // 过滤有内容的文档
    const docsWithContent = documents.filter(d => d.content && d.content.length > 0);
    
    if (docsWithContent.length === 0) {
      return NextResponse.json({ error: '文档没有内容，请重新上传' }, { status: 400 });
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        try {
          sendEvent(controller, 'start', { 
            message: '开始构建知识图谱...',
            total: docsWithContent.length,
          });

          // 准备文档数据
          const lightragDocs = docsWithContent.map(doc => ({
            id: doc.id,
            name: doc.name,
            content: doc.content!,
          }));

          sendEvent(controller, 'progress', { 
            message: `准备索引 ${lightragDocs.length} 个文档...`,
            progress: 10,
          });

          // 调用 LightRAG 索引（异步，不等待完成）
          const result = await lightragClient.index({
            kb_id,
            documents: lightragDocs,
          });

          sendEvent(controller, 'progress', { 
            message: '索引任务已提交到 LightRAG 服务',
            progress: 30,
          });

          // 轮询检查索引状态
          let attempts = 0;
          const maxAttempts = 60; // 最多等待 2 分钟
          
          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 每 2 秒检查一次
            attempts++;

            try {
              const status = await lightragClient.getIndexStatus(kb_id);
              
              sendEvent(controller, 'progress', {
                message: status.message || `处理中... (${attempts}/${maxAttempts})`,
                progress: Math.min(30 + (status.progress * 60), 90),
                status: status.status,
              });

              if (status.status === 'completed') {
                sendEvent(controller, 'complete', {
                  message: `✅ 知识图谱构建完成！已索引 ${docsWithContent.length} 个文档`,
                  progress: 100,
                  status: 'completed', // 明确的状态字段
                });
                break;
              }

              if (status.status === 'failed') {
                sendEvent(controller, 'error', {
                  message: `索引失败: ${status.message}`,
                  status: 'failed', // 明确的状态字段
                  error: status.message,
                });
                break;
              }
            } catch (e) {
              // 检查状态失败，继续等待
              console.log('Check status failed, continuing...', e);
            }
          }

          if (attempts >= maxAttempts) {
            // 超时 - 但任务可能还在后台运行
            sendEvent(controller, 'timeout', {
              message: '⏰ 索引任务仍在后台执行中，请稍后刷新页面查看结果',
              progress: 90,
              status: 'pending', // 不确定状态
            });
          }

        } catch (error: any) {
          sendEvent(controller, 'error', {
            message: `索引失败: ${error.message}`,
            status: 'failed',
            error: error.message,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error: any) {
    console.error('LightRAG index error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
