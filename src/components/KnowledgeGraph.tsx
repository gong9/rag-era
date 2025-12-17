'use client';

// @ts-ignore
import React, { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { X, ZoomIn, ZoomOut, Maximize2, RefreshCw, Info, Search, Layers, Box, GitBranch, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 动态导入 react-force-graph-2d
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

// 视图类型
type ViewType = 'module' | 'symbol' | 'call';

interface KnowledgeGraphProps {
  codeBaseId: string;
  onClose: () => void;
}

// 颜色配置
const MODULE_COLORS = {
  module: '#8b5cf6',      // 紫色 - 模块
  dependency: '#94a3b8',  // 灰色 - 依赖关系
};

const SYMBOL_COLORS: Record<string, string> = {
  function: '#3b82f6',    // 蓝色
  class: '#a855f7',       // 紫色
  method: '#22c55e',      // 绿色
  interface: '#f59e0b',   // 黄色
  variable: '#64748b',    // 灰色
  default: '#06b6d4',     // 青色
};

export default function KnowledgeGraph({ codeBaseId, onClose }: KnowledgeGraphProps) {
  const graphRef = useRef<any>();
  const [viewType, setViewType] = useState<ViewType>('module');
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
        symbolCount: m._count?.symbols || 0,
        color: MODULE_COLORS.module,
        val: 15 + (m._count?.symbols || 0) / 10,
      }));
      
      const links = (data.dependencies || []).map((d: any) => ({
        source: d.fromId,
        target: d.toId,
        type: d.type,
      }));
      
      setGraphData({ nodes, links });
      setStats({
        moduleCount: data.modules.length,
        dependencyCount: data.dependencies?.length || 0,
      });
      
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [codeBaseId]);

  // 获取符号图数据
  const fetchSymbolGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/codebases/${codeBaseId}/call-graph?action=overview&includeModules=true`);
      
      if (!response.ok) {
        throw new Error('获取符号图数据失败');
      }
      
      const data = await response.json();
      
      if (!data.nodes || data.nodes.length === 0) {
        setError('暂无符号数据');
        return;
      }
      
      const nodes = data.nodes.map((node: any) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        file: node.file,
        line: node.line,
        module: node.module,
        color: SYMBOL_COLORS[node.type] || SYMBOL_COLORS.default,
        val: node.type === 'class' ? 15 : 10,
      }));
      
      const nodeIds = new Set(nodes.map((n: any) => n.id));
      const links = (data.edges || [])
        .filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map((e: any) => ({
          source: e.source,
          target: e.target,
          crossModule: e.crossModule,
        }));
      
      setGraphData({ nodes, links });
      setStats({
        symbolCount: nodes.length,
        callCount: links.length,
      });
      
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [codeBaseId]);

  // 获取调用图数据
  const fetchCallGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/codebases/${codeBaseId}/call-graph?action=overview`);
      
      if (!response.ok) {
        throw new Error('获取调用图数据失败');
      }
      
      const data = await response.json();
      
      if (!data.nodes || data.nodes.length === 0) {
        setError('暂无调用图数据');
        return;
      }
      
      const nodes = data.nodes.map((node: any) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        file: node.file,
        line: node.line,
        signature: node.signature,
        color: SYMBOL_COLORS[node.type] || SYMBOL_COLORS.default,
        val: node.type === 'class' ? 15 : 10,
      }));
      
      const nodeIds = new Set(nodes.map((n: any) => n.id));
      const links = (data.edges || [])
        .filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map((e: any) => ({
          source: e.source,
          target: e.target,
        }));
      
      setGraphData({ nodes, links });
      setStats({
        symbolCount: nodes.length,
        callCount: links.length,
      });
      
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [codeBaseId]);

  // 搜索特定函数的调用链
  const searchCallChain = useCallback(async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/codebases/${codeBaseId}/call-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionName: searchQuery.trim(),
          depth: 3,
          direction: 'both',
        }),
      });
      
      if (!response.ok) {
        throw new Error('搜索调用链失败');
      }
      
      const data = await response.json();
      
      if (!data.nodes || data.nodes.length === 0) {
        setError(`未找到函数 "${searchQuery}" 的调用链`);
        return;
      }
      
      const nodes = data.nodes.map((node: any) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        file: node.file,
        line: node.line,
        signature: node.signature,
        color: SYMBOL_COLORS[node.type] || SYMBOL_COLORS.default,
        val: node.name === searchQuery ? 20 : 10,
      }));
      
      const nameToId = new Map(nodes.map((n: any) => [n.name, n.id]));
      const links = (data.edges || [])
        .filter((e: any) => nameToId.has(e.source) && nameToId.has(e.target))
        .map((e: any) => ({
          source: nameToId.get(e.source),
          target: nameToId.get(e.target),
        }));
      
      setGraphData({ nodes, links });
      
    } catch (err: any) {
      setError(err.message || '搜索失败');
    } finally {
      setLoading(false);
    }
  }, [codeBaseId, searchQuery]);

  // 切换视图时重新加载数据
  useEffect(() => {
    setSelectedNode(null);
    setSearchQuery('');
    
    switch (viewType) {
      case 'module':
        fetchModuleGraph();
        break;
      case 'symbol':
        fetchSymbolGraph();
        break;
      case 'call':
        fetchCallGraph();
        break;
    }
  }, [viewType, fetchModuleGraph, fetchSymbolGraph, fetchCallGraph]);

  // 缩放控制
  const handleZoomIn = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.5, 400);
  const handleZoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() / 1.5, 400);
  const handleFitView = () => graphRef.current?.zoomToFit(400);

  const handleReset = () => {
    setSearchQuery('');
    switch (viewType) {
      case 'module': fetchModuleGraph(); break;
      case 'symbol': fetchSymbolGraph(); break;
      case 'call': fetchCallGraph(); break;
    }
  };

  const handleNodeClick = (node: any) => setSelectedNode(node);

  // 视图配置
  const viewConfig = {
    module: { icon: Box, label: '模块图', description: 'Layer 1: 模块级架构' },
    symbol: { icon: Network, label: '符号图', description: 'Layer 2: 符号 + 模块归属' },
    call: { icon: GitBranch, label: '调用图', description: 'Layer 3: 调用关系' },
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
      <div className="relative w-[90vw] h-[85vh] bg-white rounded-2xl overflow-hidden shadow-2xl border border-zinc-200">
        {/* 头部 */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-white via-white/95 to-transparent px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* 视图切换 */}
              <div className="flex bg-zinc-100 rounded-lg p-1">
                {(Object.entries(viewConfig) as [ViewType, typeof viewConfig.module][]).map(([type, config]) => (
                  <button
                    key={type}
                    onClick={() => setViewType(type)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      viewType === type
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700'
                    }`}
                  >
                    <config.icon className="w-4 h-4" />
                    {config.label}
                  </button>
                ))}
              </div>
              
              {stats && (
                <div className="flex gap-3 text-sm text-zinc-500">
                  {viewType === 'module' ? (
                    <>
                      <span>{stats.moduleCount} 个模块</span>
                      <span>{stats.dependencyCount} 条依赖</span>
                    </>
                  ) : (
                    <>
                      <span>{stats.symbolCount} 个符号</span>
                      <span>{stats.callCount} 条调用</span>
                    </>
                  )}
                </div>
              )}
            </div>
            
            {/* 搜索框（仅调用图视图） */}
            {viewType === 'call' && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="搜索函数调用链..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchCallChain()}
                    className="w-48 pl-8 pr-3 py-1.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                </div>
                <Button size="sm" onClick={searchCallChain} className="bg-blue-600 hover:bg-blue-700 text-white">
                  搜索
                </Button>
              </div>
            )}
            
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={handleReset}><RefreshCw className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" onClick={handleZoomIn}><ZoomIn className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" onClick={handleZoomOut}><ZoomOut className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" onClick={handleFitView}><Maximize2 className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
            </div>
          </div>
          
          {/* 视图说明 */}
          <div className="mt-2 text-xs text-zinc-400">
            {viewConfig[viewType].description}
          </div>
        </div>

        {/* 图例 */}
        <div className="absolute bottom-4 left-4 z-10 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
          <div className="text-zinc-500 mb-2 font-medium">
            {viewType === 'module' ? '模块' : '符号类型'}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {viewType === 'module' ? (
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MODULE_COLORS.module }} />
                <span className="text-zinc-600">模块</span>
              </div>
            ) : (
              Object.entries(SYMBOL_COLORS).filter(([k]) => k !== 'default').map(([type, color]) => (
                <div key={type} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-zinc-600">{type}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 选中节点信息 */}
        {selectedNode && (
          <div className="absolute top-24 right-4 z-10 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl p-4 max-w-sm shadow-lg">
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
              {viewType === 'module' ? (
                <>
                  <div>路径: <span className="text-zinc-700">{selectedNode.path}</span></div>
                  <div>符号数: <span className="text-zinc-700">{selectedNode.symbolCount}</span></div>
                  {selectedNode.summary && (
                    <div className="mt-2 p-2 bg-zinc-100 rounded text-zinc-700">{selectedNode.summary}</div>
                  )}
                </>
              ) : (
                <>
                  <div>类型: <span className="text-zinc-700">{selectedNode.type}</span></div>
                  <div>文件: <span className="text-zinc-700">{selectedNode.file}</span></div>
                  <div>行号: <span className="text-zinc-700">{selectedNode.line}</span></div>
                  {selectedNode.module && <div>模块: <span className="text-zinc-700">{selectedNode.module}</span></div>}
                  {selectedNode.signature && (
                    <div className="mt-2 p-2 bg-zinc-100 rounded font-mono text-xs overflow-x-auto">{selectedNode.signature}</div>
                  )}
                </>
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
                <span className="text-zinc-500">正在加载 {viewConfig[viewType].label}...</span>
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
                <div className="flex gap-2">
                  <Button onClick={onClose} variant="outline" size="sm">关闭</Button>
                  <Button onClick={handleReset} variant="default" size="sm">重试</Button>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && graphData && (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              nodeLabel={(node: any) => viewType === 'module' 
                ? `${node.name}\n${node.path}\n${node.symbolCount} 个符号`
                : `${node.name}\n[${node.type}] ${node.file}:${node.line}`
              }
              nodeColor={(node: any) => node.color}
              nodeRelSize={6}
              linkColor={(link: any) => link.crossModule ? 'rgba(239, 68, 68, 0.5)' : 'rgba(148, 163, 184, 0.6)'}
              linkWidth={(link: any) => link.crossModule ? 2 : 1.5}
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
                
                if (node.val > 15) {
                  ctx.strokeStyle = '#ef4444';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                }
                
                if (globalScale > 0.8) {
                  const label = node.name.length > 15 ? node.name.slice(0, 15) + '...' : node.name;
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
