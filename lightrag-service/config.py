"""
LightRAG 服务配置
"""
import os
from dotenv import load_dotenv

# 加载 .env 文件（从父目录）
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

# LLM 配置（复用 Next.js 项目的配置）
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
OPENAI_API_BASE = os.getenv('OPENAI_API_BASE', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'qwen-turbo')

# LightRAG 存储目录
LIGHTRAG_STORAGE_DIR = os.getenv('LIGHTRAG_STORAGE_DIR', './lightrag-data')

# 服务配置
SERVICE_HOST = os.getenv('LIGHTRAG_HOST', '0.0.0.0')
SERVICE_PORT = int(os.getenv('LIGHTRAG_PORT', '8005'))

# 日志级别
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

