'use client';

// @ts-ignore - React 18 types
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  ArrowLeft, Send, Bot, User, Github, Code2, ChevronDown, ChevronUp, 
  FileCode, Copy, Check, Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeftOpen,
  X, ExternalLink, Loader2, AlertCircle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
// @ts-ignore - react-syntax-highlighter types issue
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import DiagramMessage, { extractMermaidFromMessage, hasMermaidDiagram, removesMermaidFromMessage } from '@/components/DiagramMessage';

// ========================
// 类型定义
// ========================

interface SourceNode {
  type: string;
  content: string;
  score?: number;
  filePath?: string;
  language?: string;
  startLine?: number;
  endLine?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceNode[];
  isError?: boolean;
  isNew?: boolean;
}

interface CodeBase {
  id: string;
  name: string;
  githubUrl: string;
  branch: string;
}

interface ChatHistory {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  sourceNodes?: string; // JSON 字符串，包含 SourceNode[]
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

interface FilePreview {
  filePath: string;
  startLine?: number;
  endLine?: number;
  content?: string;
  language?: string;
  loading?: boolean;
  error?: string;
}

// ========================
// 组件
// ========================

// 代码块组件 - 支持语法高亮和复制
const CodeBlock = ({ language, value }: { language: string; value: string }) => {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4 rounded-lg overflow-hidden border border-zinc-200 bg-zinc-900 w-full">
      {/* 头部：语言标签和复制按钮 */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <span className="text-xs font-medium text-zinc-400 uppercase">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {/* 代码内容 */}
      <div className="overflow-x-auto">
        {/* @ts-ignore */}
        <SyntaxHighlighter
          language={language || 'typescript'}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: '1rem',
            fontSize: '0.8rem',
            lineHeight: '1.6',
            background: '#1e1e1e',
            minWidth: 'fit-content',
          }}
          showLineNumbers
          lineNumberStyle={{ 
            color: '#6b7280', 
            paddingRight: '1rem', 
            minWidth: '2rem',
            background: 'transparent',
            borderRight: 'none',
          }}
          codeTagProps={{
            style: { background: 'transparent' }
          }}
          wrapLongLines={false}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

// 自定义 Markdown 渲染组件
const MarkdownContent = ({ 
  content, 
}: { 
  content: string; 
}) => {
  return (
    <ReactMarkdown
      components={{
        code({ node, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          const isInline = !match && !className;
          const codeText = String(children).replace(/\n$/, '');
          
          if (isInline) {
            // 所有内联代码使用统一的灰色样式
            return (
              <code className="px-1.5 py-0.5 bg-zinc-100 text-zinc-800 rounded text-[13px] font-mono break-all" {...props}>
                {children}
              </code>
            );
          }
          
          return (
            <CodeBlock 
              language={match ? match[1] : ''} 
              value={codeText} 
            />
          );
        },
        // 文件路径引用样式
        p({ children }: any) {
          const text = String(children);
          // 检测是否包含 "文件:" 或 "行号:" 模式
          if (text.match(/^(文件|在)\s*[:：]/)) {
            return (
              <p className="flex items-center gap-2 text-sm text-zinc-600 my-2 p-2 bg-zinc-50 rounded-lg border border-zinc-100">
                <FileCode className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                {children}
              </p>
            );
          }
          return <p className="my-2">{children}</p>;
        },
        // 列表样式
        ul({ children }: any) {
          return <ul className="list-disc pl-5 space-y-1.5 my-3">{children}</ul>;
        },
        ol({ children }: any) {
          return <ol className="list-decimal pl-5 space-y-1.5 my-3">{children}</ol>;
        },
        li({ children }: any) {
          return <li className="text-zinc-600 leading-relaxed">{children}</li>;
        },
        // 标题样式
        h1({ children }: any) {
          return <h1 className="text-lg font-bold text-zinc-900 mt-5 mb-2 border-b border-zinc-100 pb-1">{children}</h1>;
        },
        h2({ children }: any) {
          return <h2 className="text-base font-semibold text-zinc-800 mt-4 mb-2">{children}</h2>;
        },
        h3({ children }: any) {
          return <h3 className="text-sm font-semibold text-zinc-700 mt-3 mb-1">{children}</h3>;
        },
        // 强调样式
        strong({ children }: any) {
          return <strong className="font-semibold text-zinc-800">{children}</strong>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

// 打字机效果组件
const TypewriterText = ({ 
  text, 
  onComplete,
}: { 
  text: string; 
  onComplete?: () => void;
}) => {
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

  return <MarkdownContent content={displayedText} />;
};

// 代码源面板组件
const CodeSourcePanel = ({ 
  sources, 
  messageId,
  onFileClick 
}: { 
  sources: SourceNode[]; 
  messageId: string;
  onFileClick?: (filePath: string, startLine?: number, endLine?: number) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
      >
        <Code2 className="w-3.5 h-3.5" />
        <span>代码来源 ({sources.length})</span>
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      
      {isExpanded && (
        <div className="mt-2 space-y-1">
          {sources.map((source, idx) => (
            <button
              key={idx}
              onClick={() => onFileClick?.(source.filePath || '', source.startLine, source.endLine)}
              className="w-full flex items-center justify-between px-3 py-2 text-left border border-zinc-200 rounded-lg hover:bg-emerald-50 hover:border-emerald-200 transition-colors group"
              title="点击在右侧查看代码"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileCode className="w-3.5 h-3.5 text-zinc-400 group-hover:text-emerald-600 flex-shrink-0" />
                <span className="text-xs font-mono text-zinc-700 group-hover:text-emerald-700 truncate">{source.filePath}</span>
                {source.startLine && (
                  <span className="text-xs px-1.5 py-0.5 bg-zinc-100 group-hover:bg-emerald-100 text-zinc-500 group-hover:text-emerald-600 rounded flex-shrink-0">:{source.startLine}</span>
                )}
              </div>
              {source.score !== undefined && (
                <span className="text-xs text-zinc-400 ml-2 flex-shrink-0">({(source.score * 100).toFixed(0)}%)</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ========================
// 主页面
// ========================

export default function CodebaseChatPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  
  // 状态
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  // 保持 messagesRef 与 messages 同步
  messagesRef.current = messages;
  
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [codeBase, setCodeBase] = useState<CodeBase | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const codePreviewRef = useRef<HTMLDivElement>(null);

  // 滚动到指定行
  useEffect(() => {
    if (filePreview?.content && filePreview?.startLine && codePreviewRef.current) {
      // 等待 DOM 渲染完成
      requestAnimationFrame(() => {
        const lineHeight = 1.6 * 12.8; // 1.6 行高 * 0.8rem 字体大小 ≈ 20.48px
        const targetLine = filePreview.startLine || 1;
        const scrollTop = Math.max(0, (targetLine - 3) * lineHeight); // 往上留3行缓冲
        
        if (codePreviewRef.current) {
          codePreviewRef.current.scrollTop = scrollTop;
        }
      });
    }
  }, [filePreview?.content, filePreview?.startLine]);

  // 打开文件预览
  const openFilePreview = async (filePath: string, startLine?: number, endLine?: number) => {
    // 使用 ref 获取最新的 messages，避免闭包陈旧问题
    const currentMessages = messagesRef.current;
    
    // 清理 filePath：移除可能附带的行号信息（如 :1578-1784）
    let cleanFilePath = filePath;
    const lineMatch = filePath.match(/^(.+):(\d+)-(\d+)$/);
    if (lineMatch) {
      cleanFilePath = lineMatch[1];
      if (!startLine) {
        startLine = parseInt(lineMatch[2], 10);
        endLine = parseInt(lineMatch[3], 10);
      }
    }
    
    // 如果没有传入行号，尝试从所有消息的 sources 中查找
    if (!startLine) {
      for (const msg of currentMessages) {
        if (msg.sources && msg.sources.length > 0) {
          const source = msg.sources.find((s: SourceNode) => 
            s.filePath && (s.filePath === cleanFilePath || cleanFilePath.endsWith(s.filePath) || s.filePath.endsWith(cleanFilePath))
          );
          if (source?.startLine) {
            startLine = source.startLine;
            endLine = source.endLine;
            break;
          }
        }
      }
    }
    setFilePreview({
      filePath: cleanFilePath,
      startLine,
      endLine,
      loading: true,
    });

    try {
      // 获取完整文件内容，由前端负责切片显示
      const queryParams = new URLSearchParams({ path: cleanFilePath });
      // 不传 startLine/endLine 给 API，获取完整文件

      const response = await fetch(`/api/codebases/${params.id}/file?${queryParams}`);
      if (response.ok) {
        const data = await response.json();
        setFilePreview({
          filePath: data.filePath,
          content: data.content,
          language: data.language,
          startLine: startLine || 1,  // 保留原始 startLine 用于前端高亮
          endLine: endLine || data.lineCount,
          loading: false,
        });
      } else {
        const error = await response.json();
        setFilePreview((prev: FilePreview | null) => prev ? { ...prev, loading: false, error: error.error } : null);
      }
    } catch (error: any) {
      setFilePreview((prev: FilePreview | null) => prev ? { ...prev, loading: false, error: error.message } : null);
    }
  };

  // 初始化
  useEffect(() => {
    fetchCodeBase();
    fetchSessions();
  }, [params.id]);

  // 加载会话消息
  useEffect(() => {
    if (currentSessionId && !isSubmitting) {
      fetchSessionMessages(currentSessionId);
    }
  }, [currentSessionId, isSubmitting]);

  // 滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 获取代码库信息
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
    }
  };

  // 获取会话列表
  const fetchSessions = async () => {
    try {
      // 复用知识库的会话 API，使用 codebase_ 前缀
      const response = await fetch(`/api/chat/sessions/codebase_${params.id}`);
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

  // 获取会话消息
  const fetchSessionMessages = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/chat/session/${sessionId}`);
      if (response.ok) {
        const history: ChatHistory[] = await response.json();
        const formattedMessages: Message[] = history.flatMap((h) => {
          // 解析 sourceNodes JSON 字符串
          let sources: SourceNode[] | undefined;
          if (h.sourceNodes) {
            try {
              sources = JSON.parse(h.sourceNodes);
            } catch (e) {
              console.error('解析 sourceNodes 失败:', e);
            }
          }
          return [
            { id: `${h.id}-q`, role: 'user' as const, content: h.question, isNew: false },
            { id: `${h.id}-a`, role: 'assistant' as const, content: h.answer, sources, isNew: false },
          ];
        });
        setMessages(formattedMessages);
      }
    } catch (error) {
      console.error('获取会话消息失败:', error);
    }
  };

  // 创建新会话
  const createNewSession = async () => {
    try {
      const response = await fetch(`/api/chat/sessions/codebase_${params.id}`, {
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

  // 删除会话
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

  // 发送消息
  // @ts-ignore
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    setIsSubmitting(true);

    // 如果没有当前会话，创建新会话
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const response = await fetch(`/api/chat/sessions/codebase_${params.id}`, {
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
      } catch (error) {
        console.error('创建会话失败:', error);
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
      const response = await fetch(`/api/codebases/${params.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: currentInput,
          sessionId: sessionId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        
        console.log('[handleSubmit] 收到响应 data.sourceNodes:', data.sourceNodes);
        console.log('[handleSubmit] sourceNodes 长度:', data.sourceNodes?.length);
        if (data.sourceNodes?.length > 0) {
          console.log('[handleSubmit] 第一个 source:', JSON.stringify(data.sourceNodes[0]));
        }
        
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.answer,
          sources: data.sourceNodes,
          isNew: true,
        };
        setMessages((prev: Message[]) => [...prev, assistantMessage]);
        fetchSessions(); // 刷新会话列表（更新标题）
      } else {
        const error = await response.json();
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `错误: ${error.error}`,
          isError: true,
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
      };
      setMessages((prev: Message[]) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      setIsSubmitting(false);
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

  // 按日期分组会话
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
      {/* Sidebar */}
      <div
        className={cn(
          "flex-shrink-0 bg-emerald-50/50 flex flex-col transition-all duration-300 ease-in-out border-r border-emerald-100",
          showSidebar ? "w-[260px]" : "w-0"
        )}
      >
        <div className={cn("flex flex-col h-full w-[260px] overflow-hidden", showSidebar ? "opacity-100" : "opacity-0")}>
          <div className="p-3">
            <button
              onClick={createNewSession}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-emerald-200 bg-white text-zinc-900 hover:bg-emerald-50 hover:border-emerald-300 transition-all shadow-sm text-sm text-left group"
            >
              <Plus className="w-4 h-4 text-emerald-500 group-hover:text-emerald-600 transition-colors" />
              <span className="font-medium flex-1">新对话</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin scrollbar-thumb-emerald-200 scrollbar-track-transparent">
            {Object.keys(groupedSessions).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                  <MessageSquare className="w-5 h-5 text-emerald-400" />
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
                      {sessionList.map((s) => (
                        <div
                          key={s.id}
                          className={cn(
                            "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer text-sm",
                            currentSessionId === s.id
                              ? "bg-white text-zinc-900 shadow-sm ring-1 ring-emerald-200"
                              : "text-zinc-600 hover:bg-emerald-100/50 hover:text-zinc-900"
                          )}
                          onClick={() => loadSession(s.id)}
                        >
                          <span className="truncate flex-1 font-normal">
                            {s.title}
                          </span>
                          <div className={cn(
                            "absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l pointer-events-none",
                            currentSessionId === s.id ? "from-white" : "from-emerald-50/50 group-hover:from-emerald-100/50"
                          )} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSession(s.id);
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

          <div className="p-3 border-t border-emerald-100">
            <div className="flex items-center gap-3 px-2 py-2 text-zinc-500 hover:bg-emerald-100/50 rounded-lg transition-colors cursor-pointer">
              <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white text-xs font-bold">
                {session?.user?.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 truncate">{session?.user?.name || '用户'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area with Code Preview Layout */}
      <div className="flex flex-1 min-w-0 relative overflow-hidden">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-white relative transition-all duration-300 ease-in-out">
          {/* Dynamic Background */}
          <div className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.2]" />
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-emerald-100/30 to-teal-100/30 blur-[100px] rounded-full" />
          </div>

        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm p-3 flex items-center justify-between border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => router.push(`/dashboard/codebase/${params.id}`)} 
              className="text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              title="返回代码库"
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
            <div className="flex items-center gap-2 ml-2">
              <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
                <Github className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-medium text-zinc-700 text-sm">{codeBase?.name || '代码问答'}</span>
                {codeBase && (
                  <span className="text-[10px] text-zinc-400 font-mono">{codeBase.branch}</span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
            <Code2 className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700">代码问答</span>
          </div>
        </header>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto scroll-smooth">
            <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
              {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center opacity-0 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-forwards">
                <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mb-6 shadow-sm border border-emerald-100">
                  <Code2 className="w-8 h-8 text-emerald-500" />
                </div>
                <h2 className="text-xl font-semibold text-zinc-800 mb-2">问我关于代码的任何问题</h2>
                <p className="text-zinc-400 text-sm max-w-md">
                  我可以帮你理解代码逻辑、查找函数定义、解释架构设计、或者回答任何关于这个代码库的问题
                </p>
                <div className="mt-8 flex flex-wrap gap-2 justify-center max-w-lg">
                  {[
                    '这个项目的主要功能是什么？',
                    '入口文件在哪里？',
                    '如何添加新的 API 端点？',
                    '解释一下数据库模型的设计',
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(suggestion)}
                      className="px-3 py-2 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-600 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message: Message) => {
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
                      ? "bg-white border-emerald-200" 
                      : "bg-zinc-900 border-zinc-900"
                  )}>
                    {message.role === 'assistant' ? (
                      <Code2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <User className="w-4 h-4 text-white" />
                    )}
                  </div>
                  
                  {/* Content */}
                  <div className={cn(
                    "relative text-[15px] leading-7 min-w-0",
                    message.role === 'user' ? "text-right max-w-[85%]" : "text-left max-w-[calc(100%-3rem)]"
                  )}>
                    <div className={cn(
                      "px-5 py-3.5 text-left shadow-sm border",
                      message.role === 'user' 
                        ? "inline-block bg-zinc-900 text-white rounded-2xl rounded-tr-sm border-zinc-900" 
                        : message.isError
                        ? "bg-red-50 text-red-700 rounded-2xl rounded-tl-sm border-red-200"
                        : "bg-white text-zinc-800 rounded-2xl rounded-tl-sm border-zinc-100"
                    )}>
                      {message.role === 'user' ? (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      ) : (
                        <div className="space-y-3 min-w-0">
                          {/* 文本内容 */}
                          {(() => {
                            const hasDiagram = hasMermaidDiagram(message.content);
                            const textContent = hasDiagram ? removesMermaidFromMessage(message.content) : message.content;
                            const mermaidCode = hasDiagram ? extractMermaidFromMessage(message.content) : null;
                            
                            return (
                              <>
                                {textContent && (
                                  <div className="prose prose-sm max-w-full prose-neutral prose-p:text-zinc-600 prose-headings:text-zinc-800 prose-code:text-emerald-600 prose-code:bg-emerald-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded [&>*]:max-w-full">
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
                                      <MarkdownContent content={textContent} />
                                    )}
                                  </div>
                                )}
                                {/* 流程图 */}
                                {mermaidCode && (
                                  <DiagramMessage mermaidSyntax={mermaidCode} className="mt-4" />
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                    
                    {/* Copy Button for Assistant */}
                    {message.role === 'assistant' && !message.isError && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => copyToClipboard(message.content, message.id)}
                          className="text-zinc-400 hover:text-zinc-600 transition-colors flex items-center gap-1 text-xs"
                        >
                          {copiedId === message.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === message.id ? '已复制' : '复制'}
                        </button>
                      </div>
                    )}
                    
                    {/* 代码来源展示 */}
                    {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                      <CodeSourcePanel 
                        sources={message.sources} 
                        messageId={message.id} 
                        onFileClick={openFilePreview}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-6">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white border border-emerald-200 flex items-center justify-center shadow-sm">
                  <Code2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="inline-block px-5 py-4 bg-white border border-zinc-100 rounded-2xl rounded-tl-sm shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" />
                    </div>
                    <span className="text-xs text-zinc-400">分析代码中...</span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

          {/* Input Area */}
          <div className="p-4 bg-white/80 backdrop-blur-sm border-t border-zinc-100">
            <div className="max-w-4xl mx-auto relative">
              <form
                onSubmit={handleSubmit}
                className="relative"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="输入你的问题，例如：解释一下核心架构..."
                  className="w-full pl-4 pr-12 py-3 bg-white border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm text-sm"
                  disabled={isSubmitting}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isSubmitting}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-zinc-900 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-zinc-900 transition-colors"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>
              <div className="text-center mt-2">
                <span className="text-[10px] text-zinc-400">
                  AI 可能产生错误，请核对重要信息
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧代码预览面板 */}
        {filePreview && (
          <div className="flex-shrink-0 w-[550px] bg-zinc-50 flex flex-col border-l border-zinc-200 animate-in slide-in-from-right duration-200 h-full">
            {/* 面板头部 */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-white border-b border-zinc-100">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                <span className="text-sm font-medium text-zinc-700 truncate" title={filePreview.filePath}>
                  {filePreview.filePath.split('/').pop()}
                </span>
                {filePreview.startLine && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 flex-shrink-0 font-mono">
                    :{filePreview.startLine}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                {codeBase?.githubUrl && (
                  <a
                    href={`${codeBase.githubUrl}/blob/${codeBase.branch || 'main'}/${filePreview.filePath}${filePreview.startLine ? `#L${filePreview.startLine}` : ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded transition-colors"
                    title="在 GitHub 中打开"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  onClick={() => setFilePreview(null)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 代码内容 */}
            <div ref={codePreviewRef} className="flex-1 overflow-auto bg-zinc-50 min-h-0">
              {filePreview.loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                </div>
              ) : filePreview.error ? (
                <div className="flex flex-col items-center justify-center py-20 text-center p-4">
                  <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
                  <p className="text-red-400 text-sm">{filePreview.error}</p>
                </div>
              ) : filePreview.content ? (
                (() => {
                  const lines = filePreview.content.split('\n');
                  const totalLines = lines.length;
                  const targetLine = filePreview.startLine || 1;
                  const contextBefore = 10;
                  const contextAfter = 60;
                  
                  const startIdx = Math.max(0, targetLine - 1 - contextBefore);
                  const endIdx = Math.min(totalLines, targetLine - 1 + contextAfter);
                  
                  const hasTopEllipsis = startIdx > 0;
                  const hasBottomEllipsis = endIdx < totalLines;
                  
                  const visibleLines = lines.slice(startIdx, endIdx);
                  const visibleContent = visibleLines.join('\n');
                  const displayStartLine = startIdx + 1;

                  return (
                    <div className="font-mono text-sm">
                      {/* 顶部省略 */}
                      {hasTopEllipsis && (
                        <div className="sticky top-0 px-6 py-1.5 text-zinc-400 text-xs border-b border-zinc-200 bg-zinc-100/80 backdrop-blur flex items-center gap-2 z-10">
                          <span className="text-zinc-300">⋮</span>
                          <span>第 1-{startIdx} 行已省略</span>
                        </div>
                      )}
                      
                      {/* 代码块 */}
                      {/* @ts-ignore */}
                      <SyntaxHighlighter
                        language={filePreview.language || 'typescript'}
                        style={oneLight}
                        customStyle={{
                          margin: 0,
                          padding: '0.75rem 1rem',
                          fontSize: '12px',
                          lineHeight: '1.5',
                          background: 'transparent',
                        }}
                        showLineNumbers
                        startingLineNumber={displayStartLine}
                        lineNumberStyle={{ 
                          color: '#9ca3af', 
                          paddingRight: '1rem', 
                          minWidth: '2.5rem',
                          textAlign: 'right',
                          background: 'transparent',
                          userSelect: 'none',
                          fontSize: '11px',
                        }}
                        wrapLines
                        lineProps={(lineNumber: number) => {
                          const actualLineNumber = displayStartLine + lineNumber - 1;
                          const isTarget = filePreview.startLine && actualLineNumber === filePreview.startLine;
                          return {
                            style: {
                              display: 'block',
                              backgroundColor: isTarget ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                              borderLeft: isTarget ? '2px solid #10b981' : '2px solid transparent',
                              marginLeft: '-2px',
                              width: '100%',
                            },
                          };
                        }}
                        codeTagProps={{
                          style: { 
                            background: 'transparent',
                            fontFamily: 'inherit',
                          }
                        }}
                      >
                        {visibleContent}
                      </SyntaxHighlighter>
                      
                      {/* 底部省略 */}
                      {hasBottomEllipsis && (
                        <div className="sticky bottom-0 px-6 py-1.5 text-zinc-400 text-xs border-t border-zinc-200 bg-zinc-100/80 backdrop-blur flex items-center gap-2">
                          <span className="text-zinc-300">⋮</span>
                          <span>第 {endIdx + 1}-{totalLines} 行已省略</span>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-500">
                  文件内容为空
                </div>
              )}
            </div>
            
            {/* 底部状态栏 */}
            <div className="flex-shrink-0 px-3 py-1.5 bg-white border-t border-zinc-100 text-[10px] text-zinc-400 flex justify-between">
              <span>{filePreview.language}</span>
              <span>{filePreview.filePath}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
