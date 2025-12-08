'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Download, Maximize2, Minimize2, RefreshCw, Code } from 'lucide-react';

// 动态导入 Excalidraw（包含样式）
const Excalidraw = dynamic(
  async () => {
    // 确保样式加载
    await import('@excalidraw/excalidraw/index.css');
    return (await import('@excalidraw/excalidraw')).Excalidraw;
  },
  { ssr: false, loading: () => <DiagramSkeleton /> }
);

// 加载骨架屏
function DiagramSkeleton() {
  return (
    <div className="w-full h-[400px] bg-zinc-50 rounded-xl flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
        <span className="text-sm text-zinc-400">加载图表组件...</span>
      </div>
    </div>
  );
}

interface DiagramMessageProps {
  mermaidSyntax: string;
  className?: string;
}

export default function DiagramMessage({ mermaidSyntax, className = '' }: DiagramMessageProps) {
  const [elements, setElements] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [showCode, setShowCode] = useState(false);

  // 解析 Mermaid 语法并转换为 Excalidraw 元素
  useEffect(() => {
    async function parseMermaid() {
      setIsLoading(true);
      setError(null);

      try {
        console.log('[DiagramMessage] Parsing Mermaid syntax:', mermaidSyntax);
        
        // 动态导入 mermaid-to-excalidraw
        const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
        const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw');

        // 解析 Mermaid 语法
        const { elements: mermaidElements } = await parseMermaidToExcalidraw(mermaidSyntax, {
          themeVariables: {
            fontSize: '16px',
          },
        });

        console.log('[DiagramMessage] Mermaid elements:', mermaidElements);

        if (!mermaidElements || mermaidElements.length === 0) {
          throw new Error('Mermaid 解析结果为空');
        }

        // 转换为 Excalidraw 元素
        let excalidrawElements = convertToExcalidrawElements(mermaidElements) as any[];

        console.log('[DiagramMessage] Excalidraw elements:', excalidrawElements.length);

        // 为容器添加内边距
        excalidrawElements = addPaddingToContainers(excalidrawElements, 10);

        setElements(excalidrawElements);
      } catch (err: any) {
        console.error('[DiagramMessage] Failed to parse Mermaid:', err);
        setError(err.message || '图表解析失败');
      } finally {
        setIsLoading(false);
      }
    }

    if (mermaidSyntax) {
      parseMermaid();
    }
  }, [mermaidSyntax]);

  // 为容器添加内边距
  const addPaddingToContainers = (elements: any[], padding: number = 10): any[] => {
    return elements.map(element => {
      if (['rectangle', 'diamond', 'ellipse'].includes(element.type)) {
        const w = element.width;
        const h = element.height;
        const x = element.x;
        const y = element.y;
        
        const newWidth = w + padding * 2;
        const newHeight = h + padding * 2;
        const newX = x - padding;
        const newY = y - padding;
        
        return {
          ...element,
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        };
      }
      return element;
    });
  };

  // 自动适应内容（初始化和全屏切换时）
  useEffect(() => {
    if (excalidrawAPI && elements.length > 0) {
      setTimeout(() => {
        excalidrawAPI.scrollToContent(elements, {
          fitToContent: true,
          animate: true,
          duration: 300,
        });
      }, 100);
    }
  }, [excalidrawAPI, elements, isFullscreen]);

  // 导出为 PNG
  const handleExport = async () => {
    if (!elements || elements.length === 0) return;

    try {
      const { exportToBlob } = await import('@excalidraw/excalidraw');
      
      const blob = await exportToBlob({
        elements,
        mimeType: 'image/png',
        appState: {
          viewBackgroundColor: '#ffffff',
        },
        files: null,
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `diagram-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  // 生成唯一 key
  const canvasKey = useMemo(() => {
    if (elements.length === 0) return 'empty';
    return JSON.stringify(elements.map(el => el.id)).slice(0, 50);
  }, [elements]);

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-xl p-4 ${className}`}>
        <div className="flex items-center gap-2 text-red-600 mb-2">
          <RefreshCw className="w-4 h-4" />
          <span className="font-medium">图表渲染失败</span>
        </div>
        <p className="text-sm text-red-500">{error}</p>
        <details className="mt-2">
          <summary className="text-xs text-red-400 cursor-pointer">查看原始语法</summary>
          <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto max-h-40">
            {mermaidSyntax}
          </pre>
        </details>
      </div>
    );
  }

  if (isLoading) {
    return <DiagramSkeleton />;
  }

  return (
    <div className={`relative ${className}`}>
      {/* 工具栏 */}
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <button
          onClick={() => setShowCode(!showCode)}
          className={`p-2 rounded-lg shadow-sm border transition-colors ${
            showCode 
              ? 'bg-zinc-900 text-white border-zinc-900' 
              : 'bg-white/90 hover:bg-white border-zinc-200 text-zinc-600 hover:text-zinc-900'
          }`}
          title="查看 Mermaid 代码"
        >
          <Code className="w-4 h-4" />
        </button>
        <button
          onClick={handleExport}
          className="p-2 bg-white/90 hover:bg-white rounded-lg shadow-sm border border-zinc-200 text-zinc-600 hover:text-zinc-900 transition-colors"
          title="导出为 PNG"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="p-2 bg-white/90 hover:bg-white rounded-lg shadow-sm border border-zinc-200 text-zinc-600 hover:text-zinc-900 transition-colors"
          title={isFullscreen ? '退出全屏' : '全屏查看'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* 代码查看面板 */}
      {showCode && (
        <div className="mb-2 bg-zinc-900 rounded-xl p-4 overflow-auto max-h-[200px]">
          <pre className="text-sm text-green-400 font-mono whitespace-pre-wrap">
            {mermaidSyntax}
          </pre>
        </div>
      )}

      {/* 图表容器 */}
      <div 
        className={`
          bg-white rounded-xl border border-zinc-200 overflow-hidden
          ${isFullscreen ? 'fixed inset-4 z-50' : 'h-[320px]'}
        `}
      >
        {/* 全屏模式下的退出按钮 */}
        {isFullscreen && (
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 z-[60] flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg shadow-lg transition-colors"
          >
            <Minimize2 className="w-4 h-4" />
            <span>退出全屏</span>
          </button>
        )}
        {elements.length > 0 && (
          <Excalidraw
            key={canvasKey}
            excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
            initialData={{
              elements: elements,
              appState: {
                viewBackgroundColor: '#ffffff',
                currentItemFontFamily: 1,
                zoom: { value: 1 as any },
              },
              scrollToContent: true,
            }}
            viewModeEnabled={true}
            UIOptions={{
              canvasActions: {
                export: { saveFileToDisk: false },
                loadScene: false,
                clearCanvas: false,
                changeViewBackgroundColor: false,
                saveAsImage: false,
              },
              tools: {
                image: false,
              },
            }}
          />
        )}
      </div>

      {/* 全屏遮罩 */}
      {isFullscreen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsFullscreen(false)}
        />
      )}
    </div>
  );
}

/**
 * 从消息内容中提取 Mermaid 语法
 * 支持两种格式：[MERMAID_DIAGRAM] 和 ```mermaid
 */
export function extractMermaidFromMessage(content: string): string | null {
  // 格式1: [MERMAID_DIAGRAM]...[/MERMAID_DIAGRAM]
  const match1 = content.match(/\[MERMAID_DIAGRAM\]\n?([\s\S]*?)\n?\[\/MERMAID_DIAGRAM\]/);
  if (match1) {
    return match1[1].trim();
  }
  
  // 格式2: ```mermaid ... ```
  const match2 = content.match(/```mermaid\s*\n([\s\S]*?)\n```/);
  if (match2) {
    return match2[1].trim();
  }
  
  // 格式3: 直接以 flowchart 或 sequenceDiagram 开头的代码块
  const match3 = content.match(/```\s*\n?((?:flowchart|sequenceDiagram)[\s\S]*?)\n?```/);
  if (match3) {
    return match3[1].trim();
  }
  
  return null;
}

/**
 * 检查消息是否包含图表
 */
export function hasMermaidDiagram(content: string): boolean {
  return content.includes('[MERMAID_DIAGRAM]') || 
         content.includes('```mermaid') ||
         /```\s*\n?(?:flowchart|sequenceDiagram)/.test(content);
}

/**
 * 从消息中移除 Mermaid 标记，返回纯文本部分
 */
export function removesMermaidFromMessage(content: string): string {
  return content
    .replace(/\[MERMAID_DIAGRAM\][\s\S]*?\[\/MERMAID_DIAGRAM\]/g, '')
    .replace(/```mermaid\s*\n[\s\S]*?\n```/g, '')
    .replace(/```\s*\n?(?:flowchart|sequenceDiagram)[\s\S]*?\n?```/g, '')
    .trim();
}

