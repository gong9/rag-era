'use client';

// @ts-ignore
import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  ArrowLeft, Github, Code2, FileCode, CheckCircle, XCircle, Clock, 
  RefreshCw, MessageSquare, Folder, ChevronRight, ChevronDown,
  Loader2, AlertCircle, BarChart3
} from 'lucide-react';
import { formatDate, cn } from '@/lib/utils';

// 动态导入模块图谱可视化组件
const KnowledgeGraphV2 = dynamic(() => import('@/components/KnowledgeGraphV2'), {
  ssr: false,
  loading: () => null,
});

interface CodeBase {
  id: string;
  name: string;
  description: string | null;
  githubUrl: string;
  branch: string;
  status: string;
  errorMessage: string | null;
  fileCount: number;
  lastSyncAt: string | null;
  createdAt: string;
  // DeepWiki 架构字段
  repoType: string | null;
  mainLanguage: string | null;
  _count: {
    codeFiles: number;
    repoModules?: number;
    codeSymbols?: number;
  };
}

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  language?: string;
  lineCount?: number;
  childCount?: number;  // 文件夹下的文件数
  children?: FileTreeNode[];
  loaded?: boolean;     // 是否已加载子项
  loading?: boolean;    // 是否正在加载
}

export default function CodeBaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [codeBase, setCodeBase] = useState<CodeBase | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  
  // 模块图谱可视化
  const [showKnowledgeGraph, setShowKnowledgeGraph] = useState(false);

  useEffect(() => {
    fetchCodeBase();
  }, [params.id]);

  // 加载根目录文件树
  useEffect(() => {
    if (codeBase?.status === 'completed' && fileTree.length === 0) {
      loadFileTree('');
    }
  }, [codeBase?.status]);

  // 如果状态是 pending 或正在进行中，自动开始/恢复处理
  useEffect(() => {
    const status = codeBase?.status;
    // pending: 新创建，需要开始处理
    // cloning/parsing/indexing: 进行中状态，可能是刷新页面导致断开，需要恢复
    if (status === 'pending' || status === 'cloning' || status === 'parsing' || status === 'indexing') {
      startProcessing();
    }
  }, [codeBase?.status]);

  const fetchCodeBase = async () => {
    try {
      const response = await fetch(`/api/codebases/${params.id}`);
      if (response.ok) {
        const data = await response.json();
        setCodeBase(data);
      } else {
        router.push('/dashboard/codebase');
      }
    } catch (error) {
      console.error('获取代码库失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const startProcessing = async () => {
    if (processing) return;
    setProcessing(true);
    setProgress(0);
    setProgressMessage('准备中...');

    try {
      const eventSource = new EventSource(`/api/codebases/${params.id}/process`);
      
      eventSource.addEventListener('status', (e) => {
        const data = JSON.parse(e.data);
        setProgress(data.progress || 0);
        setProgressMessage(data.message || '处理中...');
        
        // 更新本地状态
        setCodeBase((prev: CodeBase | null) => prev ? { ...prev, status: data.status } : prev);
      });

      eventSource.addEventListener('heartbeat', (e) => {
        const data = JSON.parse(e.data);
        setProgress(data.progress || 0);
      });

      eventSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        setProgress(100);
        setProgressMessage(data.message || '处理完成！');
        setProcessing(false);
        eventSource.close();
        
        // 立即更新本地状态为 completed
        setCodeBase((prev: CodeBase | null) => prev ? { ...prev, status: 'completed', lastSyncAt: new Date().toISOString() } : prev);
        
        // 刷新完整数据并加载文件树
        setTimeout(() => {
          fetchCodeBase();
          loadFileTree('');
        }, 1000);
      });

      eventSource.addEventListener('error', (e: any) => {
        console.error('[SSE] Error:', e);
        const data = e.data ? JSON.parse(e.data) : { message: '处理失败' };
        setProgressMessage(data.message || '处理失败');
        setProcessing(false);
        eventSource.close();
        
        // 刷新数据
        fetchCodeBase();
      });

      eventSource.onerror = () => {
        console.error('[SSE] Connection error');
        setProcessing(false);
        eventSource.close();
        // 连接断开时刷新数据，可能已经完成了
        fetchCodeBase();
        eventSource.close();
      };
    } catch (error) {
      console.error('处理失败:', error);
      setProcessing(false);
    }
  };

  // 按需加载文件树
  const loadFileTree = async (path: string) => {
    try {
      if (path === '') {
        setTreeLoading(true);
      }
      
      const response = await fetch(`/api/codebases/${params.id}/files/tree?path=${encodeURIComponent(path)}`);
      if (!response.ok) return;
      
      const data = await response.json();
      const items: FileTreeNode[] = data.items.map((item: any) => ({
        ...item,
        loaded: item.type === 'file', // 文件不需要加载子项
        loading: false,
      }));

      if (path === '') {
        // 根目录
        setFileTree(items);
      } else {
        // 更新特定文件夹的子项
        setFileTree((prev: FileTreeNode[]) => updateTreeNode(prev, path, items));
      }
    } catch (error) {
      console.error('加载文件树失败:', error);
    } finally {
      if (path === '') {
        setTreeLoading(false);
      }
    }
  };

  // 递归更新树节点
  const updateTreeNode = (nodes: FileTreeNode[], targetPath: string, children: FileTreeNode[]): FileTreeNode[] => {
    return nodes.map((node: FileTreeNode) => {
      if (node.path === targetPath) {
        return { ...node, children, loaded: true, loading: false };
      }
      if (node.children && targetPath.startsWith(node.path + '/')) {
        return { ...node, children: updateTreeNode(node.children, targetPath, children) };
      }
      return node;
    });
  };

  // 设置节点加载状态
  const setNodeLoading = (path: string, loading: boolean) => {
    setFileTree((prev: FileTreeNode[]) => {
      const updateLoading = (nodes: FileTreeNode[]): FileTreeNode[] => {
        return nodes.map((node: FileTreeNode) => {
          if (node.path === path) {
            return { ...node, loading };
          }
          if (node.children) {
            return { ...node, children: updateLoading(node.children) };
          }
          return node;
        });
      };
      return updateLoading(prev);
    });
  };

  const toggleFolder = async (path: string, node: FileTreeNode) => {
    const isExpanded = expandedFolders.has(path);
    
    if (isExpanded) {
      // 折叠
      setExpandedFolders((prev: Set<string>) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } else {
      // 展开
      setExpandedFolders((prev: Set<string>) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      
      // 如果还没加载过，加载子项
      if (!node.loaded && !node.loading) {
        setNodeLoading(path, true);
        await loadFileTree(path);
      }
    }
  };

  const getLanguageColor = (lang: string) => {
    const colors: Record<string, string> = {
      ts: 'text-blue-600',
      tsx: 'text-blue-500',
      js: 'text-yellow-600',
      jsx: 'text-yellow-500',
      md: 'text-gray-600',
      json: 'text-green-600',
    };
    return colors[lang] || 'text-gray-500';
  };

  const renderFileTree = (nodes: FileTreeNode[], depth = 0): any => {
    return nodes.map((node: FileTreeNode) => {
      const isExpanded = expandedFolders.has(node.path);
      
      return (
        <div key={node.path}>
          <div
            className={cn(
              "flex items-center gap-2 py-1.5 px-2 hover:bg-zinc-50 rounded cursor-pointer text-sm",
              depth > 0 && "ml-4"
            )}
            onClick={() => node.type === 'folder' && toggleFolder(node.path, node)}
          >
            {node.type === 'folder' ? (
              <>
                {node.loading ? (
                  <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                ) : isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-zinc-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                )}
                <Folder className="w-4 h-4 text-zinc-500" />
                <span className="text-zinc-700 font-medium">{node.name}</span>
                {node.childCount !== undefined && (
                  <span className="text-zinc-400 text-xs ml-auto">{node.childCount} 项</span>
                )}
              </>
            ) : (
              <>
                <span className="w-4" />
                <FileCode className={cn("w-4 h-4", getLanguageColor(node.language || ''))} />
                <span className="text-zinc-600">{node.name}</span>
                <span className="text-zinc-400 text-xs ml-auto">{node.lineCount} 行</span>
              </>
            )}
          </div>
          {node.type === 'folder' && isExpanded && node.children && (
            <div>{renderFileTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'completed':
        return { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', label: '已就绪' };
      case 'cloning':
        return { icon: Loader2, color: 'text-blue-600', bg: 'bg-blue-50', label: '克隆中', spin: true };
      case 'parsing':
        return { icon: Loader2, color: 'text-purple-600', bg: 'bg-purple-50', label: '解析中', spin: true };
      case 'indexing':
        return { icon: Loader2, color: 'text-orange-600', bg: 'bg-orange-50', label: '索引中', spin: true };
      case 'failed':
        return { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: '失败' };
      default:
        return { icon: Clock, color: 'text-zinc-500', bg: 'bg-zinc-50', label: '等待处理' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-50/30">
        <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!codeBase) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-50/30">
        代码库不存在
      </div>
    );
  }

  const statusInfo = getStatusInfo(codeBase.status);
  const StatusIcon = statusInfo.icon;
  const isProcessing = ['pending', 'cloning', 'parsing', 'indexing'].includes(codeBase.status);

  return (
    <div className="min-h-screen bg-zinc-50/30 relative overflow-hidden pb-20">
      {/* 动态背景 */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.4]" />
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-y-0 w-[400px] bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent animate-beam blur-xl" style={{ animationDelay: '2s' }} />
        </div>
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-gradient-to-bl from-emerald-200/40 to-teal-200/40 blur-[80px] rounded-full opacity-60 animate-pulse duration-[8000ms]" />
      </div>

      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-20 backdrop-blur-xl bg-white/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => router.push('/dashboard/codebase')} 
              className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 -ml-2"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回列表
            </Button>
            <div className="h-4 w-px bg-zinc-200" />
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
                <Github className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-base font-semibold text-zinc-900 leading-none">{codeBase.name}</h1>
                <span className="text-[10px] text-zinc-500 mt-1 font-mono tracking-wide">{codeBase.branch}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium",
              statusInfo.bg, statusInfo.color
            )}>
              <StatusIcon className={cn("w-4 h-4", statusInfo.spin && "animate-spin")} />
              {statusInfo.label}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        
        {/* 处理进度 */}
        {(isProcessing || processing) && (
          <Card className="border border-zinc-200 shadow-sm bg-white p-6 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
                  <span className="text-sm font-medium text-zinc-700">{progressMessage}</span>
                </div>
                <span className="text-sm font-mono text-zinc-500">{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </Card>
        )}

        {/* 错误信息 */}
        {codeBase.status === 'failed' && codeBase.errorMessage && (
          <Card className="border border-red-200 shadow-sm bg-red-50 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-red-800">处理失败</h3>
                <p className="text-sm text-red-600 mt-1">{codeBase.errorMessage}</p>
                <Button 
                  onClick={startProcessing} 
                  variant="outline" 
                  size="sm" 
                  className="mt-3 border-red-200 text-red-700 hover:bg-red-100"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  重试
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Stats Overview - DeepWiki 架构 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* 仓库类型 */}
          <Card className="border border-zinc-200 shadow-sm bg-white p-4 flex items-center justify-between group hover:border-zinc-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">类型</p>
              <p className="text-lg font-bold text-zinc-900 mt-1 capitalize">
                {codeBase.repoType || 'single'}
              </p>
            </div>
            <div className="w-9 h-9 rounded-full bg-violet-50 flex items-center justify-center text-violet-600 group-hover:bg-violet-100 transition-colors">
              <Folder className="w-4 h-4" />
            </div>
          </Card>

          {/* 主要语言 */}
          <Card className="border border-zinc-200 shadow-sm bg-white p-4 flex items-center justify-between group hover:border-zinc-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">语言</p>
              <p className="text-lg font-bold text-zinc-900 mt-1 capitalize">
                {codeBase.mainLanguage || '-'}
              </p>
            </div>
            <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 group-hover:bg-amber-100 transition-colors">
              <Code2 className="w-4 h-4" />
            </div>
          </Card>

          {/* 模块数量 */}
          <Card className="border border-zinc-200 shadow-sm bg-white p-4 flex items-center justify-between group hover:border-zinc-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">模块</p>
              <p className="text-lg font-bold text-zinc-900 mt-1">
                {codeBase._count.repoModules ?? '-'}
              </p>
            </div>
            <div className="w-9 h-9 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 group-hover:bg-purple-100 transition-colors">
              <BarChart3 className="w-4 h-4" />
            </div>
          </Card>

          {/* 代码文件 */}
          <Card className="border border-zinc-200 shadow-sm bg-white p-4 flex items-center justify-between group hover:border-zinc-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">文件</p>
              <p className="text-lg font-bold text-zinc-900 mt-1">{codeBase._count.codeFiles}</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-zinc-50 flex items-center justify-center text-zinc-600 group-hover:bg-zinc-100 transition-colors">
              <FileCode className="w-4 h-4" />
            </div>
          </Card>

          {/* 符号数量 */}
          <Card className="border border-zinc-200 shadow-sm bg-white p-4 flex items-center justify-between group hover:border-zinc-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">符号</p>
              <p className="text-lg font-bold text-zinc-900 mt-1">
                {codeBase._count.codeSymbols ?? '-'}
              </p>
            </div>
            <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-100 transition-colors">
              <Code2 className="w-4 h-4" />
            </div>
          </Card>

          {/* 分支 */}
          <Card className="border border-zinc-200 shadow-sm bg-white p-4 flex items-center justify-between group hover:border-zinc-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">分支</p>
              <p className="text-lg font-bold text-zinc-900 mt-1 font-mono text-sm">{codeBase.branch}</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100 transition-colors">
              <Github className="w-4 h-4" />
            </div>
          </Card>
        </div>

        {/* Toolbar */}
        <div className="flex justify-between items-center">
          <div className="text-sm text-zinc-500">
            仓库地址：
            <a 
              href={codeBase.githubUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline ml-1 font-mono"
            >
              {codeBase.githubUrl}
            </a>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={startProcessing}
              disabled={isProcessing || processing}
              className="border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", (isProcessing || processing) && "animate-spin")} />
              重新同步
            </Button>

            {/* 知识图谱按钮 */}
            {codeBase.status === 'completed' && (
              <Button
                variant="outline"
                onClick={() => setShowKnowledgeGraph(true)}
                className="border-purple-200 text-purple-600 bg-purple-50 hover:bg-purple-100"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                模块图谱
              </Button>
            )}
            
            <Button
              onClick={() => router.push(`/chat/codebase/${codeBase.id}`)}
              disabled={codeBase.status !== 'completed'}
              className={cn(
                "shadow-lg transition-all duration-300 px-6 rounded-full font-medium group",
                codeBase.status === 'completed'
                  ? "bg-gradient-to-r from-zinc-900 via-black to-zinc-900 text-white hover:shadow-xl hover:-translate-y-0.5"
                  : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
              )}
            >
              <MessageSquare className="w-4 h-4 mr-2 transition-transform duration-300 group-hover:scale-110" />
              开始对话
            </Button>
          </div>
        </div>

        {/* File Tree */}
        {codeBase.status === 'completed' && codeBase._count.codeFiles > 0 && (
          <Card className="border border-zinc-200 shadow-sm bg-white overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">文件结构</h2>
              {expandedFolders.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedFolders(new Set())}
                  className="text-zinc-500 hover:text-zinc-900"
                >
                  全部折叠
                </Button>
              )}
            </div>
            <div className="p-4 max-h-[500px] overflow-auto">
              {treeLoading ? (
                <div className="flex items-center justify-center py-8 text-zinc-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  加载文件树...
                </div>
              ) : fileTree.length > 0 ? (
                renderFileTree(fileTree)
              ) : (
                <div className="text-center py-8 text-zinc-500">
                  暂无文件
                </div>
              )}
            </div>
          </Card>
        )}
      </main>

      {/* 模块图谱可视化弹窗 */}
      {showKnowledgeGraph && codeBase && (
        <KnowledgeGraphV2 
          codeBaseId={codeBase.id}
          onClose={() => setShowKnowledgeGraph(false)} 
        />
      )}
    </div>
  );
}

