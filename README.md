# RAG 知识库系统

> 半天写Demo，半年难上线。我就不信了，前端写不好 RAG

一个支持 **Agentic RAG** 的智能知识库系统，可上传文档、语义检索、智能问答，自动生成流程图、时序图。

## 演示截图

<div align="center">
  <img src="img/demo1.png" alt="Dashboard Demo" width="100%" />
  <br/><br/>
  <img src="img/demo2.png" alt="Chat Demo" width="100%" />
</div>

## 核心功能

- **文档管理**: 支持 PDF、DOCX、TXT、MD 等格式上传和索引
- **智能问答**: 基于知识库内容的精准上下文问答
- **Agentic RAG**: ReAct Agent 可自主选择工具进行多轮推理
- **AI 图表生成**: 自动生成思维导图、流程图、时序图
- **意图驱动**: LLM 自动识别用户意图，智能路由到合适的工具
- **质量评估**: 回答质量自动检测，低质量时自动重试

### Agent 工具箱

| 工具 | 功能 |
|------|------|
| `search_knowledge` | 精准检索（Top-3） |
| `deep_search` | 深度检索（Top-8） |
| `summarize_topic` | 主题总结（Top-10） |
| `web_search` | 搜索互联网（SearXNG） |
| `get_current_datetime` | 获取当前日期时间 |
| `fetch_webpage` | 抓取网页内容 |
| `generate_diagram` | 生成可视化图表（流程图/时序图） |

### 智能意图识别

Agent 会自动分析用户问题的意图：

| 意图类型 | 示例 | 处理方式 |
|----------|------|----------|
| `greeting` | "你好" | 直接回复，跳过 Agent |
| `small_talk` | "今天天气怎么样" | 直接回复 |
| `document_summary` | "xxx讲了什么" | 调用 summarize_topic |
| `knowledge_query` | "什么是RAG" | 调用 search_knowledge |
| `draw_diagram` | "画个流程图" | 调用 generate_diagram |
| `web_search` | "最新的AI新闻" | 调用 web_search |
| `datetime` | "现在几点" | 调用 get_current_datetime |

### 执行链路追踪

每次查询会记录完整的执行链路，用于质量评估：

```
1. 用户问题 → 2. 意图判断 → 3. 预检索 → 4. Agent工具调用 → 5. 质量评估 → 6. 最终回答
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 环境配置

创建 `.env` 文件：

```env
DATABASE_URL="file:./dev.db"
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key

# Qwen API (阿里云)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=qwen-turbo
OPENAI_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 3. 初始化数据库

```bash
npx prisma generate
npx prisma db push
```

### 4. 启动

```bash
pnpm dev
```

访问 http://localhost:3000

## 许可证

MIT
