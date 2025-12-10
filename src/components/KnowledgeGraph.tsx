'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { X, ZoomIn, ZoomOut, Maximize2, RefreshCw, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 动态导入 react-force-graph-2d（只在客户端加载）
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
        <span className="text-zinc-500 text-sm">加载图谱可视化...</span>
      </div>
    </div>
  ),
});

interface GraphEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
}

interface GraphRelation {
  source: string;
  target: string;
  type: string;
  description?: string;
}

interface KnowledgeGraphProps {
  kbId: string;
  onClose: () => void;
}

// 实体类型颜色映射（浅色主题适配）
const TYPE_COLORS: Record<string, string> = {
  PERSON: '#ec4899',     // 粉色
  ORGANIZATION: '#3b82f6', // 蓝色
  LOCATION: '#22c55e',   // 绿色
  DATE: '#f59e0b',       // 黄色
  EVENT: '#a855f7',      // 紫色
  CONCEPT: '#f97316',    // 橙色
  DOCUMENT: '#64748b',   // 灰色
  ENTITY: '#06b6d4',     // 青色
  UNKNOWN: '#9ca3af',    // 默认灰色
};

export default function KnowledgeGraph({ kbId, onClose }: KnowledgeGraphProps) {
  const graphRef = useRef<any>();
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [stats, setStats] = useState<{ entity_count: number; relation_count: number } | null>(null);

  // 获取图谱数据
  const fetchGraphData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/lightrag/graph/${kbId}`);
      
      if (!response.ok) {
        throw new Error('获取图谱数据失败');
      }
      
      const data = await response.json();
      
      if (data.entities.length === 0) {
        setError(data.message || '暂无图谱数据，请先构建知识图谱');
        return;
      }
      
      // 转换为 force-graph 格式
      const nodes = data.entities.map((entity: GraphEntity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        color: TYPE_COLORS[entity.type] || TYPE_COLORS.UNKNOWN,
        val: 10, // 节点大小
      }));
      
      // 创建节点 ID 集合用于验证
      const nodeIds = new Set(nodes.map((n: any) => n.id));
      
      // 只保留两端都存在的关系
      const links = data.relations
        .filter((rel: GraphRelation) => nodeIds.has(rel.source) && nodeIds.has(rel.target))
        .map((rel: GraphRelation) => ({
          source: rel.source,
          target: rel.target,
          type: rel.type,
          description: rel.description,
        }));
      
      setGraphData({ nodes, links });
      setStats(data.stats);
      
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    fetchGraphData();
  }, [fetchGraphData]);

  // 缩放控制
  const handleZoomIn = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() * 1.5, 400);
    }
  };

  const handleZoomOut = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() / 1.5, 400);
    }
  };

  const handleFitView = () => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(400);
    }
  };

  // 节点点击
  const handleNodeClick = (node: any) => {
    setSelectedNode(node);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
      <div className="relative w-[90vw] h-[85vh] bg-white rounded-2xl overflow-hidden shadow-2xl border border-zinc-200">
        {/* 头部 */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-white via-white/95 to-transparent px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-semibold text-zinc-900">知识图谱</h2>
              {stats && (
                <div className="flex gap-3 text-sm text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-cyan-500 rounded-full" />
                    {stats.entity_count} 个实体
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-zinc-400 rounded-full" />
                    {stats.relation_count} 条关系
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                onClick={fetchGraphData}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                onClick={handleZoomIn}
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                onClick={handleZoomOut}
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                onClick={handleFitView}
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                onClick={onClose}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* 图例 */}
        <div className="absolute bottom-4 left-4 z-10 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
          <div className="text-zinc-500 mb-2 font-medium">实体类型</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(TYPE_COLORS).slice(0, -1).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-zinc-600">{type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 选中节点信息 */}
        {selectedNode && (
          <div className="absolute top-20 right-4 z-10 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl p-4 max-w-xs shadow-lg">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: selectedNode.color }} 
                />
                <span className="text-zinc-900 font-medium">{selectedNode.name}</span>
              </div>
              <button 
                onClick={() => setSelectedNode(null)}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-zinc-500 mb-2">类型: {selectedNode.type}</div>
            {selectedNode.description && (
              <p className="text-sm text-zinc-600 leading-relaxed">
                {selectedNode.description}
              </p>
            )}
          </div>
        )}

        {/* 图谱区域 */}
        <div className="w-full h-full">
          {loading && (
            <div className="w-full h-full flex items-center justify-center bg-zinc-50">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                <span className="text-zinc-500">正在加载图谱数据...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="w-full h-full flex items-center justify-center bg-zinc-50">
              <div className="flex flex-col items-center gap-4 text-center px-8">
                <Info className="w-12 h-12 text-zinc-400" />
                <div className="text-zinc-500 max-w-md">{error}</div>
                <Button onClick={fetchGraphData} variant="outline" size="sm">
                  重试
                </Button>
              </div>
            </div>
          )}

          {!loading && !error && graphData && (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              nodeLabel={(node: any) => `${node.name}\n[${node.type}]`}
              nodeColor={(node: any) => node.color}
              nodeRelSize={6}
              linkColor={() => 'rgba(148, 163, 184, 0.5)'}
              linkWidth={1.5}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              linkLabel={(link: any) => link.type}
              onNodeClick={handleNodeClick}
              backgroundColor="#fafafa"
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                // 绘制节点
                const size = 6;
                ctx.beginPath();
                ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
                ctx.fillStyle = node.color;
                ctx.fill();
                
                // 绘制标签（缩放足够大时）
                if (globalScale > 1) {
                  const label = node.name.length > 10 ? node.name.slice(0, 10) + '...' : node.name;
                  const fontSize = 12 / globalScale;
                  ctx.font = `${fontSize}px Sans-Serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillStyle = '#3f3f46';
                  ctx.fillText(label, node.x, node.y + size + fontSize);
                }
              }}
              cooldownTicks={100}
              onEngineStop={() => graphRef.current?.zoomToFit(400)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
