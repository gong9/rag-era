'use client';

// @ts-ignore
import React, { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { X, ZoomIn, ZoomOut, Maximize2, RefreshCw, Info, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 动态导入 react-force-graph-2d
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
        <span className="text-zinc-500 text-sm">加载模块图...</span>
      </div>
    </div>
  ),
});

// ==================== 类型定义 ====================

interface GraphNode {
  id: string;
  name: string;
  type: string;
  path?: string;
  summary?: string;
  color?: string;
  val?: number;
}

interface KnowledgeGraphV2Props {
  codeBaseId: string;
  onClose: () => void;
}

// ==================== 颜色配置 ====================

const MODULE_COLORS = {
  module: '#8b5cf6',      // 紫色
  dependency: '#94a3b8',  // 灰色边
};

// ==================== 组件 ====================

export default function KnowledgeGraphV2({ codeBaseId, onClose }: KnowledgeGraphV2Props) {
  const graphRef = useRef<any>();
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);

  // ==================== 数据获取 ====================

  // 获取模块图数据
  const fetchModuleGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/codebases/${codeBaseId}/module-graph`);
      
      if (!response.ok) {
        throw new Error('获取模块图数据失败');
      }
      
      const data = await response.json();
      
      if (!data.modules || data.modules.length === 0) {
        setError('暂无模块数据，请先处理代码库');
        return;
      }
      
      // 转换为 force-graph 格式
      const nodes = data.modules.map((m: any) => ({
        id: m.id,
        name: m.name,
        type: 'module',
        path: m.path,
        summary: m.summary,
        color: MODULE_COLORS.module,
        val: 20,
      }));
      
      const nodeIds = new Set(nodes.map((n: any) => n.id));
      
      const links = (data.dependencies || [])
        .filter((d: any) => nodeIds.has(d.fromId) && nodeIds.has(d.toId))
        .map((d: any) => ({
          source: d.fromId,
          target: d.toId,
          type: d.type,
        }));
      
      setGraphData({ nodes, links });
      setStats({
        moduleCount: data.modules.length,
        dependencyCount: links.length,
      });
      
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [codeBaseId]);

  // ==================== Effects ====================

  useEffect(() => {
    fetchModuleGraph();
  }, [fetchModuleGraph]);

  // ==================== 控制函数 ====================

  const handleZoomIn = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.5, 400);
  const handleZoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() / 1.5, 400);
  const handleFitView = () => graphRef.current?.zoomToFit(400);
  const handleRefresh = () => fetchModuleGraph();
  const handleNodeClick = (node: any) => setSelectedNode(node);

  // ==================== 渲染 ====================

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
      <div className="relative w-[90vw] h-[85vh] bg-white rounded-2xl overflow-hidden shadow-2xl border border-zinc-200">
        {/* 头部 */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-white via-white/95 to-transparent px-6 py-4">
          <div className="flex items-center justify-between">
            {/* 左侧：标题 */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Box className="w-5 h-5 text-zinc-600" />
                <h2 className="text-xl font-semibold text-zinc-900">模块图</h2>
              </div>
              
              {/* 统计信息 */}
              {stats && (
                <div className="flex gap-3 text-sm text-zinc-500">
                  <span>{stats.moduleCount} 个模块</span>
                  <span>{stats.dependencyCount} 条依赖</span>
                </div>
              )}
            </div>

            {/* 右侧：控制 */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={handleRefresh}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={handleZoomIn}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={handleZoomOut}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={handleFitView}>
                <Maximize2 className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* 图例 */}
        <div className="absolute bottom-4 left-4 z-10 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
          <div className="text-zinc-500 mb-2 font-medium">图例</div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MODULE_COLORS.module }} />
            <span className="text-zinc-600">模块</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-4 h-0.5" style={{ backgroundColor: MODULE_COLORS.dependency }} />
            <span className="text-zinc-600">依赖关系</span>
          </div>
        </div>

        {/* 选中节点信息 */}
        {selectedNode && (
          <div className="absolute top-20 right-4 z-10 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl p-4 max-w-sm shadow-lg">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedNode.color }} />
                <span className="text-zinc-900 font-medium">{selectedNode.name}</span>
              </div>
              <button onClick={() => setSelectedNode(null)} className="text-zinc-400 hover:text-zinc-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1 text-xs text-zinc-500">
              {selectedNode.path && <div>路径: <span className="text-zinc-700">{selectedNode.path}</span></div>}
              {selectedNode.summary && (
                <div className="mt-2 p-2 bg-zinc-100 rounded text-xs">
                  {selectedNode.summary}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 图谱区域 */}
        <div className="w-full h-full">
          {loading && (
            <div className="w-full h-full flex items-center justify-center bg-zinc-50">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                <span className="text-zinc-500">正在加载模块图...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="w-full h-full flex items-center justify-center bg-zinc-50">
              <div className="flex flex-col items-center gap-4 text-center px-8">
                <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
                  <Info className="w-8 h-8 text-amber-500" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-zinc-900 font-medium">数据不可用</h3>
                  <p className="text-zinc-500 max-w-md text-sm">{error}</p>
                </div>
                <Button onClick={handleRefresh} variant="default" size="sm">
                  <RefreshCw className="w-4 h-4 mr-1" />
                  刷新
                </Button>
              </div>
            </div>
          )}

          {!loading && !error && graphData && (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              nodeLabel={(node: any) => `${node.name}\n${node.path}\n${node.summary || ''}`}
              nodeColor={(node: any) => node.color}
              nodeRelSize={6}
              linkColor={() => MODULE_COLORS.dependency}
              linkWidth={1.5}
              linkDirectionalArrowLength={5}
              linkDirectionalArrowRelPos={1}
              onNodeClick={handleNodeClick}
              backgroundColor="#fafafa"
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                const size = node.val / 2 || 5;
                ctx.beginPath();
                ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
                ctx.fillStyle = node.color;
                ctx.fill();
                
                if (globalScale > 0.6) {
                  const label = node.name.length > 20 ? node.name.slice(0, 20) + '...' : node.name;
                  const fontSize = Math.min(14, 12 / globalScale);
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
