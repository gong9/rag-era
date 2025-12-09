#!/bin/bash

# Meilisearch 部署脚本
# 使用 Docker 部署 Meilisearch 搜索引擎

set -e

echo "🔍 Meilisearch 部署脚本"
echo "========================"

# 配置
CONTAINER_NAME="rag-meilisearch"
MEILISEARCH_PORT="${MEILISEARCH_PORT:-7700}"
MEILISEARCH_MASTER_KEY="${MEILISEARCH_MASTER_KEY:-your-master-key-change-me}"
DATA_DIR="./meilisearch-data"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 请先安装 Docker"
    exit 1
fi

# 停止并删除旧容器
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "📦 停止旧容器..."
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
    docker rm ${CONTAINER_NAME} 2>/dev/null || true
fi

# 创建数据目录
mkdir -p ${DATA_DIR}

echo "🚀 启动 Meilisearch..."

# 运行 Meilisearch 容器
docker run -d \
    --name ${CONTAINER_NAME} \
    -p ${MEILISEARCH_PORT}:7700 \
    -v $(pwd)/${DATA_DIR}:/meili_data \
    -e MEILI_MASTER_KEY=${MEILISEARCH_MASTER_KEY} \
    -e MEILI_ENV=production \
    --restart unless-stopped \
    getmeili/meilisearch:v1.6

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 3

# 检查健康状态
if curl -s "http://localhost:${MEILISEARCH_PORT}/health" | grep -q "available"; then
    echo "✅ Meilisearch 启动成功！"
    echo ""
    echo "📝 配置信息："
    echo "   Host: http://localhost:${MEILISEARCH_PORT}"
    echo "   Master Key: ${MEILISEARCH_MASTER_KEY}"
    echo ""
    echo "🔧 请将以下配置添加到 .env 文件："
    echo ""
    echo "   MEILISEARCH_HOST=http://localhost:${MEILISEARCH_PORT}"
    echo "   MEILISEARCH_API_KEY=${MEILISEARCH_MASTER_KEY}"
    echo ""
    echo "📚 Meilisearch Dashboard: http://localhost:${MEILISEARCH_PORT}"
else
    echo "❌ Meilisearch 启动失败，请检查日志："
    docker logs ${CONTAINER_NAME}
    exit 1
fi

