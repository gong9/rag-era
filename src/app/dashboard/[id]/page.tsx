'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Upload, Trash2, FileText, CheckCircle, XCircle, Clock, Search, File, FileCode, AlertCircle, Cloud, X, Layers, BarChart } from 'lucide-react';
import { formatDate, cn } from '@/lib/utils';

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

  useEffect(() => {
    fetchKnowledgeBase();
  }, [params.id]);

  const fetchKnowledgeBase = async () => {
    try {
      const response = await fetch(`/api/knowledge-bases/${params.id}`);
      if (response.ok) {
        const data = await response.json();
        setKb(data);
      }
    } catch (error) {
      console.error('获取知识库失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          <Button 
            onClick={() => router.push(`/chat/${kb.id}`)} 
            disabled={kb.documents.length === 0}
            className={`shadow-sm transition-all text-sm h-9 px-4 rounded-full ${
              kb.documents.length === 0 
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                : 'bg-black hover:bg-gray-800 text-white'
            }`}
            title={kb.documents.length === 0 ? '请先上传文档' : '开始与知识库对话'}
          >
            开始对话
          </Button>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                          onClick={() => handleDelete(doc.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </div>
  );
}
