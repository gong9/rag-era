'use client';

// @ts-ignore
import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Upload, Trash2, FileText, CheckCircle, XCircle, Clock, Search, File, FileCode, AlertCircle, Cloud, X, Layers, BarChart, Network, RefreshCw, Eye, MessageSquare } from 'lucide-react';
import { formatDate, cn } from '@/lib/utils';

// 动态导入图谱可视化组件
const KnowledgeGraph = dynamic(() => import('@/components/KnowledgeGraph'), {
  ssr: false,
  loading: () => null,
});

interface Document {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  errorMessage?: string;
  size?: string;
  type?: string;
  processingProgress?: number;
  processingMessage?: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  documents: Document[];
}

export default function KnowledgeBaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showUpload, setShowUpload] = useState(false); // 控制上传区域显示
  const [rebuildingGraph, setRebuildingGraph] = useState(false); // 重建图谱索引中
  const [graphStatus, setGraphStatus] = useState<'idle' | 'building' | 'done' | 'error'>('idle');
  const [graphProgress, setGraphProgress] = useState(0); // 图谱构建进度
  const [graphMessage, setGraphMessage] = useState(''); // 图谱构建消息
  const [showGraphViewer, setShowGraphViewer] = useState(false); // 显示图谱可视化
  const [showConfirmDialog, setShowConfirmDialog] = useState(false); // 显示确认对话框
  
  // 文档预览相关状态
  const [previewDoc, setPreviewDoc] = useState<{ id: string; name: string } | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewWordCount, setPreviewWordCount] = useState(0);

  useEffect(() => {
    fetchKnowledgeBase();
  }, [params.id]);

  // 显示构建确认对话框
  const handleShowBuildConfirm = () => {
    if (!kb || kb.documents.length === 0) {
      return;
    }
    setShowConfirmDialog(true);
  };

  // 重建 LightRAG 图谱索引（SSE 方式）
  const handleRebuildGraph = async () => {
    if (!kb) return;
    setShowConfirmDialog(false);
    setRebuildingGraph(true);
    setGraphStatus('building');
    setGraphProgress(0);
    setGraphMessage('准备中...');
    
    try {
      // 使用 fetch + SSE 方式
      const response = await fetch('/api/lightrag/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kb_id: kb.id }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '索引失败');
      }
      
        // 检查是否是 SSE 响应
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('text/event-stream')) {
          // 处理 SSE 流
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          
          if (!reader) {
            throw new Error('无法读取响应流');
          }
          
          let buffer = '';
          let currentEvent = ''; // 当前事件类型
          let finalStatus: 'done' | 'error' | 'pending' | null = null; // 追踪最终状态
          let finalMessage = '';
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // 解析 SSE 事件
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的行
            
            for (const line of lines) {
              if (line.startsWith('event:')) {
                currentEvent = line.slice(6).trim();
                continue;
              }
              if (line.startsWith('data:')) {
                try {
                  const data = JSON.parse(line.slice(5).trim());
                  
                  if (data.progress !== undefined) {
                    setGraphProgress(data.progress);
                  }
                  if (data.message) {
                    setGraphMessage(data.message);
                    finalMessage = data.message;
                  }
                  
                  // 检查事件类型（优先）
                  if (currentEvent === 'complete') {
                    finalStatus = 'done';
                  } else if (currentEvent === 'error') {
                    finalStatus = 'error';
                    if (data.error) finalMessage = data.error;
                  } else if (currentEvent === 'timeout') {
                    finalStatus = 'pending';
                  }
                  
                  // 也检查 data 中的状态字段
                  if (data.status === 'completed' || data.status === 'done') {
                    finalStatus = 'done';
                  } else if (data.status === 'failed' || data.status === 'error') {
                    finalStatus = 'error';
                    if (data.error) finalMessage = data.error;
                  } else if (data.status === 'pending') {
                    finalStatus = 'pending';
                  }
                } catch (e) {
                  // 解析失败，忽略
                }
              }
            }
          }
          
          // 根据追踪的最终状态设置 UI
          if (finalStatus === 'done') {
            setGraphStatus('done');
          } else if (finalStatus === 'error') {
            setGraphStatus('error');
            if (finalMessage && !finalMessage.startsWith('构建失败')) {
              setGraphMessage(`构建失败: ${finalMessage}`);
            }
          } else if (finalStatus === 'pending') {
            // 超时但任务可能还在后台运行，设置为 idle 让用户可以重试
            setGraphStatus('idle');
            setGraphMessage(finalMessage || '任务超时，请稍后刷新查看');
          } else {
            // 未收到明确状态，流意外结束
            setGraphStatus('error');
            setGraphMessage('连接意外断开，请重试');
          }
        } else {
        // 普通 JSON 响应
        const result = await response.json();
        setGraphStatus('done');
        setGraphMessage(result.message || '索引完成');
        setGraphProgress(100);
      }
    } catch (error: any) {
      console.error('重建图谱索引失败:', error);
      setGraphStatus('error');
      setGraphMessage(`构建失败: ${error.message}`);
      // 不再使用 alert，UI 已经能够显示错误状态
    } finally {
      setRebuildingGraph(false);
    }
  };

  const fetchKnowledgeBase = async () => {
    try {
      const response = await fetch(`/api/knowledge-bases/${params.id}`);
      if (response.ok) {
        const data = await response.json();
        setKb(data);
        
        // 检查 LightRAG 图谱是否已构建
        checkGraphStatus(params.id as string);
      }
    } catch (error) {
      console.error('获取知识库失败:', error);
    } finally {
      setLoading(false);
    }
  };
  
  // 检查图谱是否已构建
  const checkGraphStatus = async (kbId: string) => {
    try {
      const response = await fetch(`/api/lightrag/graph/${kbId}?limit=1`);
      if (response.ok) {
        const data = await response.json();
        // 如果有实体数据，说明图谱已构建
        if (data.entities && data.entities.length > 0) {
          setGraphStatus('done');
        }
      }
    } catch (error) {
      // 静默失败，不影响页面
      console.log('检查图谱状态失败:', error);
    }
  };

  const handleDrag = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: any) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('knowledgeBaseId', params.id as string);

    try {
      // 1. 上传文件
      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '上传失败');
        return;
      }

      const uploadedDoc = await response.json();
      
      // 2. 清空选择
      setSelectedFile(null);
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      setShowUpload(false);
      
      // 3. 刷新列表（显示 pending 状态的文档）
      await fetchKnowledgeBase();
      
      // 4. 连接 SSE 处理端点
      const eventSource = new EventSource(`/api/documents/${uploadedDoc.id}/process`);
      
      eventSource.addEventListener('status', (e) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] Status:', data);
        
        // 更新文档状态
        setKb((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            documents: prev.documents.map((doc) =>
              doc.id === uploadedDoc.id
                ? { 
                    ...doc, 
                    status: data.status,
                    processingProgress: data.progress,
                    processingMessage: data.message 
                  }
                : doc
            ),
          };
        });
      });
      
      // 心跳事件 - 保持连接活跃
      eventSource.addEventListener('heartbeat', (e) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] Heartbeat:', data.progress);
      });
      
      eventSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] Complete:', data);
        
        // 更新为完成状态
        setKb((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            documents: prev.documents.map((doc) =>
              doc.id === uploadedDoc.id
                ? { 
                    ...doc, 
                    status: 'completed',
                    processingProgress: 100,
                    processingMessage: data.message 
                  }
                : doc
            ),
          };
        });
        
        eventSource.close();
        // 3秒后刷新列表
        setTimeout(fetchKnowledgeBase, 3000);
      });
      
      eventSource.addEventListener('error', (e: any) => {
        console.error('[SSE] Error:', e);
        const data = e.data ? JSON.parse(e.data) : { message: '处理失败' };
        
        // 更新为失败状态
        setKb((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            documents: prev.documents.map((doc) =>
              doc.id === uploadedDoc.id
                ? { 
                    ...doc, 
                    status: 'failed',
                    processingProgress: 0,
                    processingMessage: data.message,
                    errorMessage: data.message
                  }
                : doc
            ),
          };
        });
        
        eventSource.close();
      });
      
      eventSource.onerror = () => {
        console.error('[SSE] Connection error');
        eventSource.close();
      };
      
    } catch (error) {
      console.error('上传失败:', error);
      alert('上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('确定要删除这个文档吗？')) return;

    try {
      const response = await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchKnowledgeBase();
      }
    } catch (error) {
      console.error('删除文档失败:', error);
    }
  };

  // 预览文档内容
  const handlePreview = async (doc: { id: string; name: string }) => {
    setPreviewDoc(doc);
    setPreviewLoading(true);
    setPreviewContent('');
    setPreviewWordCount(0);
    
    try {
      const response = await fetch(`/api/documents/${doc.id}`);
      if (response.ok) {
        const data = await response.json();
        setPreviewContent(data.content || '');
        setPreviewWordCount(data.wordCount || 0);
      } else {
        setPreviewContent('无法加载文档内容');
      }
    } catch (error) {
      console.error('获取文档内容失败:', error);
      setPreviewContent('加载失败，请重试');
    } finally {
      setPreviewLoading(false);
    }
  };

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <FileText className="w-5 h-5 text-red-500" />;
    if (['doc', 'docx'].includes(ext || '')) return <FileText className="w-5 h-5 text-blue-500" />;
    if (['txt', 'md'].includes(ext || '')) return <FileCode className="w-5 h-5 text-gray-500" />;
    return <File className="w-5 h-5 text-gray-400" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F8F9FA]">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  if (!kb) {
    return <div className="flex items-center justify-center min-h-screen">知识库不存在</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-50/30 relative overflow-hidden pb-20">
      {/* 动态背景 */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        {/* 基础网格 */}
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.4]" />
        
        {/* 流光效果 */}
        <div className="absolute inset-0 pointer-events-none">
           <div className="absolute inset-y-0 w-[400px] bg-gradient-to-r from-transparent via-blue-500/5 to-transparent animate-beam blur-xl" style={{ animationDelay: '2s' }} />
        </div>

        {/* 呼吸光晕 */}
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-gradient-to-bl from-blue-200/40 to-cyan-200/40 blur-[80px] rounded-full opacity-60 animate-pulse duration-[8000ms]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-gradient-to-tr from-purple-200/40 to-pink-200/40 blur-[80px] rounded-full opacity-60 animate-pulse duration-[10000ms]" />
      </div>

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 backdrop-blur-xl bg-white/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-black hover:bg-gray-100 -ml-2">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回列表
            </Button>
            <div className="h-4 w-px bg-gray-200" />
            <div className="flex flex-col">
              <h1 className="text-base font-semibold text-gray-900 leading-none">{kb.name}</h1>
              <span className="text-[10px] text-gray-500 mt-1 font-mono tracking-wide uppercase">ID: {kb.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        
        {/* Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Card className="border border-gray-200 shadow-sm bg-white p-5 flex items-center justify-between group hover:border-gray-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">总文档数</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{kb.documents.length}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-gray-100 group-hover:text-gray-600 transition-colors">
              <FileText className="w-5 h-5" />
            </div>
          </Card>
          
          <Card className="border border-gray-200 shadow-sm bg-white p-5 flex items-center justify-between group hover:border-gray-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">已索引</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{kb.documents.filter(d => d.status === 'completed').length}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 group-hover:bg-green-100 transition-colors">
              <Layers className="w-5 h-5" />
            </div>
          </Card>

          <Card className="border border-gray-200 shadow-sm bg-white p-5 flex items-center justify-between group hover:border-gray-300 transition-colors">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">状态</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">活跃</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-100 transition-colors">
              <BarChart className="w-5 h-5" />
            </div>
          </Card>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="relative w-full sm:w-72 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
            <Input 
              placeholder="搜索文档..." 
              className="pl-9 h-10 bg-white border-gray-200 text-sm focus-visible:ring-1 focus-visible:ring-gray-400 transition-all hover:border-gray-300" 
            />
          </div>
          <div className="flex gap-2 items-center">
            {/* 图谱功能（合并为一个按钮） */}
            <div className="flex items-center gap-2">
              <Button 
                onClick={() => {
                  if (graphStatus === 'done') {
                    setShowGraphViewer(true);
                  } else {
                    handleShowBuildConfirm();
                  }
                }}
                disabled={rebuildingGraph || (graphStatus !== 'done' && kb.documents.filter(d => d.status === 'completed').length === 0)}
                className={cn(
                  "shadow-sm transition-all duration-300 relative overflow-hidden min-w-[130px]",
                  // 样式逻辑：
                  // 1. 构建中: 紫色背景
                  // 2. 已完成: 黑色背景 (查看模式)
                  // 3. 未构建: 白色背景 (构建模式)
                  rebuildingGraph 
                    ? "bg-purple-50 text-purple-700 border border-purple-200" 
                    : graphStatus === 'done'
                    ? "bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300"
                    : "bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300"
                )}
                title={
                  rebuildingGraph ? "正在构建图谱..." :
                  graphStatus === 'done' ? "查看知识图谱" :
                  "构建知识图谱索引"
                }
              >
                {/* 进度条背景 */}
                {rebuildingGraph && (
                  <div 
                    className="absolute inset-0 bg-purple-100/50 transition-all duration-300"
                    style={{ width: `${graphProgress}%` }}
                  />
                )}
                
                <span className="relative flex items-center justify-center w-full">
                  {rebuildingGraph ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      {graphProgress}%
                    </>
                  ) : graphStatus === 'done' ? (
                    <>
                      <Network className="w-4 h-4 mr-2" />
                      查看图谱
                    </>
                  ) : (
                    <>
                      <Network className="w-4 h-4 mr-2" />
                      构建图谱
                    </>
                  )}
                </span>
              </Button>

              {/* 如果已构建，额外显示一个小的重建按钮 */}
              {graphStatus === 'done' && !rebuildingGraph && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleShowBuildConfirm}
                  className="h-10 w-10 text-gray-400 hover:text-purple-600 hover:bg-purple-50 border border-transparent hover:border-purple-100"
                  title="重建知识图谱"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              )}
            </div>
            
            <Button 
              onClick={() => setShowUpload(!showUpload)} 
              className={cn(
                "shadow-sm transition-all duration-300",
                showUpload ? "bg-gray-100 text-gray-900 hover:bg-gray-200" : "bg-white text-gray-900 border border-gray-200 hover:bg-gray-50 hover:border-gray-300"
              )}
            >
              {showUpload ? <X className="w-4 h-4 mr-2" /> : <Cloud className="w-4 h-4 mr-2" />}
              {showUpload ? '取消上传' : '上传文档'}
            </Button>
            
            {/* 分隔线 */}
            <div className="h-8 w-px bg-gray-200 mx-2" />
            
            {/* 开始对话 - 核心功能按钮 */}
            <Button 
              onClick={() => router.push(`/chat/${kb.id}`)} 
              disabled={kb.documents.length === 0}
              className={cn(
                "shadow-lg transition-all duration-300 px-6 h-10 rounded-full font-medium group",
                kb.documents.length === 0 
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200" 
                  : "bg-gradient-to-r from-zinc-900 via-black to-zinc-900 text-white hover:shadow-xl hover:-translate-y-0.5 border border-zinc-800 bg-[length:200%_auto] hover:bg-right"
              )}
            >
              <MessageSquare className="w-4 h-4 mr-2 transition-transform duration-300 group-hover:scale-110" />
              开始对话
            </Button>
          </div>
        </div>

        {/* Upload Area (Collapsible) */}
        <div className={cn(
          "grid transition-all duration-300 ease-in-out overflow-hidden",
          showUpload ? "grid-rows-[1fr] opacity-100 mb-8" : "grid-rows-[0fr] opacity-0"
        )}>
          <div className="min-h-0">
            <div 
              className={cn(
                "relative border-2 border-dashed rounded-xl p-10 transition-all duration-200 text-center cursor-pointer bg-white group",
                dragActive ? "border-black bg-gray-50" : "border-gray-200 hover:border-gray-400 hover:bg-gray-50",
                selectedFile ? "border-black bg-gray-50" : ""
              )}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <Input
                id="file-upload"
                type="file"
                accept=".txt,.md,.pdf,.docx"
                onChange={handleFileChange}
                className="hidden"
              />
              
              <div className="flex flex-col items-center gap-4">
                <div className={cn(
                  "w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm",
                  selectedFile ? "bg-black text-white" : "bg-gray-100 text-gray-400 group-hover:bg-white group-hover:shadow-md"
                )}>
                  {selectedFile ? <FileText className="w-6 h-6" /> : <Cloud className="w-7 h-7" />}
                </div>
                
                <div className="space-y-1">
                  {selectedFile ? (
                    <>
                      <p className="font-medium text-gray-900 text-lg">{selectedFile.name}</p>
                      <p className="text-sm text-gray-500">{(selectedFile.size / 1024).toFixed(2)} KB - 准备就绪</p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-gray-900 text-lg">点击或拖拽上传文档</p>
                      <p className="text-sm text-gray-500">支持 PDF, Word, TXT, Markdown (最大 10MB)</p>
                    </>
                  )}
                </div>

                {selectedFile && (
                  <div className="flex gap-3 mt-2">
                    <Button 
                      onClick={(e) => { e.stopPropagation(); handleUpload(); }} 
                      disabled={uploading}
                      className="bg-black text-white hover:bg-gray-800 min-w-[120px]"
                    >
                      {uploading ? '上传处理中...' : '开始上传'}
                    </Button>
                    <Button
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                      variant="outline"
                      disabled={uploading}
                    >
                      取消
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Documents Table */}
        <Card className="border border-gray-200 shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50/50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 font-medium w-[40%]">文档名称</th>
                  <th className="px-6 py-4 font-medium">上传时间</th>
                  <th className="px-6 py-4 font-medium">大小</th>
                  <th className="px-6 py-4 font-medium">状态</th>
                  <th className="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {kb.documents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center text-gray-500">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="w-8 h-8 text-gray-300" />
                        <p>暂无文档数据</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  kb.documents.map((doc) => (
                    <tr key={doc.id} className="group hover:bg-gray-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-white group-hover:shadow-sm transition-all">
                            {getFileIcon(doc.name)}
                          </div>
                          <span className="font-medium text-gray-900 truncate max-w-[200px] sm:max-w-xs" title={doc.name}>
                            {doc.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                        {doc.size || '-'}
                      </td>
                      <td className="px-6 py-4">
                        {doc.status === 'processing' && doc.processingProgress !== undefined ? (
                          <div className="space-y-1.5 min-w-[180px]">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-600 font-medium">{doc.processingMessage || '处理中...'}</span>
                              <span className="text-gray-500 font-mono">{doc.processingProgress}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 rounded-full"
                                style={{ width: `${doc.processingProgress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                            doc.status === 'completed' ? "bg-white text-gray-700 border-gray-200 group-hover:border-green-200 group-hover:text-green-700 group-hover:bg-green-50" :
                            doc.status === 'processing' || doc.status === 'pending' ? "bg-white text-blue-700 border-blue-200 bg-blue-50" :
                            "bg-white text-red-700 border-red-200 bg-red-50"
                          )}>
                            {doc.status === 'completed' ? <div className="w-1.5 h-1.5 rounded-full bg-green-500" /> :
                             doc.status === 'processing' || doc.status === 'pending' ? <Clock className="w-3 h-3 animate-spin" /> :
                             <AlertCircle className="w-3 h-3" />}
                            <span>
                              {doc.status === 'completed' ? '已索引' :
                               doc.status === 'processing' ? '处理中' :
                               doc.status === 'pending' ? '等待处理' : '失败'}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-400 hover:text-blue-600 hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition-all"
                            onClick={() => handlePreview({ id: doc.id, name: doc.name })}
                            title="预览文档"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                            onClick={() => handleDelete(doc.id)}
                            title="删除文档"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
      
      {/* 图谱可视化弹窗 */}
      {showGraphViewer && kb && (
        <KnowledgeGraph 
          codeBaseId={kb.id} 
          onClose={() => setShowGraphViewer(false)} 
        />
      )}
      
      {/* 构建确认对话框 */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 背景遮罩 */}
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowConfirmDialog(false)}
          />
          
          {/* 对话框 */}
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center">
                <Network className="w-6 h-6 text-zinc-700" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  构建知识图谱
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed">
                  将为 <span className="font-medium text-gray-900">{kb?.documents.filter(d => d.status === 'completed').length || 0}</span> 个文档构建知识图谱索引。
                  <br />
                  此过程需要调用 AI 提取实体关系，可能需要 1-3 分钟。
                </p>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowConfirmDialog(false)}
                className="px-5 border-gray-200 hover:bg-gray-50"
              >
                取消
              </Button>
              <Button
                onClick={handleRebuildGraph}
                className="bg-zinc-900 hover:bg-zinc-800 text-white px-5"
              >
                <Network className="w-4 h-4 mr-2" />
                开始构建
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* 文档预览弹窗 */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 背景遮罩 */}
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setPreviewDoc(null)}
          />
          
          {/* 预览对话框 */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* 头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center">
                  {getFileIcon(previewDoc.name)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 truncate max-w-md" title={previewDoc.name}>
                    {previewDoc.name}
                  </h3>
                  {previewWordCount > 0 && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {previewWordCount.toLocaleString()} 字
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPreviewDoc(null)}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            
            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {previewLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-gray-200 border-t-zinc-900 rounded-full animate-spin" />
                </div>
              ) : previewContent ? (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed bg-gray-50/50 rounded-lg p-4 border border-gray-100">
                    {previewContent}
                  </pre>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <FileText className="w-12 h-12 mb-3" />
                  <p>暂无内容</p>
                </div>
              )}
            </div>
            
            {/* 底部 */}
            <div className="flex justify-end px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <Button
                onClick={() => setPreviewDoc(null)}
                className="bg-zinc-900 hover:bg-zinc-800 text-white px-6"
              >
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
