/**
 * SSE 流式评估端点
 * 
 * GET /api/eval/stream/[id] - 订阅评估进度的实时推送
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { EvalService } from '@/lib/eval-service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * SSE 事件类型
 */
type SSEEventType = 
  | 'connected'      // 连接成功
  | 'progress'       // 问题评估完成
  | 'completed'      // 全部完成
  | 'error';         // 错误

/**
 * 发送 SSE 事件
 */
function sendEvent(
  controller: ReadableStreamDefaultController,
  event: SSEEventType,
  data: any
) {
  const encoder = new TextEncoder();
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

/**
 * GET /api/eval/stream/[id]
 * SSE 端点：实时推送评估进度
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id: evalRunId } = await params;

  // 创建 SSE 流
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 发送连接成功事件
        sendEvent(controller, 'connected', { evalRunId });

        // 定义进度回调
        const onProgress = (data: {
          questionId: string;
          question: string;
          scores: {
            retrieval: number;
            faithfulness: number;
            quality: number;
            tool: number;
            average: number;
          };
          progress: {
            completed: number;
            total: number;
          };
        }) => {
          sendEvent(controller, 'progress', data);
        };

        // 运行评估（带回调）
        const result = await EvalService.runEvaluationWithCallback(
          evalRunId,
          onProgress
        );

        // 发送完成事件
        sendEvent(controller, 'completed', result);

        // 关闭流
        controller.close();
      } catch (error: any) {
        console.error('[SSE] Evaluation error:', error);
        sendEvent(controller, 'error', { message: error.message });
        controller.close();
      }
    },
    cancel() {
      console.log('[SSE] Client disconnected');
    },
  });

  // 返回 SSE 响应
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

