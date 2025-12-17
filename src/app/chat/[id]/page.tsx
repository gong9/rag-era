'use client';

// @ts-ignore - React 18 types
import React, { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Send, Bot, User, Sparkles, Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeftOpen, Copy, Check, Zap, ChevronDown, ChevronUp, FileText, Search, Database, Network } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { hasMermaidDiagram, extractMermaidFromMessage, removesMermaidFromMessage } from '@/components/DiagramMessage';

// 动态导入 DiagramMessage 组件，禁用 SSR
const DiagramMessage = dynamic(() => import('@/components/DiagramMessage'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[300px] bg-zinc-50 rounded-xl flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
        <span className="text-xs text-zinc-400">加载图表...</span>
      </div>
    </div>
  ),
});

// 检索源信息
interface RetrievalSource {
  type: 'vector' | 'keyword' | 'lightrag' | 'hybrid';
  content: string;
  score?: number;
  documentName?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string[]; // Agent 思考过程
  isAgentic?: boolean; // 是否是 Agentic 模式
  sources?: RetrievalSource[]; // 检索来源
  createdAt?: string;
  isError?: boolean;
  isNew?: boolean;
}

interface ChatHistory {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  createdAt: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  chatHistories: { question: string }[];
  _count: { chatHistories: number };
}

// 打字机效果组件 - 使用 memo 优化
const TypewriterText = React.memo(({ text, onComplete }: { text: string; onComplete?: () => void }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText((prev: string) => prev + text[currentIndex]);
        setCurrentIndex((prev: number) => prev + 1);
      }, 15);
      return () => clearTimeout(timeout);
    } else {
      onComplete?.();
    }
  }, [currentIndex, text, onComplete]);

  useEffect(() => {
    if (text.length > 0 && currentIndex === 0 && displayedText === '') {
    } else if (text !== displayedText && currentIndex >= text.length) {
      setDisplayedText(text);
    }
  }, [text]);

  return <ReactMarkdown>{displayedText}</ReactMarkdown>;
});

// 检索来源面板组件 - 使用 memo 优化
const RetrievalPanel = React.memo(({ sources, messageId }: { sources: RetrievalSource[]; messageId: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSource, setExpandedSource] = useState<number | null>(null);
  
  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'vector': return <Database className="w-3.5 h-3.5" />;
      case 'keyword': return <Search className="w-3.5 h-3.5" />;
      case 'lightrag': return <Network className="w-3.5 h-3.5" />;
      default: return <FileText className="w-3.5 h-3.5" />;
    }
  };
  
  const getSourceLabel = (type: string) => {
    switch (type) {
      case 'vector': return '向量检索';
      case 'keyword': return '关键词检索';
      case 'lightrag': return '知识图谱';
      default: return '混合检索';
    }
  };
  
  const getSourceColor = (type: string) => {
    switch (type) {
      case 'vector': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'keyword': return 'bg-green-50 text-green-700 border-green-200';
      case 'lightrag': return 'bg-purple-50 text-purple-700 border-purple-200';
      default: return 'bg-zinc-50 text-zinc-700 border-zinc-200';
    }
  };
  
  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
      >
        <Search className="w-3.5 h-3.5" />
        <span>检索来源 ({sources.length})</span>
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      
      {isExpanded && (
        <div className="mt-2 space-y-2">
          {sources.map((source, idx) => (
            <div key={idx} className={cn(
              "border rounded-lg overflow-hidden",
              getSourceColor(source.type)
            )}>
              <button
                onClick={() => setExpandedSource(expandedSource === idx ? null : idx)}
                className="w-full flex items-center justify-between px-3 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  {getSourceIcon(source.type)}
                  <span className="text-xs font-medium">{getSourceLabel(source.type)}</span>
                  {source.documentName && (
                    <span className="text-xs opacity-70">· {source.documentName}</span>
                  )}
                  {source.score !== undefined && (
                    <span className="text-xs opacity-50">({(source.score * 100).toFixed(0)}%)</span>
                  )}
                </div>
                {expandedSource === idx ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              
              {expandedSource === idx && (
                <div className="px-3 pb-3">
                  <div className="bg-white/50 rounded p-2 text-xs leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {source.content}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default function ChatPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [kbName, setKbName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [ragMode, setRagMode] = useState<'normal' | 'agentic'>('agentic');
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // 标记是否正在提交，避免 fetchSessionMessages 覆盖消息
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 并行加载，加快初始化速度
    Promise.all([fetchKnowledgeBase(), fetchSessions()]);
  }, [params.id]);

  useEffect(() => {
    // 如果正在提交消息，不要获取消息（避免覆盖用户刚输入的消息）
    if (currentSessionId && !isSubmitting) {
      fetchSessionMessages(currentSessionId);
    }
  }, [currentSessionId, isSubmitting]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // 点击外部关闭模式菜单
  useEffect(() => {
    const handleClickOutside = () => setShowModeMenu(false);
    if (showModeMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showModeMenu]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchKnowledgeBase = async () => {
    try {
      const response = await fetch(`/api/knowledge-bases/${params.id}`);
      if (response.ok) {
        const data = await response.json();
        setKbName(data.name);
      }
    } catch (error) {
      console.error('获取知识库失败:', error);
    }
  };

  const fetchSessions = async () => {
    try {
      const response = await fetch(`/api/chat/sessions/${params.id}`);
      if (response.ok) {
        const sessionsList: ChatSession[] = await response.json();
        setSessions(sessionsList);
        
        if (sessionsList.length > 0 && !currentSessionId) {
          setCurrentSessionId(sessionsList[0].id);
        }
      }
    } catch (error) {
      console.error('获取会话列表失败:', error);
    }
  };

  const fetchSessionMessages = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/chat/session/${sessionId}`);
      if (response.ok) {
        const history: ChatHistory[] = await response.json();
        const formattedMessages: Message[] = history.flatMap((h) => [
          { id: `${h.id}-q`, role: 'user' as const, content: h.question, createdAt: h.createdAt, isNew: false },
          { id: `${h.id}-a`, role: 'assistant' as const, content: h.answer, createdAt: h.createdAt, isNew: false },
        ]);
        setMessages(formattedMessages);
      }
    } catch (error) {
      console.error('获取会话消息失败:', error);
    }
  };

  const createNewSession = async () => {
    try {
      const response = await fetch(`/api/chat/sessions/${params.id}`, {
        method: 'POST',
      });
      if (response.ok) {
        const newSession: ChatSession = await response.json();
        setSessions((prev: ChatSession[]) => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
        setMessages([]);
        if (window.innerWidth < 768) setShowSidebar(false);
      }
    } catch (error) {
      console.error('创建会话失败:', error);
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm('确定要删除这个会话吗？')) return;
    
    try {
      const response = await fetch(`/api/chat/session/${sessionId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setSessions((prev: ChatSession[]) => prev.filter((s: ChatSession) => s.id !== sessionId));
        if (currentSessionId === sessionId) {
          const remaining = sessions.filter((s: ChatSession) => s.id !== sessionId);
          if (remaining.length > 0) {
            setCurrentSessionId(remaining[0].id);
          } else {
            setMessages([]);
            setCurrentSessionId(null);
          }
        }
      }
    } catch (error) {
      console.error('删除会话失败:', error);
    }
  };

  // @ts-ignore
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    setIsSubmitting(true); // 标记开始提交，防止 useEffect 覆盖消息

    let sessionId = currentSessionId;
    if (!sessionId) {
      const response = await fetch(`/api/chat/sessions/${params.id}`, {
        method: 'POST',
      });
      if (response.ok) {
        const newSession: ChatSession = await response.json();
        setSessions((prev: ChatSession[]) => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
        sessionId = newSession.id;
      } else {
        alert('创建会话失败');
        setIsSubmitting(false);
        return;
      }
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    };

    setMessages((prev: Message[]) => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          knowledgeBaseId: params.id,
          sessionId: sessionId,
          question: currentInput,
          mode: ragMode,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        
        // 转换 sourceNodes 为检索来源格式
        const sources: RetrievalSource[] = (data.sourceNodes || []).map((node: any) => ({
          type: node.type || 'hybrid',
          content: node.text || '',
          score: node.score,
          documentName: node.documentName || node.metadata?.fileName,
        }));
        
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.answer,
          thinking: data.thinking || [], // Agent 思考过程
          isAgentic: data.isAgentic || false,
          sources: sources.length > 0 ? sources : undefined,
          isNew: true,
        };
        setMessages((prev: Message[]) => [...prev, assistantMessage]);
        fetchSessions();
      } else {
        const error = await response.json();
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `错误: ${error.error}`,
          isError: true,
          isNew: false,
        };
        setMessages((prev: Message[]) => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('查询失败:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '查询失败，请重试',
        isError: true,
        isNew: false,
      };
      setMessages((prev: Message[]) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      setIsSubmitting(false); // 提交完成，允许 useEffect 获取消息
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('复制失败', err);
    }
  };

  const getDateLabel = (date: string) => {
    const now = new Date();
    const sessionDate = new Date(date);
    const diff = now.getTime() - sessionDate.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days <= 7) return '最近 7 天';
    if (days <= 30) return '最近 30 天';
    return sessionDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  };

  const groupedSessions = sessions.reduce((groups: Record<string, ChatSession[]>, session: ChatSession) => {
    const label = getDateLabel(session.updatedAt);
    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(session);
    return groups;
  }, {} as Record<string, ChatSession[]>);

  const loadSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    if (window.innerWidth < 768) setShowSidebar(false);
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Sidebar - Advanced Grey Style */}
      <div 
        className={cn(
          "flex-shrink-0 bg-zinc-50 flex flex-col transition-all duration-300 ease-in-out border-r border-zinc-200",
          showSidebar ? "w-[260px]" : "w-0"
        )}
      >
        <div className={cn("flex flex-col h-full w-[260px] overflow-hidden", showSidebar ? "opacity-100" : "opacity-0")}>
          <div className="p-3">
            <button
              onClick={createNewSession}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 hover:border-zinc-300 transition-all shadow-sm text-sm text-left group"
            >
              <Plus className="w-4 h-4 text-zinc-500 group-hover:text-zinc-900 transition-colors" />
              <span className="font-medium flex-1">新对话</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin scrollbar-thumb-zinc-200 scrollbar-track-transparent">
            {Object.keys(groupedSessions).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center mb-3">
                  <MessageSquare className="w-5 h-5 text-zinc-400" />
                </div>
                <p className="text-xs text-zinc-400">暂无历史会话</p>
              </div>
            ) : (
              <div className="space-y-6">
                {(Object.entries(groupedSessions) as [string, ChatSession[]][]).map(([label, sessionList]) => (
                  <div key={label}>
                    <h3 className="px-3 mb-2 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                      {label}
                    </h3>
                    <div className="space-y-0.5">
                      {sessionList.map((session: ChatSession) => (
                        <div
                          key={session.id}
                          className={cn(
                            "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer text-sm",
                            currentSessionId === session.id
                              ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200"
                              : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900"
                          )}
                          onClick={() => loadSession(session.id)}
                        >
                          <span className="truncate flex-1 font-normal">
                            {session.title}
                          </span>
                          {/* Gradient fade for long text */}
                          <div className={cn(
                            "absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l pointer-events-none",
                            currentSessionId === session.id ? "from-white" : "from-zinc-50 group-hover:from-zinc-200/50"
                          )} />
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSession(session.id);
                            }}
                            className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 hover:bg-red-50 rounded transition-all z-10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-zinc-200">
             <div className="flex items-center gap-3 px-2 py-2 text-zinc-500 hover:bg-zinc-200/50 rounded-lg transition-colors cursor-pointer">
                <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-white text-xs font-bold">
                  {session?.user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 truncate">{session?.user?.name || '用户'}</p>
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-col flex-1 h-screen min-w-0 bg-white relative overflow-hidden">
        {/* Dynamic Background */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-grid-pattern opacity-[0.2]" />
        </div>

        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm p-3 flex items-center justify-between border-b border-transparent">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => router.push('/dashboard')} 
              className="text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              title="返回仪表盘"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="h-4 w-px bg-zinc-200 mx-1" />
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowSidebar(!showSidebar)} 
              className="text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              title={showSidebar ? "收起侧边栏" : "展开侧边栏"}
            >
              {showSidebar ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
            </Button>
            <span className="font-medium text-zinc-700 text-sm ml-2">{kbName || '知识库问答'}</span>
          </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto scroll-smooth">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center opacity-0 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-forwards">
                <div className="w-16 h-16 bg-zinc-50 rounded-2xl flex items-center justify-center mb-6 shadow-sm border border-zinc-100">
                  <Bot className="w-8 h-8 text-zinc-400" />
                </div>
                <h2 className="text-xl font-semibold text-zinc-800 mb-2">有什么可以帮你的吗？</h2>
                <p className="text-zinc-400 text-sm">基于知识库的智能问答助手</p>
              </div>
            )}

            {messages.map((message: Message, index: number) => {
              const showTypewriter = message.isNew && message.role === 'assistant' && !message.isError;

              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-6",
                    message.role === 'user' ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center shadow-sm border",
                    message.role === 'assistant' 
                      ? "bg-white border-zinc-200" 
                      : "bg-zinc-900 border-zinc-900"
                  )}>
                    {message.role === 'assistant' ? (
                      <Bot className="w-5 h-5 text-zinc-600" />
                    ) : (
                      <User className="w-4 h-4 text-white" />
                    )}
                  </div>
                  
                  {/* Content */}
                  <div className={cn(
                    "relative max-w-[85%] text-[15px] leading-7",
                    message.role === 'user' ? "text-right" : "text-left"
                  )}>
                    <div className={cn(
                      "inline-block px-5 py-3.5 text-left shadow-sm border",
                      message.role === 'user' 
                        ? "bg-zinc-900 text-white rounded-2xl rounded-tr-sm border-zinc-900" 
                        : "bg-white text-zinc-800 rounded-2xl rounded-tl-sm border-zinc-100"
                    )}>
                      {message.role === 'user' ? (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      ) : (
                        <div className="space-y-3">
                          {/* 思考过程（Agentic 模式） */}
                          {message.thinking && message.thinking.length > 0 && (
                            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3 text-sm">
                              <div className="flex items-center gap-2 text-amber-700 font-medium mb-2">
                                <Zap className="w-3.5 h-3.5" />
                                <span>思考过程</span>
                              </div>
                              <div className="space-y-1.5 text-amber-900/70">
                                {message.thinking.map((step: string, i: number) => (
                                  <div key={i} className="flex items-start gap-2">
                                    <span className="text-amber-400 mt-0.5">›</span>
                                    <span>{step}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* 回答内容 */}
                          {(() => {
                            // 检查是否包含图表
                            const hasDiagram = hasMermaidDiagram(message.content);
                            const mermaidSyntax = hasDiagram ? extractMermaidFromMessage(message.content) : null;
                            const textContent = hasDiagram ? removesMermaidFromMessage(message.content) : message.content;
                            
                            return (
                              <>
                                {/* 文本内容 */}
                                {textContent && (
                                  <div className="prose prose-sm max-w-none prose-neutral prose-p:text-zinc-600 prose-headings:text-zinc-800">
                                    {showTypewriter ? (
                                      <TypewriterText 
                                        text={textContent} 
                                        onComplete={() => {
                                          setMessages((prev: Message[]) => 
                                            prev.map((m: Message) => 
                                              m.id === message.id ? { ...m, isNew: false } : m
                                            )
                                          );
                                        }}
                                      />
                                    ) : (
                                      <ReactMarkdown>{textContent}</ReactMarkdown>
                                    )}
                                  </div>
                                )}
                                
                                {/* 图表内容 */}
                                {hasDiagram && mermaidSyntax && (
                                  <div className="mt-3 w-[560px]">
                                    <DiagramMessage mermaidSyntax={mermaidSyntax} />
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                    
                    {/* Copy Button for Assistant */}
                    {message.role === 'assistant' && !message.isError && !hasMermaidDiagram(message.content) && (
                      <div className="mt-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button
                          onClick={() => copyToClipboard(message.content, message.id)}
                          className="text-zinc-400 hover:text-zinc-600 transition-colors flex items-center gap-1 text-xs"
                        >
                          {copiedId === message.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === message.id ? '已复制' : '复制'}
                        </button>
                      </div>
                    )}
                    
                    {/* 检索来源展示 */}
                    {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                      <RetrievalPanel sources={message.sources} messageId={message.id} />
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-6">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white border border-zinc-200 flex items-center justify-center shadow-sm">
                  <Bot className="w-5 h-5 text-zinc-600" />
                </div>
                <div className="inline-block px-5 py-4 bg-white border border-zinc-100 rounded-2xl rounded-tl-sm shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-6 bg-white">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSubmit} className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 rounded-2xl opacity-50 blur transition duration-500 group-hover:opacity-75" />
              <div className="relative flex items-center bg-white rounded-2xl border border-zinc-200 shadow-sm group-hover:border-zinc-300 transition-colors">
                {/* Mode Switcher */}
                <div className="relative ml-3">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowModeMenu(!showModeMenu); }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                      ragMode === 'agentic'
                        ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    )}
                  >
                    {ragMode === 'agentic' ? (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Agent</span>
                      </>
                    ) : (
                      <>
                        <Bot className="w-3.5 h-3.5" />
                        <span>RAG</span>
                      </>
                    )}
                    <ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                  
                  {/* Dropdown Menu */}
                  {showModeMenu && (
                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-xl border border-zinc-200 shadow-lg overflow-hidden z-50">
                      <div className="p-1">
                        <button
                          type="button"
                          onClick={() => { setRagMode('normal'); setShowModeMenu(false); }}
                          className={cn(
                            "w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors",
                            ragMode === 'normal' ? "bg-zinc-100" : "hover:bg-zinc-50"
                          )}
                        >
                          <Bot className="w-4 h-4 mt-0.5 text-zinc-500" />
                          <div>
                            <div className="text-sm font-medium text-zinc-800">普通 RAG</div>
                            <div className="text-xs text-zinc-400 mt-0.5">快速检索，一次响应</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRagMode('agentic'); setShowModeMenu(false); }}
                          className={cn(
                            "w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors",
                            ragMode === 'agentic' ? "bg-amber-50" : "hover:bg-zinc-50"
                          )}
                        >
                          <Zap className="w-4 h-4 mt-0.5 text-amber-500" />
                          <div>
                            <div className="text-sm font-medium text-zinc-800">Agentic RAG</div>
                            <div className="text-xs text-zinc-400 mt-0.5">智能推理，多轮迭代</div>
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-6 w-px bg-zinc-200 mx-2" />

                <Input
                  ref={inputRef}
                  value={input}
                  // @ts-ignore
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                  placeholder={ragMode === 'agentic' ? "让 Agent 帮你深度分析..." : "给知识库发送消息..."}
                  disabled={loading}
                  className="flex-1 pl-2 pr-14 py-7 bg-transparent border-0 focus-visible:ring-0 placeholder:text-zinc-400 text-zinc-800"
                />
                <Button 
                  type="submit" 
                  size="icon"
                  disabled={loading || !input.trim()}
                  className={cn(
                    "absolute right-3 w-9 h-9 rounded-xl transition-all duration-300",
                    input.trim() 
                      ? "bg-zinc-900 text-white hover:bg-zinc-800 shadow-md hover:shadow-lg" 
                      : "bg-zinc-100 text-zinc-300 cursor-not-allowed"
                  )}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </form>
            <p className="text-[10px] text-center text-zinc-300 mt-3 font-medium tracking-wide uppercase">
              {ragMode === 'agentic' ? 'Powered by Agentic RAG (ReAct Agent)' : 'Powered by RAG Knowledge Base'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
