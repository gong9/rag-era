#!/bin/bash

# Meilisearch 远程部署脚本
# 在阿里云服务器上运行

SERVER="root@39.96.203.251"
MEILISEARCH_PORT="7700"
MEILISEARCH_MASTER_KEY="rag-meilisearch-key-2025"

echo "🔍 部署 Meilisearch 到服务器..."

ssh $SERVER << ENDSSH
set -e

echo "📦 停止旧容器..."
docker rm -f rag-meilisearch 2>/dev/null || true

echo "📁 创建数据目录..."
mkdir -p /root/meilisearch-data

echo "🔧 配置 Docker 镜像加速器..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ]
}
EOF
systemctl daemon-reload
systemctl restart docker
sleep 3

echo "🐳 拉取 Meilisearch 镜像..."
docker pull getmeili/meilisearch:v1.6

echo "🚀 启动 Meilisearch 容器..."
docker run -d \
  --name rag-meilisearch \
  --restart always \
  -p ${MEILISEARCH_PORT}:7700 \
  -v /root/meilisearch-data:/meili_data \
  -e MEILI_MASTER_KEY=${MEILISEARCH_MASTER_KEY} \
  -e MEILI_ENV=production \
  getmeili/meilisearch:v1.6

echo "⏳ 等待服务启动..."
sleep 5

echo "🧪 测试健康状态..."
curl -s "http://localhost:${MEILISEARCH_PORT}/health"

echo ""
echo "✅ Meilisearch 部署完成！"
echo "🌐 访问地址: http://39.96.203.251:${MEILISEARCH_PORT}"
ENDSSH

echo ""
echo "✅ 部署完成！"
echo ""
echo "📝 请将以下配置添加到 .env 文件："
echo ""
echo "   MEILISEARCH_HOST=http://39.96.203.251:${MEILISEARCH_PORT}"
echo "   MEILISEARCH_API_KEY=${MEILISEARCH_MASTER_KEY}"
echo ""
echo "🧪 本地测试: curl 'http://39.96.203.251:${MEILISEARCH_PORT}/health'"

