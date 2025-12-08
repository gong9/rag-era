#!/bin/bash

echo ""
echo "🚀 RAG 知识库系统 - 本地开发环境设置"
echo "======================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js 20+"
    exit 1
fi
echo "✅ Node.js: $(node -v)"

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "📥 安装 pnpm..."
    npm install -g pnpm
fi
echo "✅ pnpm: $(pnpm -v)"

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  未检测到 .env 文件，正在创建模板..."
    cat > .env << 'EOF'
# 数据库
DATABASE_URL="file:./dev.db"

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-change-this

# 千问 API（阿里云 DashScope）
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
OPENAI_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-turbo

# 存储目录
UPLOAD_DIR=./uploads
STORAGE_DIR=./storage
EOF
    echo "✅ .env 文件已创建，请编辑填入你的 API Key"
fi

# 安装依赖
echo ""
echo "📦 安装依赖..."
pnpm install

# 生成 Prisma Client
echo ""
echo "🔧 生成 Prisma Client..."
npx prisma generate

# 初始化数据库
echo ""
echo "💾 初始化数据库..."
npx prisma db push

# 创建存储目录
echo ""
echo "📁 创建存储目录..."
mkdir -p uploads storage

echo ""
echo "======================================"
echo "✅ 设置完成！"
echo "======================================"
echo ""
echo "📝 下一步："
echo "   1. 编辑 .env 文件，填入千问 API Key"
echo "   2. 运行 'pnpm dev' 启动开发服务器"
echo "   3. 访问 http://localhost:3000"
echo ""
