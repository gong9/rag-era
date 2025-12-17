'use client';

// @ts-ignore
import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { 
  Search, 
  FileText, 
  Globe, 
  Clock, 
  BarChart3, 
  Cpu,
  Zap,
  BookOpen,
  ArrowRight,
  Github,
  ChevronDown,
  Sparkles,
  Target,
  Shield,
  Wrench,
  Network,
  Brain,
  Layers,
  RefreshCw,
  Scissors
} from 'lucide-react';

// Agent 工具数据
const agentTools = [
  { icon: Search, name: '知识检索', desc: '精准检索 Top-3，混合搜索' },
  { icon: Target, name: '深度检索', desc: '深度检索 Top-8，混合搜索' },
  { icon: Network, name: '图谱检索', desc: 'LightRAG 知识图谱推理' },
  { icon: FileText, name: '主题总结', desc: '直接读取原文进行总结' },
  { icon: BookOpen, name: '关键词搜索', desc: 'Meilisearch 精确匹配' },
  { icon: Globe, name: '网页搜索', desc: 'SearXNG 搜索互联网' },
  { icon: Clock, name: '时间获取', desc: '获取当前日期时间' },
  { icon: BarChart3, name: '图表生成', desc: '流程图/时序图可视化' },
];

// 评估维度数据
const evalDimensions = [
  { name: '检索质量', desc: '检索内容与问题的相关性', color: 'bg-zinc-100' },
  { name: '忠实度', desc: '回答是否基于检索内容', color: 'bg-zinc-100' },
  { name: '答案质量', desc: '正确性、完整性、清晰度', color: 'bg-zinc-100' },
  { name: '工具调用', desc: 'Agent 工具选择合理性', color: 'bg-zinc-100' },
];

// 上下文工程特性
const contextFeatures = [
  { icon: Brain, name: '智能记忆', desc: 'LLM 自动提取用户偏好、事实、指令' },
  { icon: RefreshCw, name: '新鲜度优先', desc: '最近内容权重更高，过时内容自动衰减' },
  { icon: Layers, name: '统一检索', desc: 'Memory + RAG 统一 RRF 混合搜索' },
  { icon: Scissors, name: '语义压缩', desc: 'Token 接近上限时 LLM 自动压缩' },
];

export default function LandingPage() {
  const [scrollY, setScrollY] = useState(0);
  const [mounted, setMounted] = useState(false);
  const featuresRef = useRef<HTMLDivElement>(null);
  const archRef = useRef<HTMLDivElement>(null);
  const evalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    // 强制更新标题，防止 layout metadata 未生效
    document.title = "RAG Era - 企业级知识库系统";
    
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // IntersectionObserver for scroll animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    const elements = document.querySelectorAll('.scroll-fade-in');
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div className="relative min-h-screen bg-[#fafafa] text-zinc-900 overflow-x-hidden selection:bg-zinc-900 selection:text-white">
      {/* 固定背景层 */}
      <div className="fixed inset-0 -z-10 bg-zinc-50/50">
        {/* 显式网格 */}
        <div className="absolute inset-0 bg-grid-visible opacity-100" />
        
        {/* 基础噪点 */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-multiply" />
        
        {/* 强效流光 - 垂直 */}
        <div className="beam-line left-[20%] animate-beam-v delay-1000" />
        <div className="beam-line left-[50%] animate-beam-v delay-3000 bg-gradient-to-b from-transparent via-zinc-600 to-transparent shadow-zinc-500/50" />
        <div className="beam-line left-[80%] animate-beam-v delay-5000 bg-gradient-to-b from-transparent via-teal-600 to-transparent shadow-teal-500/50" />

        {/* 强效流光 - 水平 */}
        <div className="beam-line-h top-[30%] animate-beam-h delay-2000 bg-gradient-to-r from-transparent via-zinc-600 to-transparent shadow-zinc-500/50" />
        <div className="beam-line-h top-[70%] animate-beam-h delay-4000 bg-gradient-to-r from-transparent via-orange-600 to-transparent shadow-orange-500/50" />

        {/* 随机呼吸光点 */}
        <div className="absolute top-[15%] left-[20%] w-3 h-3 bg-orange-500 rounded-full animate-blink opacity-0 shadow-[0_0_20px_rgba(249,115,22,0.8)]" style={{ animationDelay: '1s' }} />
        <div className="absolute top-[35%] right-[25%] w-3 h-3 bg-teal-500 rounded-full animate-blink opacity-0 shadow-[0_0_20px_rgba(20,184,166,0.8)]" style={{ animationDelay: '3s' }} />
        
        {/* 极淡的氛围光 */}
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_800px_at_50%_-100px,#a1a1aa0a,transparent)]" />
      </div>

      {/* 导航栏 */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-zinc-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="relative w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center">
                <div className="absolute inset-0 bg-zinc-900 rounded-lg transform rotate-3 transition-transform group-hover:rotate-6"></div>
                <div className="absolute inset-0 bg-zinc-900 rounded-lg opacity-20 transform -rotate-3 transition-transform group-hover:-rotate-6"></div>
                <span className="relative text-white font-bold font-mono text-base sm:text-lg select-none">R</span>
              </div>
              <span className="font-bold text-lg sm:text-xl tracking-tight text-zinc-900">RAG Era</span>
            </div>
            
            <div className="flex items-center gap-3 sm:gap-4">
              <a 
                href="https://github.com/gong9/rag-era" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-full text-sm text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-all"
              >
                <Github className="w-5 h-5 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">GitHub</span>
              </a>
              <Link 
                href="/login"
                className="px-3 sm:px-4 py-1.5 sm:py-2 bg-zinc-900 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-800 transition-all shadow-sm hover:shadow-md whitespace-nowrap"
              >
                登录
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero 区域 */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-16 overflow-hidden">
        {/* 浮动装饰元素 - 仅在大屏显示 */}
        <div 
          className="hidden lg:flex absolute top-32 left-[10%] w-20 h-20 bg-white border border-zinc-200 shadow-xl shadow-zinc-200/50 rounded-2xl items-center justify-center animate-float-slow"
          style={{ opacity: Math.max(0, 1 - scrollY / 400) }}
        >
          <Search className="w-8 h-8 text-zinc-800" />
        </div>
        
        <div 
          className="hidden lg:flex absolute top-48 right-[15%] w-16 h-16 bg-zinc-50 border border-zinc-200 shadow-xl shadow-zinc-200/50 rounded-xl items-center justify-center animate-float-delayed"
          style={{ opacity: Math.max(0, 1 - scrollY / 400) }}
        >
          <Sparkles className="w-6 h-6 text-zinc-600" />
        </div>
        
        <div 
          className="hidden lg:flex absolute bottom-32 left-[20%] w-14 h-14 bg-white border border-zinc-200 shadow-lg shadow-zinc-200/50 rounded-lg items-center justify-center animate-float-slow"
          style={{ opacity: Math.max(0, 1 - scrollY / 400) }}
        >
          <BarChart3 className="w-5 h-5 text-zinc-700" />
        </div>

        {/* 主标题 */}
        <div 
          className="text-center max-w-4xl mx-auto flex flex-col items-center w-full"
          style={{ opacity: Math.max(0, 1 - scrollY / 600) }}
        >
          <div className="animate-slide-up w-full">
            <span className="inline-flex items-center px-3 py-1 rounded-full border border-zinc-200 bg-white/50 backdrop-blur-sm text-xs sm:text-sm font-medium text-zinc-600 mb-6 sm:mb-8 shadow-sm">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
              Production Ready Open Source
            </span>
            <h1 className="text-5xl sm:text-7xl lg:text-9xl font-black tracking-tighter mb-6 text-zinc-900 relative z-10 leading-tight">
              RAG Era
              <span className="absolute -top-3 -right-4 sm:-top-4 sm:-right-8 text-sm sm:text-2xl font-normal text-zinc-400 tracking-normal border border-zinc-200 px-1.5 sm:px-2 py-0.5 rounded-lg rotate-12 bg-white/50">v1.0</span>
            </h1>
          </div>
          
          <p 
            className="text-lg sm:text-4xl text-zinc-600 mb-6 animate-slide-up font-light tracking-tight max-w-[90%] sm:max-w-none leading-relaxed"
            style={{ animationDelay: '0.1s' }}
          >
            拒绝 "Toy Demo"，打造<span className="font-semibold text-zinc-900 mx-1 sm:mx-2 border-b-2 sm:border-b-4 border-zinc-200/80">真正可用</span>的企业级知识库
          </p>
          
<p 
            className="text-sm sm:text-lg text-zinc-400 mb-10 sm:mb-12 animate-slide-up font-mono bg-zinc-50 px-3 sm:px-4 py-2 rounded-lg border border-zinc-100/50 max-w-[95%] sm:max-w-none"
            style={{ animationDelay: '0.2s' }}
          >
            Agentic RAG + Context Engineering —— 智能记忆 · 语义压缩 · Token 最优
          </p>
          
          <div 
            className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center animate-slide-up w-full sm:w-auto px-4 sm:px-0"
            style={{ animationDelay: '0.3s' }}
          >
            <Link 
              href="/login"
              className="group px-6 sm:px-8 py-3.5 sm:py-4 bg-zinc-900 text-white rounded-lg text-base sm:text-lg font-medium hover:bg-zinc-800 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-zinc-500/20 flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              开始使用
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a 
              href="https://github.com/gong9/rag-era"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 sm:px-8 py-3.5 sm:py-4 bg-white border border-zinc-200 text-zinc-700 rounded-lg text-base sm:text-lg font-medium hover:bg-zinc-50 hover:border-zinc-300 transition-all flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              <Github className="w-4 h-4 sm:w-5 sm:h-5" />
              查看源码
            </a>
          </div>
        </div>

        {/* 向下滚动提示 */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-6 h-6 sm:w-8 sm:h-8 text-zinc-300" />
        </div>
      </section>

      {/* 核心功能 - Agent 工具箱 */}
      <section ref={featuresRef} className="relative py-16 sm:py-32 px-4 bg-zinc-50/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 scroll-fade-in">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-zinc-900">
              Agent 工具箱
            </h2>
            <p className="text-zinc-500 text-lg max-w-2xl mx-auto">
              ReAct Agent 可自主选择工具进行多轮推理，智能路由到合适的处理流程
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {agentTools.map((tool, index) => (
              <div 
                key={tool.name}
                className="scroll-fade-in bg-white border border-zinc-200 rounded-xl p-6 hover:border-zinc-300 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-zinc-200/50 group"
                style={{ transitionDelay: `${index * 50}ms` }}
              >
                <div className="w-12 h-12 bg-zinc-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-zinc-900 transition-colors duration-300">
                  <tool.icon className="w-6 h-6 text-zinc-700 group-hover:text-white transition-colors duration-300" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-zinc-900">{tool.name}</h3>
                <p className="text-zinc-500 text-sm">{tool.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 上下文工程 */}
      <section className="relative py-16 sm:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 scroll-fade-in">
            <span className="inline-flex items-center px-3 py-1 rounded-full border border-orange-200 bg-orange-50 text-xs sm:text-sm font-medium text-orange-700 mb-4">
              <span className="flex h-2 w-2 rounded-full bg-orange-500 mr-2 animate-pulse"></span>
              Context Engineering
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-zinc-900">
              上下文工程
            </h2>
            <p className="text-zinc-500 text-lg max-w-2xl mx-auto">
              告别简单的"对话历史塞入提示词"，智能构建最优上下文
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {contextFeatures.map((feature, index) => (
              <div 
                key={feature.name}
                className="scroll-fade-in bg-white border border-zinc-200 rounded-xl p-6 hover:border-zinc-300 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-zinc-200/50 group"
                style={{ transitionDelay: `${index * 50}ms` }}
              >
                <div className="w-12 h-12 bg-zinc-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-zinc-900 transition-colors duration-300">
                  <feature.icon className="w-6 h-6 text-zinc-700 group-hover:text-white transition-colors duration-300" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-zinc-900">{feature.name}</h3>
                <p className="text-zinc-500 text-sm">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* 架构流程简图 */}
          <div className="mt-12 scroll-fade-in bg-white border border-zinc-200 rounded-2xl p-8 sm:p-12 shadow-sm">
            <h4 className="text-lg font-semibold mb-8 text-center text-zinc-900">上下文引擎工作流</h4>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-2 text-center">
              {[
                { label: '用户查询', sub: 'Query' },
                { label: '意图分析', sub: 'Intent' },
                { label: '上下文引擎', sub: 'ContextEngine', highlight: true },
                { label: 'ReAct Agent', sub: 'Tools' },
                { label: '回答', sub: 'Answer' },
              ].map((step, index) => (
                <div key={step.label} className="flex items-center">
                  <div className={`px-4 py-3 rounded-lg border ${step.highlight ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-zinc-50 border-zinc-200'}`}>
                    <div className={`font-medium text-sm ${step.highlight ? 'text-white' : 'text-zinc-900'}`}>{step.label}</div>
                    <div className={`text-xs ${step.highlight ? 'text-zinc-400' : 'text-zinc-400'}`}>{step.sub}</div>
                  </div>
                  {index < 4 && (
                    <div className="hidden sm:block mx-2 text-zinc-300">→</div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-zinc-500">
              <span className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-zinc-600" />
                Memory 检索
              </span>
              <span className="flex items-center gap-2">
                <Search className="w-4 h-4 text-zinc-600" />
                RAG 混合搜索
              </span>
              <span className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-zinc-600" />
                RRF 统一融合
              </span>
              <span className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-zinc-600" />
                Token 预算管理
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 代码知识库 */}
      <section className="relative py-16 sm:py-32 px-4 bg-zinc-50/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 scroll-fade-in">
            <span className="inline-flex items-center px-3 py-1 rounded-full border border-zinc-300 bg-zinc-100 text-xs sm:text-sm font-medium text-zinc-700 mb-4">
              <span className="flex h-2 w-2 rounded-full bg-zinc-500 mr-2 animate-pulse"></span>
              Code Intelligence
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-zinc-900">
              代码知识库
            </h2>
            <p className="text-zinc-500 text-lg max-w-2xl mx-auto">
              导入 GitHub 仓库，AI 自动理解代码结构，让你快速掌握任意开源项目
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Zap, name: '秒级导入', desc: '大型仓库快速解析，按需加载文件树' },
              { icon: Layers, name: '模块洞察', desc: '自动识别项目结构，提炼模块摘要' },
              { icon: Search, name: '智能问答', desc: '用自然语言提问，精准定位代码逻辑' },
              { icon: BarChart3, name: '架构可视化', desc: '模块关系图谱，一图看懂项目全貌' },
            ].map((feature, index) => (
              <div 
                key={feature.name}
                className="scroll-fade-in bg-white border border-zinc-200 rounded-xl p-6 hover:border-zinc-300 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-zinc-200/50 group"
                style={{ transitionDelay: `${index * 50}ms` }}
              >
                <div className="w-12 h-12 bg-zinc-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-zinc-900 transition-colors duration-300">
                  <feature.icon className="w-6 h-6 text-zinc-700 group-hover:text-white transition-colors duration-300" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-zinc-900">{feature.name}</h3>
                <p className="text-zinc-500 text-sm">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* 支持的语言 */}
          <div className="mt-12 text-center scroll-fade-in">
            <p className="text-zinc-400 text-sm mb-4">支持主流编程语言</p>
            <div className="flex flex-wrap justify-center gap-3">
              {['TypeScript', 'JavaScript', 'Python', 'Vue', 'React'].map((lang) => (
                <span 
                  key={lang}
                  className="px-3 py-1.5 bg-white border border-zinc-200 rounded-full text-sm text-zinc-600 font-medium"
                >
                  {lang}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 技术架构 */}
      <section ref={archRef} className="relative py-16 sm:py-32 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10 sm:mb-16 scroll-fade-in">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4 text-zinc-900">
              技术架构
            </h2>
            <p className="text-zinc-500 text-base sm:text-lg">
              完整的执行链路追踪，确保回答质量
            </p>
          </div>

          {/* 架构流程图 */}
          <div className="scroll-fade-in bg-white border border-zinc-200 rounded-2xl p-6 sm:p-12 shadow-2xl shadow-zinc-200/50">
            <div className="flex flex-col gap-6">
              {/* 流程步骤 */}
              {[
                { step: '1', title: '用户查询', desc: '接收用户的自然语言问题' },
                { step: '2', title: '意图分析', desc: 'LLM 智能识别用户意图类型' },
                { step: '3', title: '预检索', desc: '混合搜索 = 向量检索 + 关键词检索' },
                { step: '4', title: 'ReAct Agent', desc: '自主选择工具进行多轮推理' },
                { step: '5', title: '质量评估', desc: '低质量自动重试（最多3次）' },
                { step: '6', title: '最终回答', desc: '返回高质量的结构化答案' },
              ].map((item, index) => (
                <div key={item.step} className="flex items-start gap-4 group">
                  <div className="flex-shrink-0 w-8 h-8 bg-zinc-100 rounded-full flex items-center justify-center font-bold text-sm text-zinc-900 border border-zinc-200 group-hover:bg-zinc-900 group-hover:text-white transition-colors">
                    {item.step}
                  </div>
                  <div className="flex-1 pt-0.5">
                    <h4 className="font-semibold text-base sm:text-lg mb-1 text-zinc-900">{item.title}</h4>
                    <p className="text-zinc-500 text-xs sm:text-sm">{item.desc}</p>
                  </div>
                  {index < 5 && (
                    <div className="hidden sm:block absolute left-[15px] mt-10 w-px h-8 bg-zinc-200" />
                  )}
                </div>
              ))}
            </div>

            {/* 混合搜索说明 */}
            <div className="mt-12 pt-8 border-t border-zinc-100">
              <h4 className="text-lg font-semibold mb-6 text-center text-zinc-900">三路混合搜索 RRF 融合</h4>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 text-center items-center">
                <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100">
                  <div className="text-zinc-900 font-mono text-sm mb-2">向量检索</div>
                  <div className="text-zinc-500 text-xs">LlamaIndex 语义相似</div>
                </div>
                <div className="p-4 rounded-xl flex items-center justify-center">
                  <span className="text-2xl font-light text-zinc-300">+</span>
                </div>
                <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100">
                  <div className="text-zinc-900 font-mono text-sm mb-2">关键词检索</div>
                  <div className="text-zinc-500 text-xs">Meilisearch 精确匹配</div>
                </div>
                <div className="p-4 rounded-xl flex items-center justify-center">
                  <span className="text-2xl font-light text-zinc-300">+</span>
                </div>
                <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100">
                  <div className="text-zinc-900 font-mono text-sm mb-2">图谱检索</div>
                  <div className="text-zinc-500 text-xs">LightRAG 关系推理</div>
                </div>
              </div>
              <div className="text-center mt-6">
                <code className="text-sm text-zinc-500 font-mono bg-zinc-50 px-4 py-2 rounded-lg border border-zinc-100">
                  score = Σ 1/(k+rank)
                </code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RAG 评估系统 */}
      <section ref={evalRef} className="relative py-16 sm:py-32 px-4 bg-zinc-50/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 sm:mb-16 scroll-fade-in">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4 text-zinc-900">
              RAG 评估系统
            </h2>
            <p className="text-zinc-500 text-base sm:text-lg max-w-2xl mx-auto">
              四维度 LLM Judge 评估框架，自动生成评估问题，全面评测 RAG 系统
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {evalDimensions.map((dim, index) => (
              <div 
                key={dim.name}
                className="scroll-fade-in bg-white border border-zinc-200 rounded-xl p-6 text-center group hover:-translate-y-1 hover:shadow-lg hover:shadow-zinc-200/50 transition-all duration-300"
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                <div className={`w-12 h-12 mx-auto mb-4 rounded-lg bg-zinc-100 flex items-center justify-center group-hover:bg-zinc-900 transition-colors duration-300`}>
                  <Shield className="w-6 h-6 text-zinc-700 group-hover:text-white transition-colors duration-300" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-zinc-900">{dim.name}</h3>
                <p className="text-zinc-500 text-sm mb-4">{dim.desc}</p>
                
                {/* 模拟评分条 */}
                <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full bg-zinc-900 rounded-full transition-all duration-1000`}
                    style={{ width: `${70 + index * 8}%` }}
                  />
                </div>
                <div className="text-right text-xs text-zinc-400 mt-2 font-mono">
                  {(70 + index * 8) / 20}/5.0
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 支持的文档格式 */}
      <section className="relative py-16 sm:py-24 px-4 bg-zinc-50/50">
        <div className="max-w-4xl mx-auto">
          <div className="scroll-fade-in bg-white border border-zinc-200 rounded-2xl p-8 sm:p-12 text-center shadow-sm">
            <h3 className="text-xl sm:text-2xl font-bold mb-6 text-zinc-900">支持多种文档格式</h3>
            <div className="flex flex-wrap justify-center gap-4">
              {['PDF', 'DOCX', 'TXT', 'MD'].map((format) => (
                <div 
                  key={format}
                  className="px-4 sm:px-6 py-2 sm:py-3 bg-zinc-50 border border-zinc-200 rounded-lg font-mono text-base sm:text-lg text-zinc-600 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-all cursor-default"
                >
                  .{format.toLowerCase()}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <footer className="relative py-16 sm:py-24 px-4 border-t border-zinc-100 bg-zinc-50/50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-4xl font-bold mb-6 scroll-fade-in text-zinc-900">
            准备好开始了吗？
          </h2>
          <p className="text-zinc-500 text-base sm:text-lg mb-8 scroll-fade-in">
            立即体验 Agentic RAG 的强大能力
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center scroll-fade-in w-full sm:w-auto px-4 sm:px-0">
            <Link 
              href="/login"
              className="group px-8 py-4 bg-zinc-900 text-white rounded-lg text-lg font-medium hover:bg-zinc-800 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-zinc-500/20 flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              立即体验
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a 
              href="https://github.com/gong9/rag-era"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-white border border-zinc-200 text-zinc-700 rounded-lg text-lg font-medium hover:bg-zinc-50 hover:border-zinc-300 transition-all flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              <Github className="w-5 h-5" />
              Star on GitHub
            </a>
          </div>

          <div className="mt-16 pt-8 border-t border-zinc-200">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-zinc-400 text-sm">
              <a 
                href="https://github.com/gong9/rag-era"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 hover:text-zinc-600 transition-colors"
              >
                <Github className="w-4 h-4" />
                gong9/rag-era
              </a>
              <span className="hidden sm:inline">•</span>
              <span>MIT License</span>
              <span className="hidden sm:inline">•</span>
              <span>RAG KNOWLEDGE BASE © 2025</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
