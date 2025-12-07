#!/bin/bash

echo "🚀 开始设置 RAG 知识库系统..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js 20+"
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"

# 1. 安装依赖
echo ""
echo "📦 安装依赖..."
npm install

# 2. 生成 Prisma Client
echo ""
echo "🔧 生成 Prisma Client..."
npx prisma generate

# 3. 初始化数据库
echo ""
echo "💾 初始化数据库..."
npx prisma db push

# 4. 创建必要的目录
echo ""
echo "📁 创建存储目录..."
mkdir -p uploads storage data

echo ""
echo "✅ 设置完成！"
echo ""
echo "📝 下一步："
echo "   1. 确保 .env 文件中的千问 API Key 正确"
echo "   2. 运行 'npm run dev' 启动开发服务器"
echo "   3. 访问 http://localhost:3000"
echo ""

