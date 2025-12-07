# RAG 知识库系统 (RAG Knowledge Base)

一个基于 **Next.js 14**、**LlamaIndex** 和 **Qwen (千问) LLM** 的现代化智能知识库系统。

支持文档上传、向量索引、语义检索和智能问答，采用 **Linear 风格** 的极简 UI 设计。

##  演示截图

<div align="center">
  <img src="img/demo1.png" alt="Dashboard Demo" width="100%" />
  <br/>
  <br/>
  <img src="img/demo2.png" alt="Chat Demo" width="100%" />
</div>

## ✨ 核心特性

- **RAG 引擎**: 基于 LlamaIndexTS 构建，支持文档切片、向量化和语义检索。
- **智能问答**: 集成阿里云千问 (Qwen) 大模型，提供精准的上下文问答。
- **实时处理**: 支持 SSE (Server-Sent Events) 实时显示文档索引进度。


## 🛠️ 技术栈

| 类别 | 技术选型 |
| --- | --- |
| **框架** | Next.js 14 (App Router) |
| **RAG** | LlamaIndexTS, Qwen LLM (通义千问) |
| **数据库** | SQLite, Prisma ORM |
| **样式** | Tailwind CSS, shadcn/ui, Lucide Icons |
| **认证** | NextAuth.js |
| **语言** | TypeScript |

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 环境配置

创建 `.env` 文件并配置以下变量：

```env
# Database
DATABASE_URL="file:./dev.db"

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key

# Qwen API (阿里云)
QWEN_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
QWEN_MODEL=qwen-turbo
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# Storage
UPLOAD_DIR=./uploads
STORAGE_DIR=./storage
```

### 3. 初始化数据库

```bash
npx prisma generate
npx prisma db push
```

### 4. 启动服务

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000) 即可使用。

## RAG 流程

1.  **上传**: 用户上传文档 (PDF, TXT, MD, DOCX)。
2.  **索引**:
    *   系统读取文档内容。
    *   LlamaIndex 将文本切片。
    *   调用 Qwen Embedding API 生成向量。
    *   将向量存储在本地索引中。
3.  **检索**: 用户提问 -> 生成问题向量 -> 在索引中查找相似切片。
4.  **生成**: 将相似切片作为上下文 (Context) + 用户问题 -> 发送给 Qwen LLM -> 生成回答。

## 许可证

MIT License
