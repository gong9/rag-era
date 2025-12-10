'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, 
  Play, 
  Trash2, 
  Loader2,
  ChevronRight,
  MessageSquare,
  Sparkles,
  X,
  Check,
  FileQuestion,
  Menu,
  History
} from 'lucide-react';
import { formatDate, cn } from '@/lib/utils';

interface EvalRun {
  id: string;
  knowledgeBaseId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalQuestions: number;
  completedCount: number;
  avgRetrievalScore: number | null;
  avgFaithScore: number | null;
  avgQualityScore: number | null;
  avgToolScore: number | null;
  avgOverallScore: number | null;
  createdAt: string;
  knowledgeBase?: { name: string };
}

interface EvalResult {
  id: string;
  questionId: string;
  question: string;
  answer: string;
  retrievalScore: number;
  faithScore: number;
  qualityScore: number;
  toolScore: number;
  avgScore: number;
  retrievalReason: string | null;
  faithReason: string | null;
  qualityReason: string | null;
  toolReason: string | null;
  toolsCalled: string | null;
}

interface KnowledgeBase {
  id: string;
  name: string;
}

interface GeneratedQuestion {
  id: string;
  question: string;
  expectedIntent: string;
  expectedTools: string[];
  keywords: string[];
}

interface SSEProgressEvent {
  questionId: string;
  question: string;
  answer: string;
  scores: {
    retrieval: number;
    faithfulness: number;
    quality: number;
    tool: number;
    average: number;
  };
  reasons: {
    retrieval: string;
    faithfulness: string;
    quality: string;
  };
  progress: {
    completed: number;
    total: number;
  };
}

// 极简分数指示器
const ScoreIndicator = ({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) => {
  const getColor = (s: number) => {
    if (s >= 4) return 'text-emerald-600';
    if (s >= 3) return 'text-amber-600';
    return 'text-rose-600';
  };
  
  const sizeClass = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-3xl font-semibold'
  };

  return (
    <span className={cn(getColor(score), sizeClass[size], 'tabular-nums')}>
      {score.toFixed(1)}
    </span>
  );
};

// 意图标签映射
const intentLabels: Record<string, { label: string; color: string }> = {
  knowledge_query: { label: '知识查询', color: 'bg-blue-100 text-blue-700' },
  document_summary: { label: '文档总结', color: 'bg-purple-100 text-purple-700' },
  draw_diagram: { label: '画图', color: 'bg-green-100 text-green-700' },
  datetime: { label: '时间查询', color: 'bg-orange-100 text-orange-700' },
  web_search: { label: '网络搜索', color: 'bg-cyan-100 text-cyan-700' },
};

export default function EvalDashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<string>('');
  const [selectedRun, setSelectedRun] = useState<EvalRun | null>(null);
  const [runDetails, setRunDetails] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false); // 移动端侧边栏状态
  
  // 问题生成相关状态
  const [generating, setGenerating] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  
  const [liveProgress, setLiveProgress] = useState<{
    completed: number;
    total: number;
    currentQuestion: string;
    results: SSEProgressEvent[];
  } | null>(null);

  const fetchEvalRuns = async () => {
    try {
      const response = await fetch('/api/eval');
      if (response.ok) {
        const data = await response.json();
        setEvalRuns(data);
        if (data.length > 0 && !selectedRun) {
          fetchRunDetails(data[0].id);
        }
      }
    } catch (error) {
      console.error('获取评估列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchKnowledgeBases = async () => {
    try {
      const response = await fetch('/api/knowledge-bases');
      if (response.ok) {
        const data = await response.json();
        setKnowledgeBases(data);
        if (data.length > 0 && !selectedKB) {
          setSelectedKB(data[0].id);
        }
      }
    } catch (error) {
      console.error('获取知识库列表失败:', error);
    }
  };

  const fetchRunDetails = async (runId: string) => {
    try {
      const response = await fetch(`/api/eval/${runId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedRun(data);
        setRunDetails(data.results || []);
      }
    } catch (error) {
      console.error('获取评估详情失败:', error);
    }
  };

  // 生成评估问题
  const handleGenerateQuestions = async () => {
    if (!selectedKB) return;
    
    // 检查知识库是否有文档
    try {
      const kbResponse = await fetch(`/api/knowledge-bases/${selectedKB}`);
      if (kbResponse.ok) {
        const kbData = await kbResponse.json();
        if (!kbData.documents || kbData.documents.length === 0) {
          alert('该知识库没有文档，请先上传文档再进行评估');
          return;
        }
      }
    } catch (e) {
      console.error('检查知识库失败:', e);
    }
    
    setGenerating(true);
    
    try {
      const response = await fetch('/api/eval/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeBaseId: selectedKB, count: 10 }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '生成问题失败');
      }

      const questions = await response.json();
      setGeneratedQuestions(questions);
      setShowQuestionModal(true);
    } catch (error: any) {
      console.error('生成问题失败:', error);
      alert(error.message || '生成问题失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  // 确认并开始评估
  const handleConfirmAndStartEval = async () => {
    if (!selectedKB || generatedQuestions.length === 0) return;
    
    setShowQuestionModal(false);
    setRunning(true);
    setLiveProgress({ completed: 0, total: generatedQuestions.length, currentQuestion: '准备中...', results: [] });

    try {
      const response = await fetch('/api/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          knowledgeBaseId: selectedKB,
          questions: generatedQuestions,
        }),
      });

      if (!response.ok) throw new Error('创建评估失败');

      const { id: evalRunId, streamUrl } = await response.json();
      
      // 立即刷新列表并选中新创建的评估
      await fetchEvalRuns();
      fetchRunDetails(evalRunId);
      
      // 清空生成的问题
      setGeneratedQuestions([]);

      let retryCount = 0;
      const maxRetries = 3;
      
      const connectSSE = () => {
        const eventSource = new EventSource(streamUrl);

        eventSource.addEventListener('progress', (e) => {
          retryCount = 0; // 重置重试计数
          const data: SSEProgressEvent = JSON.parse(e.data);
          setLiveProgress(prev => ({
            completed: data.progress.completed,
            total: data.progress.total,
            currentQuestion: data.question,
            results: [...(prev?.results || []), data],
          }));
          
          // 实时更新选中项的进度
          setSelectedRun(prev => {
            if (prev && prev.id === evalRunId) {
              return {
                ...prev,
                completedCount: data.progress.completed,
                totalQuestions: data.progress.total,
              };
            }
            return prev;
          });
          
          // 实时更新列表中的进度
          setEvalRuns(prev => prev.map(run => 
            run.id === evalRunId 
              ? { ...run, completedCount: data.progress.completed, status: 'running' as const }
              : run
          ));
          
          // 实时添加已完成的结果到详情列表（现在包含完整数据）
          const newResult: EvalResult = {
            id: data.questionId,
            questionId: data.questionId,
            question: data.question,
            answer: data.answer || '',
            retrievalScore: data.scores.retrieval,
            faithScore: data.scores.faithfulness,
            qualityScore: data.scores.quality,
            toolScore: data.scores.tool,
            avgScore: data.scores.average,
            retrievalReason: data.reasons?.retrieval || null,
            faithReason: data.reasons?.faithfulness || null,
            qualityReason: data.reasons?.quality || null,
            toolReason: null,
            toolsCalled: null,
          };
          setRunDetails(prev => {
            // 避免重复添加
            if (prev.some(r => r.questionId === data.questionId)) return prev;
            return [...prev, newResult];
          });
        });

        eventSource.addEventListener('completed', () => {
          eventSource.close();
          setRunning(false);
          setLiveProgress(null);
          fetchEvalRuns();
          fetchRunDetails(evalRunId);
        });

        eventSource.addEventListener('error', () => {
          eventSource.close();
          
          // 尝试重连
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`SSE 连接断开，尝试重连 (${retryCount}/${maxRetries})...`);
            setLiveProgress(prev => prev ? {
              ...prev,
              currentQuestion: `连接断开，正在重连 (${retryCount}/${maxRetries})...`,
            } : null);
            setTimeout(connectSSE, 2000); // 2秒后重连
          } else {
            // 重连失败，刷新状态查看后端是否完成
            console.log('SSE 重连失败，刷新评估状态...');
            setRunning(false);
            setLiveProgress(null);
            fetchEvalRuns();
            fetchRunDetails(evalRunId);
          }
        });
      };
      
      connectSSE();

    } catch (error) {
      console.error('启动评估失败:', error);
      setRunning(false);
      setLiveProgress(null);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个评估记录吗？')) return;
    try {
      await fetch(`/api/eval/${id}`, { method: 'DELETE' });
      fetchEvalRuns();
      if (selectedRun?.id === id) {
        setSelectedRun(null);
        setRunDetails([]);
      }
    } catch (error) {
      console.error('删除评估失败:', error);
    }
  };

  useEffect(() => {
    fetchEvalRuns();
    fetchKnowledgeBases();
  }, []);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* 极简顶栏 */}
      <header className="h-12 sm:h-14 border-b border-[#E8E8E8] bg-white flex items-center px-3 sm:px-4 sticky top-0 z-50">
        <button 
          onClick={() => router.push('/dashboard')}
          className="p-1.5 sm:p-2 -ml-1 sm:-ml-2 rounded-md hover:bg-[#F5F5F5] text-[#666] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="ml-1 sm:ml-2 text-[14px] sm:text-[15px] font-medium text-[#111]">评估</span>
        
        {/* 移动端显示历史按钮 */}
        <button 
          onClick={() => setShowSidebar(!showSidebar)}
          className="ml-2 p-1.5 rounded-md hover:bg-[#F5F5F5] text-[#666] transition-colors md:hidden"
        >
          <History className="w-4 h-4" />
        </button>
        
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span className="hidden sm:inline text-[12px] text-[#999]">知识库:</span>
          <select
            value={selectedKB}
            onChange={(e) => setSelectedKB(e.target.value)}
            className="h-7 sm:h-8 px-2 sm:px-3 text-[12px] sm:text-[13px] bg-white border border-[#E8E8E8] rounded-md text-[#333] focus:outline-none focus:border-[#5E6AD2] transition-colors min-w-[80px] sm:min-w-[120px]"
          >
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
          <button 
            onClick={handleGenerateQuestions} 
            disabled={running || generating || !selectedKB}
            className={cn(
              "h-7 sm:h-8 px-2.5 sm:px-4 rounded-md text-[12px] sm:text-[13px] font-medium flex items-center gap-1.5 sm:gap-2 transition-all",
              (running || generating)
                ? "bg-[#F5F5F5] text-[#999] cursor-not-allowed"
                : "bg-[#5E6AD2] text-white hover:bg-[#4F5AC2]"
            )}
          >
            {generating ? (
              <>
                <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" />
                <span className="hidden sm:inline">生成问题中...</span>
                <span className="sm:hidden">生成中</span>
              </>
            ) : running ? (
              <>
                <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" />
                <span className="hidden sm:inline">评估中...</span>
                <span className="sm:hidden">评估中</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">开始评估</span>
                <span className="sm:hidden">评估</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* 问题预览弹窗 */}
      {showQuestionModal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowQuestionModal(false)}
          />
          <div className="relative bg-white sm:rounded-xl rounded-t-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] sm:max-h-[80vh] overflow-hidden flex flex-col">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#E8E8E8]">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-[#5E6AD2]/10 flex items-center justify-center">
                  <FileQuestion className="w-4 h-4 sm:w-5 sm:h-5 text-[#5E6AD2]" />
                </div>
                <div>
                  <h3 className="text-[14px] sm:text-[15px] font-semibold text-[#111]">评估问题预览</h3>
                  <p className="text-[11px] sm:text-[12px] text-[#999]">已生成 {generatedQuestions.length} 个问题</p>
                </div>
              </div>
              <button 
                onClick={() => setShowQuestionModal(false)}
                className="p-1.5 sm:p-2 rounded-md hover:bg-[#F5F5F5] text-[#999] hover:text-[#666] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* 问题列表 */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-6">
              <div className="space-y-2 sm:space-y-3">
                {generatedQuestions.map((q, index) => (
                  <div 
                    key={q.id}
                    className="p-3 sm:p-4 bg-[#FAFAFA] rounded-lg border border-[#E8E8E8] hover:border-[#D0D0D0] transition-colors"
                  >
                    <div className="flex items-start gap-2 sm:gap-3">
                      <span className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#5E6AD2] text-white text-[10px] sm:text-[12px] font-semibold flex items-center justify-center">
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] sm:text-[14px] text-[#333] leading-relaxed">{q.question}</p>
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-2">
                          <span className={cn(
                            "px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-medium",
                            intentLabels[q.expectedIntent]?.color || 'bg-gray-100 text-gray-700'
                          )}>
                            {intentLabels[q.expectedIntent]?.label || q.expectedIntent}
                          </span>
                          {q.expectedTools?.map(tool => (
                            <span key={tool} className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] bg-[#F0F0F0] text-[#666]">
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* 弹窗底部 */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-[#E8E8E8] bg-[#FAFAFA] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-0">
              <p className="hidden sm:block text-[12px] text-[#999]">
                问题将用于评估 RAG 系统的检索、忠实度和回答质量
              </p>
              <div className="flex items-center gap-2 sm:gap-3">
                <button 
                  onClick={() => setShowQuestionModal(false)}
                  className="flex-1 sm:flex-none h-10 sm:h-9 px-4 rounded-md text-[13px] font-medium text-[#666] bg-white border border-[#E8E8E8] sm:border-0 sm:bg-transparent hover:bg-[#E8E8E8] transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={handleConfirmAndStartEval}
                  className="flex-1 sm:flex-none h-10 sm:h-9 px-4 sm:px-5 rounded-md text-[13px] font-medium bg-[#5E6AD2] text-white hover:bg-[#4F5AC2] transition-colors flex items-center justify-center gap-2"
                >
                  <Play className="w-3.5 h-3.5" />
                  开始评估
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex relative">
        {/* 移动端遮罩 */}
        {showSidebar && (
          <div 
            className="fixed inset-0 bg-black/20 z-40 md:hidden"
            onClick={() => setShowSidebar(false)}
          />
        )}
        
        {/* 左侧面板 - 移动端抽屉 */}
        <aside className={cn(
          "bg-white h-[calc(100vh-48px)] sm:h-[calc(100vh-56px)] overflow-y-auto border-r border-[#E8E8E8]",
          // 移动端抽屉样式
          "fixed md:relative z-50 md:z-auto transition-transform duration-300 ease-in-out",
          "w-[260px] md:w-64",
          showSidebar ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}>
          <div className="p-3">
            <div className="flex items-center justify-between px-2 mb-2">
              <div className="text-[11px] font-medium text-[#999] uppercase tracking-wider">
                评估历史
              </div>
              <button 
                onClick={() => setShowSidebar(false)}
                className="p-1 rounded-md hover:bg-[#F5F5F5] text-[#999] md:hidden"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {evalRuns.length === 0 ? (
              <div className="px-2 py-8 text-center text-[13px] text-[#999]">
                暂无评估记录
              </div>
            ) : (
              <div className="space-y-0.5">
                {evalRuns.map((run) => (
                  <div 
                    key={run.id}
                    onClick={() => {
                      fetchRunDetails(run.id);
                      if (window.innerWidth < 768) setShowSidebar(false);
                    }}
                    className={cn(
                      "group px-3 py-2.5 rounded-md cursor-pointer transition-colors",
                      selectedRun?.id === run.id 
                        ? "bg-[#5E6AD2]/10 text-[#5E6AD2]" 
                        : "hover:bg-[#F5F5F5] text-[#333]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium truncate flex-1 pr-2">
                        {run.knowledgeBase?.name}
                      </span>
                      {run.avgOverallScore !== null && (
                        <span className={cn(
                          "text-[13px] font-semibold tabular-nums",
                          run.avgOverallScore >= 4 ? "text-emerald-600" :
                          run.avgOverallScore >= 3 ? "text-amber-600" : "text-rose-600"
                        )}>
                          {run.avgOverallScore.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-[#999]">
                        {formatDate(run.createdAt)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[#999]">
                          {run.completedCount}/{run.totalQuestions}
                        </span>
                        <button
                          className="p-0.5 rounded md:opacity-0 md:group-hover:opacity-100 hover:bg-rose-100 text-[#ccc] hover:text-rose-500 transition-all"
                          onClick={(e) => handleDelete(run.id, e)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* 主内容区 */}
        <main className="flex-1 p-3 sm:p-6 overflow-auto h-[calc(100vh-48px)] sm:h-[calc(100vh-56px)]">
          {selectedRun ? (
            <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
              {/* 统计数据 - 移动端网格布局 */}
              <div className="grid grid-cols-2 sm:flex sm:items-end gap-3 sm:gap-12 pb-4 sm:pb-6 border-b border-[#E8E8E8]">
                <div className="col-span-2 sm:col-span-1">
                  <div className="text-[10px] sm:text-[11px] font-medium text-[#999] uppercase tracking-wider mb-1">综合评分</div>
                  <div className="text-3xl sm:text-4xl font-semibold text-[#111] tabular-nums">
                    {selectedRun.avgOverallScore?.toFixed(1) || '—'}
                  </div>
                </div>
                {[
                  { label: '检索', value: selectedRun.avgRetrievalScore },
                  { label: '忠实', value: selectedRun.avgFaithScore },
                  { label: '质量', value: selectedRun.avgQualityScore },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="text-[10px] sm:text-[11px] font-medium text-[#999] uppercase tracking-wider mb-1">{item.label}</div>
                    {item.value !== null ? (
                      <ScoreIndicator score={item.value} size="lg" />
                    ) : (
                      <span className="text-2xl sm:text-3xl font-semibold text-[#999] tabular-nums">—</span>
                    )}
                  </div>
                ))}
                <div className="hidden sm:block sm:ml-auto text-right">
                  <div className="text-[11px] font-medium text-[#999] uppercase tracking-wider mb-1">问题数</div>
                  <div className="text-2xl font-medium text-[#333] tabular-nums">{selectedRun.totalQuestions}</div>
                </div>
              </div>

              {/* 进度条 */}
              {liveProgress && (
                <div className="flex items-center gap-4 py-3 px-4 bg-[#5E6AD2]/5 border border-[#5E6AD2]/20 rounded-lg">
                  <Loader2 className="w-4 h-4 text-[#5E6AD2] animate-spin flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-[13px] mb-1.5">
                      <span className="text-[#5E6AD2] font-medium truncate pr-4">{liveProgress.currentQuestion}</span>
                      <span className="text-[#999] flex-shrink-0">{liveProgress.completed}/{liveProgress.total}</span>
                    </div>
                    <div className="h-1 bg-[#E8E8E8] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#5E6AD2] transition-all duration-300"
                        style={{ width: `${liveProgress.total > 0 ? (liveProgress.completed / liveProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 结果列表 - 移动端卡片/桌面端表格 */}
              <div>
                <div className="text-[10px] sm:text-[11px] font-medium text-[#999] uppercase tracking-wider mb-2 sm:mb-3">详细结果</div>
                
                {/* 移动端卡片视图 */}
                <div className="sm:hidden space-y-2">
                  {runDetails.map((result) => (
                    <div key={result.id} className="bg-white border border-[#E8E8E8] rounded-lg overflow-hidden">
                      <div 
                        className={cn(
                          "p-3 cursor-pointer transition-colors",
                          expandedRow === result.id ? "bg-[#FAFAFA]" : ""
                        )}
                        onClick={() => setExpandedRow(expandedRow === result.id ? null : result.id)}
                      >
                        <div className="flex items-start gap-2">
                          <ChevronRight className={cn(
                            "w-4 h-4 text-[#999] transition-transform flex-shrink-0 mt-0.5",
                            expandedRow === result.id && "rotate-90"
                          )} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-[#333] line-clamp-2">{result.question}</p>
                            <div className="flex items-center gap-3 mt-2">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-[#999]">检索</span>
                                <ScoreIndicator score={result.retrievalScore} size="sm" />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-[#999]">忠实</span>
                                <ScoreIndicator score={result.faithScore} size="sm" />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-[#999]">质量</span>
                                <ScoreIndicator score={result.qualityScore} size="sm" />
                              </div>
                              <span className={cn(
                                "ml-auto px-2 py-0.5 rounded text-[12px] font-semibold",
                                result.avgScore >= 4 ? "bg-emerald-100 text-emerald-700" :
                                result.avgScore >= 3 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                              )}>
                                {result.avgScore.toFixed(1)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* 展开详情 */}
                      {expandedRow === result.id && (
                        <div className="border-t border-[#EBEBEB] bg-[#FAFAFA] p-3 space-y-3">
                          <div className="relative pl-3 border-l-2 border-[#5E6AD2]">
                            <div className="text-[10px] font-semibold text-[#5E6AD2] mb-1">RAG 回答</div>
                            <div className="text-[12px] text-[#333] leading-relaxed max-h-[150px] overflow-y-auto">
                              {result.answer || <span className="text-[#999] italic">无回答</span>}
                            </div>
                          </div>
                          <div className="space-y-2">
                            {[
                              { label: '检索', score: result.retrievalScore, reason: result.retrievalReason, color: 'emerald' },
                              { label: '忠实', score: result.faithScore, reason: result.faithReason, color: 'blue' },
                              { label: '质量', score: result.qualityScore, reason: result.qualityReason, color: 'violet' },
                            ].map((item) => (
                              <div key={item.label} className={cn("p-2 rounded-lg border", `bg-${item.color}-50/80 border-${item.color}-100`)}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className={cn("text-[10px] font-semibold", `text-${item.color}-600`)}>{item.label}</span>
                                  <span className={cn("text-[12px] font-bold", `text-${item.color}-600`)}>{item.score.toFixed(1)}</span>
                                </div>
                                <p className="text-[11px] text-[#555] line-clamp-2">{item.reason || '暂无'}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* 桌面端表格视图 */}
                <div className="hidden sm:block bg-white border border-[#E8E8E8] rounded-lg overflow-hidden">
                  {/* 表头 */}
                  <div className="grid grid-cols-[1fr_60px_60px_60px_70px] gap-4 px-4 py-2.5 text-[11px] font-medium text-[#999] uppercase tracking-wider border-b border-[#E8E8E8] bg-[#FAFAFA]">
                    <div>问题</div>
                    <div className="text-center">检索</div>
                    <div className="text-center">忠实</div>
                    <div className="text-center">质量</div>
                    <div className="text-center">平均</div>
                  </div>
                  
                  {/* 数据行 */}
                  {runDetails.map((result, index) => (
                    <div key={result.id}>
                      <div 
                        className={cn(
                          "grid grid-cols-[1fr_60px_60px_60px_70px] gap-4 px-4 py-3 items-center cursor-pointer transition-colors group",
                          index !== runDetails.length - 1 && "border-b border-[#F0F0F0]",
                          expandedRow === result.id ? "bg-[#FAFAFA]" : "hover:bg-[#FAFAFA]"
                        )}
                        onClick={() => setExpandedRow(expandedRow === result.id ? null : result.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronRight className={cn(
                            "w-4 h-4 text-[#999] transition-transform flex-shrink-0",
                            expandedRow === result.id && "rotate-90"
                          )} />
                          <span className="text-[13px] text-[#333] truncate">{result.question}</span>
                        </div>
                        <div className="text-center">
                          <ScoreIndicator score={result.retrievalScore} size="sm" />
                        </div>
                        <div className="text-center">
                          <ScoreIndicator score={result.faithScore} size="sm" />
                        </div>
                        <div className="text-center">
                          <ScoreIndicator score={result.qualityScore} size="sm" />
                        </div>
                        <div className="text-center">
                          <span className={cn(
                            "inline-flex items-center justify-center w-10 h-6 rounded text-[13px] font-semibold",
                            result.avgScore >= 4 ? "bg-emerald-100 text-emerald-700" :
                            result.avgScore >= 3 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                          )}>
                            {result.avgScore.toFixed(1)}
                          </span>
                        </div>
                      </div>
                      
                      {/* 展开详情 */}
                      {expandedRow === result.id && (
                        <div className="border-t border-[#EBEBEB] bg-gradient-to-b from-[#FAFAFA] to-white">
                          {/* 回答区域 */}
                          <div className="px-5 py-4 ml-6">
                            <div className="relative pl-4 border-l-[3px] border-[#5E6AD2]">
                              <div className="absolute -left-[9px] -top-1 w-4 h-4 rounded-full bg-[#5E6AD2] flex items-center justify-center">
                                <MessageSquare className="w-2.5 h-2.5 text-white" />
                              </div>
                              <div className="text-[11px] font-semibold text-[#5E6AD2] mb-2">RAG 回答</div>
                              <div className="text-[13px] text-[#333] leading-[1.7] whitespace-pre-wrap max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                {result.answer || <span className="text-[#999] italic">无回答</span>}
                              </div>
                            </div>
                          </div>
                          
                          {/* 评估理由 - 三列卡片 */}
                          <div className="px-5 pb-5 ml-6">
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                { label: '检索质量', score: result.retrievalScore, reason: result.retrievalReason, bg: 'bg-emerald-50/80', border: 'border-emerald-100', labelColor: 'text-emerald-600', dotColor: 'bg-emerald-500' },
                                { label: '忠实度', score: result.faithScore, reason: result.faithReason, bg: 'bg-blue-50/80', border: 'border-blue-100', labelColor: 'text-blue-600', dotColor: 'bg-blue-500' },
                                { label: '答案质量', score: result.qualityScore, reason: result.qualityReason, bg: 'bg-violet-50/80', border: 'border-violet-100', labelColor: 'text-violet-600', dotColor: 'bg-violet-500' },
                              ].map((item) => (
                                <div key={item.label} className={cn("rounded-lg border p-3", item.bg, item.border)}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-1.5">
                                      <div className={cn("w-1.5 h-1.5 rounded-full", item.dotColor)} />
                                      <span className={cn("text-[11px] font-semibold", item.labelColor)}>{item.label}</span>
                                    </div>
                                    <span className={cn("text-[13px] font-bold tabular-nums", item.labelColor)}>{item.score.toFixed(1)}</span>
                                  </div>
                                  <p className="text-[12px] text-[#555] leading-relaxed line-clamp-3">{item.reason || '暂无评估理由'}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-[#999] px-4 text-center">
              <History className="w-8 h-8 text-[#ddd] mb-3" />
              <div className="text-[13px]">选择评估记录查看详情</div>
              <button 
                onClick={() => setShowSidebar(true)}
                className="mt-3 text-[12px] text-[#5E6AD2] md:hidden"
              >
                查看历史记录
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
