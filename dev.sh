#!/bin/bash
# RAG 开发环境管理脚本
# 用法: ./dev.sh [start|stop|restart|status|logs]

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIGHTRAG_DIR="$PROJECT_DIR/lightrag-service"
LIGHTRAG_PID_FILE="$PROJECT_DIR/.lightrag.pid"
NEXTJS_PID_FILE="$PROJECT_DIR/.nextjs.pid"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[$1]${NC} $2"
}

print_success() {
    echo -e "${GREEN}✅${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

# 检查 LightRAG 是否运行
is_lightrag_running() {
    if [ -f "$LIGHTRAG_PID_FILE" ]; then
        pid=$(cat "$LIGHTRAG_PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    # 也检查进程名
    pgrep -f "lightrag-service/main.py" > /dev/null 2>&1
    return $?
}

# 启动 LightRAG
start_lightrag() {
    if is_lightrag_running; then
        print_warning "LightRAG 已在运行"
        return 0
    fi
    
    print_status "LightRAG" "启动中..."
    
    cd "$LIGHTRAG_DIR"
    
    # 创建虚拟环境
    if [ ! -d "venv" ]; then
        print_status "LightRAG" "创建 Python 虚拟环境..."
        python3 -m venv venv
    fi
    
    source venv/bin/activate
    
    # 安装依赖
    pip install -r requirements.txt -q 2>/dev/null
    
    # 后台启动
    nohup python main.py > "$PROJECT_DIR/lightrag.log" 2>&1 &
    echo $! > "$LIGHTRAG_PID_FILE"
    
    sleep 2
    
    if is_lightrag_running; then
        print_success "LightRAG 已启动 (PID: $(cat $LIGHTRAG_PID_FILE))"
        print_status "LightRAG" "http://localhost:8005/health"
    else
        print_error "LightRAG 启动失败，查看 lightrag.log"
        return 1
    fi
    
    cd "$PROJECT_DIR"
}

# 停止 LightRAG
stop_lightrag() {
    print_status "LightRAG" "停止中..."
    
    if [ -f "$LIGHTRAG_PID_FILE" ]; then
        pid=$(cat "$LIGHTRAG_PID_FILE")
        kill "$pid" 2>/dev/null
        rm -f "$LIGHTRAG_PID_FILE"
    fi
    
    # 确保杀死所有相关进程
    pkill -f "lightrag-service/main.py" 2>/dev/null
    pkill -f "lightrag-service/venv/bin/python" 2>/dev/null
    
    print_success "LightRAG 已停止"
}

# 启动 Next.js（前台）
start_nextjs() {
    print_status "Next.js" "启动开发服务器..."
    cd "$PROJECT_DIR"
    export LIGHTRAG_URL=http://localhost:8005
    pnpm dev
}

# 启动 Next.js（后台）
start_nextjs_bg() {
    print_status "Next.js" "后台启动中..."
    cd "$PROJECT_DIR"
    export LIGHTRAG_URL=http://localhost:8005
    nohup pnpm dev > "$PROJECT_DIR/nextjs.log" 2>&1 &
    echo $! > "$NEXTJS_PID_FILE"
    sleep 3
    print_success "Next.js 已启动"
    print_status "Next.js" "http://localhost:3000"
}

# 停止 Next.js
stop_nextjs() {
    print_status "Next.js" "停止中..."
    
    if [ -f "$NEXTJS_PID_FILE" ]; then
        pid=$(cat "$NEXTJS_PID_FILE")
        kill "$pid" 2>/dev/null
        rm -f "$NEXTJS_PID_FILE"
    fi
    
    # 杀死 Next.js 相关进程
    pkill -f "next dev" 2>/dev/null
    
    print_success "Next.js 已停止"
}

# 显示状态
show_status() {
    echo ""
    echo "═══════════════════════════════════════"
    echo "        RAG 开发环境状态"
    echo "═══════════════════════════════════════"
    echo ""
    
    # LightRAG 状态
    if is_lightrag_running; then
        pid=$(pgrep -f "lightrag-service/main.py" | head -1)
        echo -e "🕸️  LightRAG:  ${GREEN}运行中${NC} (PID: $pid)"
        echo "   └─ http://localhost:8005/health"
    else
        echo -e "🕸️  LightRAG:  ${RED}未运行${NC}"
    fi
    
    # Next.js 状态
    if pgrep -f "next dev" > /dev/null 2>&1; then
        pid=$(pgrep -f "next dev" | head -1)
        echo -e "🌐 Next.js:   ${GREEN}运行中${NC} (PID: $pid)"
        echo "   └─ http://localhost:3000"
    else
        echo -e "🌐 Next.js:   ${RED}未运行${NC}"
    fi
    
    echo ""
    echo "═══════════════════════════════════════"
    echo ""
}

# 查看日志
show_logs() {
    case "$1" in
        lightrag)
            if [ -f "$PROJECT_DIR/lightrag.log" ]; then
                tail -f "$PROJECT_DIR/lightrag.log"
            else
                print_error "LightRAG 日志不存在"
            fi
            ;;
        nextjs)
            if [ -f "$PROJECT_DIR/nextjs.log" ]; then
                tail -f "$PROJECT_DIR/nextjs.log"
            else
                print_error "Next.js 日志不存在"
            fi
            ;;
        *)
            echo "用法: ./dev.sh logs [lightrag|nextjs]"
            ;;
    esac
}

# 显示帮助
show_help() {
    echo ""
    echo "RAG 开发环境管理脚本"
    echo ""
    echo "用法: ./dev.sh <命令>"
    echo ""
    echo "命令:"
    echo "  start       启动所有服务（LightRAG 后台，Next.js 前台）"
    echo "  start-bg    启动所有服务（全部后台）"
    echo "  stop        停止所有服务"
    echo "  restart     重启所有服务"
    echo "  status      查看服务状态"
    echo "  logs        查看日志 (logs lightrag|nextjs)"
    echo ""
    echo "  lightrag    只启动 LightRAG"
    echo "  nextjs      只启动 Next.js"
    echo ""
    echo "示例:"
    echo "  ./dev.sh start      # 启动开发环境"
    echo "  ./dev.sh stop       # 停止所有服务"
    echo "  ./dev.sh status     # 查看状态"
    echo "  ./dev.sh logs lightrag  # 查看 LightRAG 日志"
    echo ""
}

# 主命令
case "$1" in
    start)
        echo ""
        echo "🚀 启动 RAG 开发环境..."
        echo ""
        start_lightrag
        echo ""
        start_nextjs
        ;;
    start-bg)
        echo ""
        echo "🚀 后台启动 RAG 开发环境..."
        echo ""
        start_lightrag
        start_nextjs_bg
        show_status
        ;;
    stop)
        echo ""
        stop_lightrag
        stop_nextjs
        echo ""
        ;;
    restart)
        echo ""
        stop_lightrag
        stop_nextjs
        sleep 1
        start_lightrag
        echo ""
        start_nextjs
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    lightrag)
        start_lightrag
        ;;
    nextjs)
        start_nextjs
        ;;
    *)
        show_help
        ;;
esac

