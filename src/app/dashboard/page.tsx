'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { BookOpen, LogOut, Plus, Trash2, MessageSquare, Search, FileText, ChevronRight, BarChart3, Database, Clock, FlaskConical } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  _count: {
    documents: number;
  };
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKB, setNewKB] = useState({ name: '', description: '' });

  useEffect(() => {
    fetchKnowledgeBases();
  }, []);

  const fetchKnowledgeBases = async () => {
    try {
      const response = await fetch('/api/knowledge-bases');
      if (response.ok) {
        const data = await response.json();
        setKnowledgeBases(data);
      }
    } catch (error) {
      console.error('获取知识库失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const response = await fetch('/api/knowledge-bases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newKB),
      });

      if (response.ok) {
        setNewKB({ name: '', description: '' });
        setShowCreateForm(false);
        fetchKnowledgeBases();
      }
    } catch (error) {
      console.error('创建知识库失败:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个知识库吗？这将删除所有相关的文档和聊天记录。')) {
      return;
    }

    try {
      const response = await fetch(`/api/knowledge-bases/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchKnowledgeBases();
      }
    } catch (error) {
      console.error('删除知识库失败:', error);
    }
  };

  // 计算统计数据
  const totalDocuments = knowledgeBases.reduce((acc, kb) => acc + kb._count.documents, 0);
  const totalKBs = knowledgeBases.length;

  return (
    <div className="min-h-screen bg-zinc-50/30 relative overflow-hidden">
      {/* 动态背景 */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        {/* 基础网格 */}
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.4]" />
        
        {/* 流光效果 - 作为一个覆盖层，比网格更淡，但带有颜色 */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-y-0 w-[400px] bg-gradient-to-r from-transparent via-indigo-500/5 to-transparent animate-beam blur-xl" />
        </div>

        {/* 呼吸光晕 */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-tr from-indigo-200/40 to-purple-200/40 blur-[100px] rounded-full animate-pulse duration-[5000ms]" />
      </div>

      {/* Navbar */}
      <header className="sticky top-0 z-30 w-full border-b border-zinc-200 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60">
        <div className="container mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="relative w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center">
              <div className="absolute inset-0 bg-zinc-900 rounded-lg"></div>
              <span className="relative text-white font-bold font-mono text-base sm:text-lg select-none">R</span>
            </div>
            <span className="font-bold text-base sm:text-lg tracking-tight text-zinc-900">
              RAG Era
            </span>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-2.5 px-2 sm:px-3 py-1.5 bg-white border border-zinc-200 rounded-full hover:bg-zinc-50 transition-colors cursor-default shadow-sm">
              <div className="w-5 h-5 rounded-full bg-zinc-900 flex items-center justify-center text-[10px] font-bold text-white">
                {session?.user?.name?.[0]?.toUpperCase()}
              </div>
              <span className="hidden sm:inline text-sm font-medium text-zinc-600">
                {session?.user?.name}
              </span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => signOut()} className="text-zinc-400 hover:text-zinc-900 transition-colors hover:bg-zinc-100 h-8 w-8 sm:h-10 sm:w-10">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-10">
        
        {/* Dashboard Header */}
        <div className="flex flex-col gap-4 sm:gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900">概览</h1>
            <p className="text-zinc-500 mt-1 sm:mt-2 text-sm sm:text-base">
              管理您的知识库集合，上传文档构建索引。
            </p>
          </div>
          
          {/* Stats and Actions - responsive layout */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            {/* Stats Cards */}
            <div className="flex gap-2 sm:gap-3 overflow-x-auto pb-1 sm:pb-0">
              <Card className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border border-zinc-200 shadow-sm bg-white hover:border-zinc-300 transition-colors flex-shrink-0">
                <Database className="w-4 h-4 text-zinc-400" />
                <div className="flex gap-1.5 sm:gap-2 text-sm">
                  <span className="text-zinc-500">知识库</span>
                  <span className="font-semibold text-zinc-900">{totalKBs}</span>
                </div>
              </Card>
              <Card className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border border-zinc-200 shadow-sm bg-white hover:border-zinc-300 transition-colors flex-shrink-0">
                <FileText className="w-4 h-4 text-zinc-400" />
                <div className="flex gap-1.5 sm:gap-2 text-sm">
                  <span className="text-zinc-500">文档</span>
                  <span className="font-semibold text-zinc-900">{totalDocuments}</span>
                </div>
              </Card>
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-2 sm:gap-3">
              <Button 
                onClick={() => router.push('/dashboard/eval')} 
                variant="outline"
                className="border-violet-200 text-violet-600 hover:bg-violet-50 transition-all flex-1 sm:flex-none text-sm sm:text-base h-9 sm:h-10"
              >
                <FlaskConical className="w-4 h-4 mr-1.5 sm:mr-2" />
                评估
              </Button>
              <Button 
                onClick={() => setShowCreateForm(true)} 
                className="bg-zinc-900 hover:bg-zinc-800 text-white shadow-lg shadow-zinc-200 transition-all hover:-translate-y-0.5 flex-1 sm:flex-none text-sm sm:text-base h-9 sm:h-10"
              >
                <Plus className="w-4 h-4 mr-1.5 sm:mr-2" />
                新建
              </Button>
            </div>
          </div>
        </div>

        {/* Knowledge Bases Grid */}
        <div className="space-y-4 sm:space-y-6">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="h-44 sm:h-48 animate-pulse bg-white border border-zinc-100" />
              ))}
            </div>
          ) : knowledgeBases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 sm:py-24 bg-white rounded-xl border border-dashed border-zinc-200 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-zinc-50 rounded-full flex items-center justify-center mb-3 sm:mb-4">
                <BookOpen className="w-7 h-7 sm:w-8 sm:h-8 text-zinc-300" />
              </div>
              <h3 className="text-base sm:text-lg font-medium text-zinc-900">暂无知识库</h3>
              <p className="text-zinc-500 mt-1 mb-4 sm:mb-6 text-sm">开始创建您的第一个知识库</p>
              <Button onClick={() => setShowCreateForm(true)} variant="outline" className="border-zinc-200 hover:bg-zinc-50 text-zinc-900">
                立即创建
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {knowledgeBases.map((kb, index) => (
                <Card 
                  key={kb.id} 
                  className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-zinc-200/50 active:scale-[0.98] sm:hover:-translate-y-1 border-zinc-200 bg-white cursor-pointer animate-in fade-in slide-in-from-bottom-4 fill-mode-forwards"
                  style={{ animationDelay: `${index * 50}ms` }}
                  onClick={() => router.push(`/dashboard/${kb.id}`)}
                >
                  <CardHeader className="pb-3 sm:pb-4 pt-4 sm:pt-6 px-4 sm:px-6">
                    <div className="flex justify-between items-start mb-3 sm:mb-4">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg border border-zinc-100 bg-zinc-50 flex items-center justify-center text-zinc-500 group-hover:border-zinc-200 group-hover:bg-white group-hover:text-zinc-900 transition-all duration-300 shadow-sm">
                        <Database className="w-4 h-4 sm:w-5 sm:h-5" />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-zinc-400 hover:text-red-600 hover:bg-red-50 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-300"
                        onClick={(e) => handleDelete(kb.id, e)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <CardTitle className="text-base sm:text-lg font-semibold text-zinc-900 group-hover:text-black transition-colors line-clamp-1">
                      {kb.name}
                    </CardTitle>
                    <CardDescription className="line-clamp-2 mt-1 sm:mt-1.5 text-sm text-zinc-500 h-10">
                      {kb.description || '暂无描述信息...'}
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="pb-3 sm:pb-4 px-4 sm:px-6">
                    <div className="flex items-center gap-3 sm:gap-4 text-xs text-zinc-500 font-medium">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        {kb._count.documents} 文档
                      </div>
                      <div className="w-1 h-1 bg-zinc-300 rounded-full" />
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(kb.createdAt)}
                      </div>
                    </div>
                  </CardContent>

                  <CardFooter className="pt-0 pb-4 sm:pb-5 px-4 sm:px-6">
                    <div className="w-full flex items-center text-sm font-medium text-zinc-400 group-hover:text-zinc-900 transition-colors gap-1 group-hover:gap-2 duration-300">
                      <span>管理知识库</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Create Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/20 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <Card className="w-full sm:max-w-md shadow-xl border-0 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 bg-white rounded-t-2xl sm:rounded-xl">
            <CardHeader className="px-4 sm:px-6 pt-4 sm:pt-6">
              <CardTitle className="text-lg">新建知识库</CardTitle>
              <CardDescription>配置基本信息</CardDescription>
            </CardHeader>
            <CardContent className="px-4 sm:px-6 pb-6 sm:pb-6">
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">名称</label>
                  <Input
                    value={newKB.name}
                    onChange={(e) => setNewKB({ ...newKB, name: e.target.value })}
                    placeholder="例如：技术文档"
                    required
                    className="bg-white h-11"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">描述</label>
                  <Input
                    value={newKB.description}
                    onChange={(e) => setNewKB({ ...newKB, description: e.target.value })}
                    placeholder="简要描述..."
                    className="bg-white h-11"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setShowCreateForm(false)}>
                    取消
                  </Button>
                  <Button type="submit" className="flex-1 h-11 bg-black hover:bg-gray-800 text-white" disabled={creating}>
                    {creating ? '创建中...' : '确认创建'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
