# RAG 知识库系统

基于 Next.js 14、LlamaIndexTS 和千问 LLM 的全栈智能知识库管理系统。

## ✨ 功能特性

- 🔐 **用户认证** - 基于 NextAuth.js 的安全认证系统
- 📚 **知识库管理** - 创建和管理多个知识库
- 📄 **文档上传** - 支持 TXT、Markdown、PDF、DOCX 格式
- 🤖 **智能问答** - 基于文档内容的 AI 问答
- 💬 **聊天历史** - 保存和查看历史对话
- 🎨 **现代 UI** - 基于 Tailwind CSS 的美观界面

## 🛠️ 技术栈

- **前端框架**: Next.js 14 (App Router)
- **样式**: Tailwind CSS + shadcn/ui
- **认证**: NextAuth.js
- **数据库**: SQLite + Prisma ORM
- **AI 框架**: LlamaIndexTS
- **LLM**: 千问 (Qwen) - 通义千问 API
- **语言**: TypeScript

## 📋 前置要求

- Node.js 20+ 
- npm/yarn/pnpm

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
# 或
pnpm install
# 或
yarn install
```

### 2. 配置环境变量

复制 `.env.example` 文件并重命名为 `.env`，然后配置以下变量：

```env
# Database
DATABASE_URL="file:./dev.db"

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-change-this-in-production

# Qwen API
QWEN_API_KEY=sk-8ac7b8a56c8c4cfd9e60212097f91a70
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

### 4. 启动开发服务器

```bash
npm run dev
# 或
pnpm dev
# 或
yarn dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

## 📖 使用指南

### 注册和登录

1. 访问 `/register` 创建新账号
2. 使用创建的账号在 `/login` 登录

### 创建知识库

1. 登录后进入 Dashboard
2. 点击"创建知识库"按钮
3. 输入知识库名称和描述

### 上传文档

1. 在知识库列表中点击"管理文档"
2. 选择文件（支持 TXT、MD、PDF、DOCX）
3. 点击"上传"按钮
4. 等待文档处理完成（状态变为"已完成"）

### 智能问答

1. 在知识库列表中点击"问答"按钮
2. 在聊天界面输入问题
3. AI 将基于上传的文档内容回答问题

## 📁 项目结构

```
rag/
├── prisma/
│   └── schema.prisma          # 数据库模型
├── src/
│   ├── app/
│   │   ├── api/               # API Routes
│   │   │   ├── auth/          # 认证相关
│   │   │   ├── knowledge-bases/  # 知识库 API
│   │   │   ├── documents/     # 文档 API
│   │   │   └── chat/          # 聊天 API
│   │   ├── dashboard/         # 知识库管理界面
│   │   ├── chat/              # 问答界面
│   │   ├── login/             # 登录页面
│   │   ├── register/          # 注册页面
│   │   └── layout.tsx         # 根布局
│   ├── components/
│   │   └── ui/                # UI 组件
│   ├── lib/
│   │   ├── prisma.ts          # Prisma 客户端
│   │   ├── llm.ts             # LLM 服务
│   │   └── utils.ts           # 工具函数
│   └── middleware.ts          # Next.js 中间件
├── uploads/                   # 文档上传目录
├── storage/                   # 向量存储目录
└── package.json
```

## 🔧 配置说明

### 千问 API 配置

本项目使用阿里云通义千问 API。您需要：

1. 在 [阿里云 DashScope](https://dashscope.aliyun.com/) 获取 API Key
2. 将 API Key 配置到 `.env` 文件的 `QWEN_API_KEY`
3. 根据需要选择模型（qwen-turbo、qwen-plus、qwen-max）

### 数据库

默认使用 SQLite，数据存储在 `prisma/dev.db`。如需使用其他数据库：

1. 修改 `prisma/schema.prisma` 中的 `datasource`
2. 更新 `.env` 中的 `DATABASE_URL`
3. 运行 `npx prisma generate` 和 `npx prisma db push`

## 🚢 部署

### Vercel 部署

1. 将代码推送到 GitHub
2. 在 Vercel 导入项目
3. 配置环境变量（所有 `.env` 中的变量）
4. 部署

**注意**: 由于 Vercel 的无服务器特性，需要使用外部数据库（如 PlanetScale、Neon 等）替代 SQLite。

### Docker 部署

```bash
# 构建镜像
docker build -t rag-kb .

# 运行容器
docker run -p 3000:3000 --env-file .env rag-kb
```

## 📝 API 文档

### 认证 API

- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 知识库 API

- `GET /api/knowledge-bases` - 获取知识库列表
- `POST /api/knowledge-bases` - 创建知识库
- `GET /api/knowledge-bases/[id]` - 获取知识库详情
- `DELETE /api/knowledge-bases/[id]` - 删除知识库

### 文档 API

- `POST /api/documents/upload` - 上传文档
- `DELETE /api/documents/[id]` - 删除文档

### 聊天 API

- `POST /api/chat/query` - 发送问题
- `GET /api/chat/history/[knowledgeBaseId]` - 获取聊天历史

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [Next.js](https://nextjs.org/)
- [LlamaIndex](https://www.llamaindex.ai/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [阿里云通义千问](https://tongyi.aliyun.com/)

