/**
 * LightRAG HTTP 客户端
 * 用于与 Python LightRAG 服务通信
 */

// LightRAG 服务地址
const LIGHTRAG_BASE_URL = process.env.LIGHTRAG_URL || 'http://localhost:8005';

// 查询模式
export type LightRAGMode = 'local' | 'global' | 'hybrid' | 'naive';

// 索引请求
export interface IndexRequest {
  kb_id: string;
  documents: Array<{
    id: string;
    name: string;
    content: string;
  }>;
}

// 查询请求
export interface QueryRequest {
  kb_id: string;
  question: string;
  mode?: LightRAGMode;
}

// 查询响应
export interface QueryResponse {
  kb_id: string;
  question: string;
  mode: string;
  answer: string;
}

// 索引状态
export interface IndexStatus {
  kb_id: string;
  status: 'pending' | 'indexing' | 'completed' | 'failed' | 'not_found';
  progress: number;
  message: string;
}

// 健康检查响应
export interface HealthResponse {
  status: string;
  service: string;
  storage_dir: string;
  instances: number;
}

// 图谱实体
export interface GraphEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
}

// 图谱关系
export interface GraphRelation {
  source: string;
  target: string;
  type: string;
  description?: string;
}

// 图谱数据
export interface GraphData {
  kb_id: string;
  entities: GraphEntity[];
  relations: GraphRelation[];
  stats?: {
    entity_count: number;
    relation_count: number;
  };
  message?: string;
}

/**
 * LightRAG 客户端类
 */
class LightRAGClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string = LIGHTRAG_BASE_URL, timeout: number = 60000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * 健康检查
   */
  async health(): Promise<HealthResponse | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.log(`[LightRAG] Health check failed: ${response.status}`);
        return null;
      }

      return await response.json();
    } catch (error: any) {
      console.log(`[LightRAG] Health check error: ${error.message}`);
      return null;
    }
  }

  /**
   * 检查服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    const health = await this.health();
    return health?.status === 'healthy';
  }

  /**
   * 索引文档（构建知识图谱）
   */
  async index(request: IndexRequest): Promise<{ status: string; kb_id: string; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Index failed: ${error}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error(`[LightRAG] Index error: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取知识图谱数据（用于可视化）
   */
  async getGraph(kbId: string, limit: number = 100): Promise<GraphData> {
    try {
      const response = await fetch(`${this.baseUrl}/graph/${kbId}?limit=${limit}`);

      if (!response.ok) {
        throw new Error(`Get graph failed: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error(`[LightRAG] Get graph error: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取索引状态
   */
  async getIndexStatus(kbId: string): Promise<IndexStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/index/${kbId}/status`);

      if (!response.ok) {
        throw new Error(`Get status failed: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error(`[LightRAG] Get status error: ${error.message}`);
      return {
        kb_id: kbId,
        status: 'not_found',
        progress: 0,
        message: error.message,
      };
    }
  }

  /**
   * 等待索引完成
   */
  async waitForIndex(kbId: string, maxWaitMs: number = 300000): Promise<IndexStatus> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2秒轮询一次

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getIndexStatus(kbId);

      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }

      console.log(`[LightRAG] Indexing progress: ${(status.progress * 100).toFixed(1)}% - ${status.message}`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return {
      kb_id: kbId,
      status: 'failed',
      progress: 0,
      message: 'Timeout waiting for index',
    };
  }

  /**
   * 查询知识库（图谱检索）
   * 
   * @param request 查询请求
   * @param request.mode 查询模式:
   *   - local: 基于实体的局部检索（适合具体问题，如"谁是xxx"、"xxx是什么"）
   *   - global: 基于主题的全局检索（适合总结性问题，如"总结xxx"）
   *   - hybrid: 混合模式（推荐，兼顾两者）
   *   - naive: 简单向量检索（对照组）
   */
  async query(request: QueryRequest): Promise<QueryResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kb_id: request.kb_id,
          question: request.question,
          mode: request.mode || 'hybrid',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Query failed: ${error}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error(`[LightRAG] Query error: ${error.message}`);
      throw error;
    }
  }

  /**
   * 删除知识库索引
   */
  async deleteIndex(kbId: string): Promise<{ status: string; kb_id: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/index/${kbId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error(`[LightRAG] Delete error: ${error.message}`);
      throw error;
    }
  }

  /**
   * 列出所有知识库索引
   */
  async listIndexes(): Promise<{ indexes: Array<{ kb_id: string; path: string; cached: boolean }>; total: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/indexes`);

      if (!response.ok) {
        throw new Error(`List failed: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error(`[LightRAG] List error: ${error.message}`);
      return { indexes: [], total: 0 };
    }
  }
}

// 导出单例
export const lightragClient = new LightRAGClient();

// 也导出类供自定义实例化
export { LightRAGClient };

