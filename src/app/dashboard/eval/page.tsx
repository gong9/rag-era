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
  MessageSquare
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

  const handleStartEval = async () => {
    if (!selectedKB) return;
    setRunning(true);
    setLiveProgress({ completed: 0, total: 0, currentQuestion: '准备中...', results: [] });

    try {
      const response = await fetch('/api/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeBaseId: selectedKB }),
      });

      if (!response.ok) throw new Error('创建评估失败');

      const { id: evalRunId, streamUrl } = await response.json();
      
      // 立即刷新列表并选中新创建的评估
      await fetchEvalRuns();
      fetchRunDetails(evalRunId);

      const eventSource = new EventSource(streamUrl);

      eventSource.addEventListener('progress', (e) => {
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
        setRunning(false);
        setLiveProgress(null);
        fetchEvalRuns();
      });

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
      <header className="h-14 border-b border-[#E8E8E8] bg-white flex items-center px-4 sticky top-0 z-50">
        <button 
          onClick={() => router.push('/dashboard')}
          className="p-2 -ml-2 rounded-md hover:bg-[#F5F5F5] text-[#666] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="ml-2 text-[15px] font-medium text-[#111]">评估</span>
        
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-[#999]">知识库:</span>
          <select
            value={selectedKB}
            onChange={(e) => setSelectedKB(e.target.value)}
            className="h-8 px-3 text-[13px] bg-white border border-[#E8E8E8] rounded-md text-[#333] focus:outline-none focus:border-[#5E6AD2] transition-colors min-w-[120px]"
          >
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
          <button 
            onClick={handleStartEval} 
            disabled={running || !selectedKB}
            className={cn(
              "h-8 px-4 rounded-md text-[13px] font-medium flex items-center gap-2 transition-all",
              running 
                ? "bg-[#F5F5F5] text-[#999] cursor-not-allowed"
                : "bg-[#5E6AD2] text-white hover:bg-[#4F5AC2]"
            )}
          >
            {running ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                评估中...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                开始评估
              </>
            )}
          </button>
        </div>
      </header>

      <div className="flex">
        {/* 左侧面板 */}
        <aside className="w-64 border-r border-[#E8E8E8] bg-white h-[calc(100vh-56px)] overflow-y-auto">
          <div className="p-3">
            <div className="text-[11px] font-medium text-[#999] uppercase tracking-wider px-2 mb-2">
              评估历史
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
                    onClick={() => fetchRunDetails(run.id)}
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
                          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-rose-100 text-[#ccc] hover:text-rose-500 transition-all"
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
        <main className="flex-1 p-6 overflow-auto h-[calc(100vh-56px)]">
          {selectedRun ? (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* 统计数据 - 极简横向排列 */}
              <div className="flex items-end gap-12 pb-6 border-b border-[#E8E8E8]">
                <div>
                  <div className="text-[11px] font-medium text-[#999] uppercase tracking-wider mb-1">综合评分</div>
                  <div className="text-4xl font-semibold text-[#111] tabular-nums">
                    {selectedRun.avgOverallScore?.toFixed(1) || '—'}
                  </div>
                </div>
                <div className="flex gap-8">
                  {[
                    { label: '检索', value: selectedRun.avgRetrievalScore },
                    { label: '忠实', value: selectedRun.avgFaithScore },
                    { label: '质量', value: selectedRun.avgQualityScore },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="text-[11px] font-medium text-[#999] uppercase tracking-wider mb-1">{item.label}</div>
                      <ScoreIndicator score={item.value || 0} size="lg" />
                    </div>
                  ))}
                </div>
                <div className="ml-auto text-right">
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
                        style={{ width: `${(liveProgress.completed / liveProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 结果列表 - 极简表格风格 */}
              <div>
                <div className="text-[11px] font-medium text-[#999] uppercase tracking-wider mb-3">详细结果</div>
                <div className="bg-white border border-[#E8E8E8] rounded-lg overflow-hidden">
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
                          {/* 回答区域 - 全宽，带引用样式 */}
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
                                { 
                                  label: '检索质量', 
                                  score: result.retrievalScore,
                                  reason: result.retrievalReason, 
                                  bg: 'bg-emerald-50/80',
                                  border: 'border-emerald-100',
                                  labelColor: 'text-emerald-600',
                                  dotColor: 'bg-emerald-500'
                                },
                                { 
                                  label: '忠实度', 
                                  score: result.faithScore,
                                  reason: result.faithReason, 
                                  bg: 'bg-blue-50/80',
                                  border: 'border-blue-100',
                                  labelColor: 'text-blue-600',
                                  dotColor: 'bg-blue-500'
                                },
                                { 
                                  label: '答案质量', 
                                  score: result.qualityScore,
                                  reason: result.qualityReason, 
                                  bg: 'bg-violet-50/80',
                                  border: 'border-violet-100',
                                  labelColor: 'text-violet-600',
                                  dotColor: 'bg-violet-500'
                                },
                              ].map((item) => (
                                <div 
                                  key={item.label}
                                  className={cn("rounded-lg border p-3", item.bg, item.border)}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-1.5">
                                      <div className={cn("w-1.5 h-1.5 rounded-full", item.dotColor)} />
                                      <span className={cn("text-[11px] font-semibold", item.labelColor)}>{item.label}</span>
                                    </div>
                                    <span className={cn("text-[13px] font-bold tabular-nums", item.labelColor)}>
                                      {item.score.toFixed(1)}
                                    </span>
                                  </div>
                                  <p className="text-[12px] text-[#555] leading-relaxed line-clamp-3">
                                    {item.reason || '暂无评估理由'}
                                  </p>
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
            <div className="h-full flex flex-col items-center justify-center text-[#999]">
              <div className="text-[13px]">选择左侧评估记录查看详情</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
