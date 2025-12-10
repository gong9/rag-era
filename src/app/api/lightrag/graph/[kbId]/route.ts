import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { lightragClient } from '@/lib/lightrag-client';

export async function GET(
  request: Request,
  { params }: { params: { kbId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');

    // 检查 LightRAG 服务是否可用
    const available = await lightragClient.isAvailable();
    if (!available) {
      return NextResponse.json({
        kb_id: params.kbId,
        entities: [],
        relations: [],
        message: 'LightRAG 服务未启动',
      });
    }

    // 获取图谱数据
    const graphData = await lightragClient.getGraph(params.kbId, limit);
    
    return NextResponse.json(graphData);
  } catch (error: any) {
    console.error('Get graph error:', error);
    return NextResponse.json({
      kb_id: params.kbId,
      entities: [],
      relations: [],
      message: error.message || '获取图谱数据失败',
    });
  }
}

