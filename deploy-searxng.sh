#!/bin/bash

# SearXNG 一键部署脚本
# 在阿里云服务器上运行

SERVER="root@39.96.203.251"

echo "🚀 部署 SearXNG 到服务器..."

ssh $SERVER << 'ENDSSH'
set -e

echo "📦 停止旧容器..."
docker rm -f searxng 2>/dev/null || true

echo "📁 创建配置目录..."
mkdir -p /root/searxng

echo "📝 写入配置文件..."
cat > /root/searxng/settings.yml << 'EOF'
use_default_settings: true

server:
  secret_key: "searxng-secret-key-12345"
  limiter: false
  image_proxy: false

search:
  safe_search: 0
  autocomplete: ""
  default_lang: "zh-CN"
  formats:
    - html
    - json

engines:
  - name: google
    disabled: true
  - name: duckduckgo
    disabled: true
  - name: bing
    disabled: false
    engine: bing
  - name: wikipedia
    disabled: true
EOF

echo "🐳 启动 SearXNG 容器..."
docker run -d \
  --name searxng \
  --restart always \
  -p 8888:8080 \
  -v /root/searxng/settings.yml:/etc/searxng/settings.yml \
  searxng/searxng

echo "⏳ 等待服务启动..."
sleep 5

echo "🧪 测试 JSON API..."
curl -s "http://localhost:8888/search?q=test&format=json" | head -c 200

echo ""
echo "✅ SearXNG 部署完成！"
echo "🌐 访问地址: http://39.96.203.251:8888"
ENDSSH

echo ""
echo "✅ 部署完成！"
echo "🧪 本地测试: curl 'http://39.96.203.251:8888/search?q=test&format=json'"

