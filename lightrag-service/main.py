"""
LightRAG 服务 - FastAPI 入口
提供知识图谱增强的 RAG 检索能力
"""

import os
import asyncio
import logging
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

from config import (
    OPENAI_API_KEY,
    OPENAI_API_BASE,
    OPENAI_MODEL,
    LIGHTRAG_STORAGE_DIR,
    SERVICE_HOST,
    SERVICE_PORT,
    LOG_LEVEL,
    INDEX_DELAY_SECONDS,
    LLM_CONCURRENCY,
)

# 注意：不要在 uvicorn 环境下使用 nest_asyncio.apply()
# 它与 uvloop 不兼容

# 配置日志
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# LightRAG 实例缓存（按知识库 ID）
rag_instances: dict = {}

# 索引任务状态
indexing_tasks: dict = {}

# LLM 请求并发限制（信号量），0 表示不限制
llm_semaphore = asyncio.Semaphore(LLM_CONCURRENCY) if LLM_CONCURRENCY > 0 else None


# ========== 自定义 LLM 函数（使用千问 API）==========


async def qwen_complete(
    prompt: str,
    system_prompt: Optional[str] = None,
    history_messages: List[dict] = [],
    **kwargs,
) -> str:
    """
    调用千问 API 完成文本生成
    """
    messages = []

    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    for msg in history_messages:
        messages.append(msg)

    messages.append({"role": "user", "content": prompt})

    async def do_request():
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{OPENAI_API_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENAI_MODEL,
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
            )

            if response.status_code != 200:
                logger.error(f"LLM API error: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=500, detail=f"LLM API error: {response.text}"
                )

            data = response.json()
            return data["choices"][0]["message"]["content"]

    # 如果设置了并发限制，使用信号量
    if llm_semaphore:
        async with llm_semaphore:
            return await do_request()
    else:
        return await do_request()


async def qwen_embedding(texts: List[str]) -> List[List[float]]:
    """
    调用千问 Embedding API
    """

    async def do_request():
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{OPENAI_API_BASE}/embeddings",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "text-embedding-v3",
                    "input": texts,
                },
            )

            if response.status_code != 200:
                logger.error(
                    f"Embedding API error: {response.status_code} - {response.text}"
                )
                raise HTTPException(
                    status_code=500, detail=f"Embedding API error: {response.text}"
                )

            data = response.json()
            return [item["embedding"] for item in data["data"]]

    # 如果设置了并发限制，使用信号量
    if llm_semaphore:
        async with llm_semaphore:
            return await do_request()
    else:
        return await do_request()


# ========== Pydantic 模型 ==========


class IndexRequest(BaseModel):
    kb_id: str
    documents: List[dict]  # [{"id": "xxx", "name": "xxx", "content": "xxx"}]


class QueryRequest(BaseModel):
    kb_id: str
    question: str
    mode: str = "hybrid"  # local, global, hybrid, naive


class IndexStatus(BaseModel):
    kb_id: str
    status: str  # pending, indexing, completed, failed
    progress: float = 0.0
    message: str = ""


# ========== LightRAG 实例管理 ==========


def get_storage_path(kb_id: str) -> str:
    """获取知识库的存储路径"""
    return os.path.join(LIGHTRAG_STORAGE_DIR, f"kb_{kb_id}")


async def get_or_create_rag(kb_id: str):
    """获取或创建 LightRAG 实例"""
    if kb_id in rag_instances:
        return rag_instances[kb_id]

    try:
        from lightrag import LightRAG, QueryParam

        storage_path = get_storage_path(kb_id)
        os.makedirs(storage_path, exist_ok=True)

        # 创建 LightRAG 实例
        # 注意：LightRAG 需要自定义 LLM 函数
        rag = LightRAG(
            working_dir=storage_path,
            llm_model_func=qwen_complete,
            embedding_func=EmbeddingFunc(
                embedding_dim=1024,  # text-embedding-v3 的维度
                max_token_size=8192,
                func=qwen_embedding,
            ),
        )

        # 初始化存储（LightRAG 1.4+ 必需）
        await rag.initialize_storages()

        # 初始化 pipeline 状态
        from lightrag.kg.shared_storage import initialize_pipeline_status

        await initialize_pipeline_status()

        rag_instances[kb_id] = rag
        logger.info(f"Created LightRAG instance for kb: {kb_id}")
        return rag
    except ImportError as e:
        logger.error(f"Failed to import LightRAG: {e}")
        raise HTTPException(status_code=500, detail="LightRAG not installed")
    except Exception as e:
        logger.error(f"Failed to create LightRAG instance: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========== FastAPI 应用 ==========


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("LightRAG service starting...")
    os.makedirs(LIGHTRAG_STORAGE_DIR, exist_ok=True)
    yield
    logger.info("LightRAG service shutting down...")


app = FastAPI(
    title="LightRAG Service",
    description="知识图谱增强的 RAG 检索服务",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========== API 路由 ==========


@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "service": "lightrag",
        "storage_dir": LIGHTRAG_STORAGE_DIR,
        "instances": len(rag_instances),
    }


@app.post("/index")
async def index_documents(request: IndexRequest, background_tasks: BackgroundTasks):
    """
    索引文档（构建知识图谱）
    这是一个异步操作，返回任务 ID 后在后台执行
    """
    kb_id = request.kb_id
    documents = request.documents

    if not documents:
        raise HTTPException(status_code=400, detail="No documents provided")

    # 检查是否已在索引中
    if kb_id in indexing_tasks and indexing_tasks[kb_id]["status"] == "indexing":
        return {
            "status": "already_indexing",
            "kb_id": kb_id,
            "message": "Indexing already in progress",
        }

    # 初始化任务状态
    indexing_tasks[kb_id] = {
        "status": "pending",
        "progress": 0.0,
        "message": "Starting indexing...",
        "total": len(documents),
        "completed": 0,
    }

    # 在后台执行索引
    background_tasks.add_task(index_documents_task, kb_id, documents)

    return {
        "status": "accepted",
        "kb_id": kb_id,
        "message": f"Indexing {len(documents)} documents in background",
    }


async def index_documents_task(kb_id: str, documents: List[dict]):
    """
    后台索引任务
    使用延迟和限流避免 CPU 过载，保证服务器可用性
    """
    try:
        indexing_tasks[kb_id]["status"] = "indexing"
        indexing_tasks[kb_id]["message"] = "Creating knowledge graph..."

        rag = await get_or_create_rag(kb_id)
        total = len(documents)

        logger.info(
            f"[{kb_id}] Starting indexing with delay={INDEX_DELAY_SECONDS}s, concurrency={LLM_CONCURRENCY}"
        )

        for i, doc in enumerate(documents):
            content = doc.get("content", "")
            name = doc.get("name", f"doc_{i}")

            if not content:
                continue

            # 添加文档标识
            text_with_meta = f"【文档: {name}】\n\n{content}"

            # 插入到 LightRAG（构建知识图谱）
            await rag.ainsert(text_with_meta)

            # 更新进度
            indexing_tasks[kb_id]["completed"] = i + 1
            indexing_tasks[kb_id]["progress"] = (i + 1) / total
            indexing_tasks[kb_id]["message"] = f"Indexed {i + 1}/{total}: {name}"
            logger.info(f"[{kb_id}] Indexed {i + 1}/{total}: {name}")

            # 🔥 每个文档处理后延迟，避免 CPU 持续满载
            # 这样其他服务（如 Next.js）可以获得 CPU 时间
            if INDEX_DELAY_SECONDS > 0 and i < total - 1:
                logger.debug(
                    f"[{kb_id}] Throttling: sleeping {INDEX_DELAY_SECONDS}s..."
                )
                await asyncio.sleep(INDEX_DELAY_SECONDS)

        indexing_tasks[kb_id]["status"] = "completed"
        indexing_tasks[kb_id]["progress"] = 1.0
        indexing_tasks[kb_id]["message"] = f"Successfully indexed {total} documents"
        logger.info(f"[{kb_id}] Indexing completed: {total} documents")

    except Exception as e:
        logger.error(f"[{kb_id}] Indexing failed: {e}")
        indexing_tasks[kb_id]["status"] = "failed"
        indexing_tasks[kb_id]["message"] = str(e)


@app.get("/index/{kb_id}/status")
async def get_index_status(kb_id: str):
    """获取索引状态"""
    if kb_id not in indexing_tasks:
        # 检查是否已有存储
        storage_path = get_storage_path(kb_id)
        if os.path.exists(storage_path):
            return {
                "kb_id": kb_id,
                "status": "completed",
                "progress": 1.0,
                "message": "Index exists",
            }
        return {
            "kb_id": kb_id,
            "status": "not_found",
            "progress": 0.0,
            "message": "No indexing task found",
        }

    return {
        "kb_id": kb_id,
        **indexing_tasks[kb_id],
    }


@app.post("/query")
async def query(request: QueryRequest):
    """
    查询知识库（图谱检索）

    mode 参数:
    - local: 基于实体的局部检索（适合具体问题）
    - global: 基于主题的全局检索（适合总结性问题）
    - hybrid: 混合模式（推荐）
    - naive: 简单向量检索（对照组）
    """
    kb_id = request.kb_id
    question = request.question
    mode = request.mode

    if not question:
        raise HTTPException(status_code=400, detail="Question is required")

    # 检查知识库是否存在
    storage_path = get_storage_path(kb_id)
    if not os.path.exists(storage_path):
        raise HTTPException(status_code=404, detail=f"Knowledge base {kb_id} not found")

    try:
        from lightrag import QueryParam

        rag = await get_or_create_rag(kb_id)

        # 执行查询
        logger.info(f"[{kb_id}] Query: '{question}' (mode: {mode})")

        result = await rag.aquery(question, param=QueryParam(mode=mode))

        logger.info(f"[{kb_id}] Query result length: {len(result)} chars")

        return {
            "kb_id": kb_id,
            "question": question,
            "mode": mode,
            "answer": result,
        }

    except Exception as e:
        logger.error(f"[{kb_id}] Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/index/{kb_id}")
async def delete_index(kb_id: str):
    """删除知识库索引"""
    import shutil

    storage_path = get_storage_path(kb_id)

    # 从缓存移除
    if kb_id in rag_instances:
        del rag_instances[kb_id]

    if kb_id in indexing_tasks:
        del indexing_tasks[kb_id]

    # 删除存储目录
    if os.path.exists(storage_path):
        shutil.rmtree(storage_path)
        logger.info(f"Deleted index for kb: {kb_id}")
        return {"status": "deleted", "kb_id": kb_id}

    return {"status": "not_found", "kb_id": kb_id}


@app.get("/indexes")
async def list_indexes():
    """列出所有知识库索引"""
    indexes = []

    if os.path.exists(LIGHTRAG_STORAGE_DIR):
        for name in os.listdir(LIGHTRAG_STORAGE_DIR):
            if name.startswith("kb_"):
                kb_id = name[3:]  # 去掉 "kb_" 前缀
                storage_path = os.path.join(LIGHTRAG_STORAGE_DIR, name)
                indexes.append(
                    {
                        "kb_id": kb_id,
                        "path": storage_path,
                        "cached": kb_id in rag_instances,
                    }
                )

    return {"indexes": indexes, "total": len(indexes)}


@app.get("/graph/{kb_id}")
async def get_graph(kb_id: str, limit: int = 100):
    """
    获取知识图谱数据（实体和关系）
    用于前端可视化展示
    """
    import xml.etree.ElementTree as ET

    storage_path = get_storage_path(kb_id)

    # 如果知识库目录不存在，返回空数据（而不是 404）
    if not os.path.exists(storage_path):
        return {
            "kb_id": kb_id,
            "entities": [],
            "relations": [],
            "message": "知识图谱尚未构建，请先点击「构建知识图谱」按钮",
            "stats": {"entity_count": 0, "relation_count": 0},
        }

    entities = []
    relations = []
    entity_map = {}

    try:
        # 读取 GraphML 文件（LightRAG 的实际存储格式）
        graphml_file = os.path.join(storage_path, "graph_chunk_entity_relation.graphml")

        if os.path.exists(graphml_file):
            logger.info(f"[{kb_id}] Reading GraphML file: {graphml_file}")
            tree = ET.parse(graphml_file)
            root = tree.getroot()

            # GraphML 命名空间
            ns = {"graphml": "http://graphml.graphdrawing.org/xmlns"}

            # 找到 graph 元素（尝试带命名空间和不带命名空间）
            graph = root.find(".//graphml:graph", ns)
            if graph is None:
                graph = root.find(".//{http://graphml.graphdrawing.org/xmlns}graph")
            if graph is None:
                graph = root.find(".//graph")

            if graph is not None:
                # 解析节点（实体）
                nodes = graph.findall(".//{http://graphml.graphdrawing.org/xmlns}node")
                if not nodes:
                    nodes = graph.findall(".//node")

                for node in nodes:
                    node_id = node.get("id", "")
                    if not node_id:
                        continue

                    # 获取节点属性
                    entity_type = "ENTITY"
                    description = ""

                    for data in node.findall(
                        ".//{http://graphml.graphdrawing.org/xmlns}data"
                    ) or node.findall(".//data"):
                        key = data.get("key", "")
                        text = (data.text or "").strip()
                        if key == "entity_type" or key == "d0":
                            entity_type = text.upper() if text else "ENTITY"
                        elif key == "description" or key == "d1":
                            description = text

                    entity_map[node_id] = {
                        "id": node_id,
                        "name": node_id,
                        "type": entity_type,
                        "description": description,
                    }

                # 解析边（关系）
                edges = graph.findall(".//{http://graphml.graphdrawing.org/xmlns}edge")
                if not edges:
                    edges = graph.findall(".//edge")

                for edge in edges:
                    source = edge.get("source", "")
                    target = edge.get("target", "")

                    if not source or not target:
                        continue

                    # 获取关系类型
                    rel_type = "RELATED"
                    description = ""

                    for data in edge.findall(
                        ".//{http://graphml.graphdrawing.org/xmlns}data"
                    ) or edge.findall(".//data"):
                        key = data.get("key", "")
                        text = (data.text or "").strip()
                        if key in ("relation_type", "d2", "d4") and text:
                            rel_type = text
                        elif key in ("description", "d3", "d5"):
                            description = text

                    relations.append(
                        {
                            "source": source,
                            "target": target,
                            "type": rel_type,
                            "description": description,
                        }
                    )

                entities = list(entity_map.values())
                logger.info(
                    f"[{kb_id}] Loaded {len(entities)} entities, {len(relations)} relations from GraphML"
                )

        # 如果没有数据，返回提示
        if not entities and not relations:
            files = os.listdir(storage_path) if os.path.exists(storage_path) else []
            logger.warning(f"[{kb_id}] No graph data. Storage files: {files}")
            return {
                "kb_id": kb_id,
                "entities": [],
                "relations": [],
                "message": "知识图谱正在构建中或构建失败。请稍后刷新重试，或重新点击「构建知识图谱」按钮。",
                "stats": {"entity_count": 0, "relation_count": 0},
            }

        # 限制返回数量
        entities = entities[:limit]
        relations = relations[:limit]

        return {
            "kb_id": kb_id,
            "entities": entities,
            "relations": relations,
            "stats": {
                "entity_count": len(entities),
                "relation_count": len(relations),
            },
        }

    except Exception as e:
        logger.error(f"[{kb_id}] Failed to read graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========== Embedding 函数包装器 ==========


class EmbeddingFunc:
    """Embedding 函数包装器，符合 LightRAG 要求的接口"""

    def __init__(self, embedding_dim: int, max_token_size: int, func):
        self.embedding_dim = embedding_dim
        self.max_token_size = max_token_size
        self.func = func  # LightRAG 期望 .func 属性

    async def __call__(self, texts: List[str]) -> List[List[float]]:
        return await self.func(texts)


# ========== 启动入口 ==========

if __name__ == "__main__":
    import uvicorn

    logger.info(f"Starting LightRAG service on {SERVICE_HOST}:{SERVICE_PORT}")
    logger.info(f"Storage directory: {LIGHTRAG_STORAGE_DIR}")
    logger.info(f"LLM Model: {OPENAI_MODEL}")

    uvicorn.run(
        "main:app",
        host=SERVICE_HOST,
        port=SERVICE_PORT,
        reload=False,
        log_level=LOG_LEVEL.lower(),
    )
