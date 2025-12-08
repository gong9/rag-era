#!/bin/bash

# RAG 知识库系统 - 阿里云部署脚本

set -e

# 配置
SERVER="root@39.96.203.251"
APP_NAME="rag-knowledge-base"
REMOTE_DIR="/root/rag-knowledge-base"
PORT=8004

echo ""
echo "🚀 RAG 知识库系统 - 部署到阿里云"
echo "=================================="
echo ""

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo "❌ .env 文件不存在！"
    exit 1
fi

# 1. 本地构建
echo "🔨 本地构建项目..."
pnpm build

# 2. 打包项目（排除 macOS 扩展属性）
echo "📦 打包项目文件..."
COPYFILE_DISABLE=1 tar -czf deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='deploy.tar.gz' \
  --exclude='uploads' \
  --exclude='storage' \
  --exclude='prisma/dev.db' \
  --exclude='prisma/dev.db-journal' \
  --exclude='.next/cache' \
  --exclude='.DS_Store' \
  .

echo "✅ 打包完成: $(du -h deploy.tar.gz | cut -f1)"

# 3. 上传到服务器
echo "📤 上传文件到服务器..."
scp deploy.tar.gz $SERVER:/tmp/
scp .env $SERVER:/tmp/.env.rag

# 4. 服务器端部署
echo "🔧 在服务器上部署..."
ssh $SERVER << 'ENDSSH'
set -e

APP_NAME="rag-knowledge-base"
REMOTE_DIR="/root/rag-knowledge-base"
PORT=8004

echo "🖥️  服务器端部署开始"

# 创建目录
mkdir -p $REMOTE_DIR/uploads
mkdir -p $REMOTE_DIR/storage
cd $REMOTE_DIR

# 备份数据
BACKUP_ID=$$
[ -d "uploads" ] && [ "$(ls -A uploads 2>/dev/null)" ] && mv uploads /tmp/uploads_$BACKUP_ID
[ -d "storage" ] && [ "$(ls -A storage 2>/dev/null)" ] && mv storage /tmp/storage_$BACKUP_ID
[ -f "prisma/dev.db" ] && cp prisma/dev.db /tmp/dev.db_$BACKUP_ID

# 解压
echo "📂 解压文件..."
tar -xzf /tmp/deploy.tar.gz -C $REMOTE_DIR
rm /tmp/deploy.tar.gz

# 恢复数据
[ -d "/tmp/uploads_$BACKUP_ID" ] && rm -rf uploads && mv /tmp/uploads_$BACKUP_ID uploads && echo "✅ uploads 已恢复"
[ -d "/tmp/storage_$BACKUP_ID" ] && rm -rf storage && mv /tmp/storage_$BACKUP_ID storage && echo "✅ storage 已恢复"
[ -f "/tmp/dev.db_$BACKUP_ID" ] && mkdir -p prisma && mv /tmp/dev.db_$BACKUP_ID prisma/dev.db && echo "✅ 数据库已恢复"

# 移动 .env
mv /tmp/.env.rag .env

# 安装 Node.js
if ! command -v node &> /dev/null; then
    echo "📥 安装 Node.js..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
fi

# 安装 pnpm 和 PM2
command -v pnpm &> /dev/null || npm install -g pnpm
command -v pm2 &> /dev/null || npm install -g pm2

# 安装依赖（包含 devDependencies，因为 prisma 在里面）
echo "📦 安装依赖..."
pnpm install

# Prisma
echo "🔧 初始化数据库..."
npx prisma generate
npx prisma db push

# 重启服务
echo "🚀 启动服务..."
pm2 stop $APP_NAME 2>/dev/null || true
pm2 delete $APP_NAME 2>/dev/null || true
PORT=$PORT pm2 start npm --name $APP_NAME -- start
pm2 save

echo "✅ 部署完成！"
pm2 status
ENDSSH

# 5. 清理
rm deploy.tar.gz

echo ""
echo "✅ 部署成功！"
echo "🌐 访问: http://39.96.203.251:$PORT"
echo "💡 记得开放安全组端口: $PORT"

