/**
 * Meilisearch 服务模块
 * 提供关键词搜索能力，与向量搜索配合实现混合搜索
 */

import { MeiliSearch, Index } from 'meilisearch';

// Meilisearch 文档结构
export interface MeiliDocument {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
  knowledgeBaseId: string;
}

// 搜索结果结构
export interface SearchResult {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  score: number;
}

class MeilisearchService {
  private client: MeiliSearch | null = null;
  private indexCache: Map<string, Index<MeiliDocument>> = new Map();

  /**
   * 初始化 Meilisearch 客户端
   */
  private getClient(): MeiliSearch {
    if (!this.client) {
      const host = process.env.MEILISEARCH_HOST || 'http://localhost:7700';
      const apiKey = process.env.MEILISEARCH_API_KEY || '';

      this.client = new MeiliSearch({
        host,
        apiKey,
      });

      console.log(`[Meilisearch] Connected to ${host}`);
    }
    return this.client;
  }

  /**
   * 获取或创建知识库索引
   */
  private async getIndex(knowledgeBaseId: string): Promise<Index<MeiliDocument>> {
    const indexName = `kb_${knowledgeBaseId.replace(/-/g, '_')}`;

    if (this.indexCache.has(indexName)) {
      return this.indexCache.get(indexName)!;
    }

    const client = this.getClient();

    try {
      // 尝试获取已存在的索引
      const index = await client.getIndex<MeiliDocument>(indexName);
      this.indexCache.set(indexName, index);
      return index;
    } catch (error: any) {
      // 索引不存在，创建新索引
      const errorCode = error.code || error.cause?.code;
      if (errorCode === 'index_not_found') {
        console.log(`[Meilisearch] Creating new index: ${indexName}`);
        
        const task = await client.createIndex(indexName, { primaryKey: 'id' });
        // 等待索引创建完成（轮询检查）
        await new Promise(resolve => setTimeout(resolve, 500));

        const index = await client.getIndex<MeiliDocument>(indexName);

        // 配置索引设置
        await index.updateSettings({
          // 可搜索字段
          searchableAttributes: ['content', 'documentName'],
          // 过滤字段
          filterableAttributes: ['knowledgeBaseId', 'documentId', 'documentName'],
          // 排序字段
          sortableAttributes: ['chunkIndex'],
          // 中文分词（使用 jieba）
          // 注意：需要 Meilisearch 启用中文支持
        });

        this.indexCache.set(indexName, index);
        return index;
      }
      throw error;
    }
  }

  /**
   * 索引文档内容
   * @param knowledgeBaseId 知识库 ID
   * @param documents 文档列表
   */
  async indexDocuments(
    knowledgeBaseId: string,
    documents: Array<{
      documentId: string;
      documentName: string;
      content: string;
      chunks: string[];
    }>
  ): Promise<void> {
    try {
      const index = await this.getIndex(knowledgeBaseId);

      const meiliDocs: MeiliDocument[] = [];

      for (const doc of documents) {
        // 为每个 chunk 创建一条记录
        doc.chunks.forEach((chunk, i) => {
          meiliDocs.push({
            id: `${doc.documentId}_chunk_${i}`,
            documentId: doc.documentId,
            documentName: doc.documentName,
            content: chunk,
            chunkIndex: i,
            knowledgeBaseId,
          });
        });
      }

      if (meiliDocs.length > 0) {
        await index.addDocuments(meiliDocs);
        // 等待索引完成
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log(`[Meilisearch] Indexed ${meiliDocs.length} chunks for KB ${knowledgeBaseId}`);
      }
    } catch (error) {
      console.error(`[Meilisearch] Failed to index documents:`, error);
      // 不抛出错误，允许系统在没有 Meilisearch 时继续运行
    }
  }

  /**
   * 删除知识库索引
   */
  async deleteIndex(knowledgeBaseId: string): Promise<void> {
    try {
      const indexName = `kb_${knowledgeBaseId.replace(/-/g, '_')}`;
      const client = this.getClient();
      
      await client.deleteIndex(indexName);
      this.indexCache.delete(indexName);
      
      console.log(`[Meilisearch] Deleted index: ${indexName}`);
    } catch (error) {
      console.error(`[Meilisearch] Failed to delete index:`, error);
    }
  }

  /**
   * 删除文档
   */
  async deleteDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    try {
      const index = await this.getIndex(knowledgeBaseId);
      
      // 删除该文档的所有 chunks
      await index.deleteDocuments({
        filter: `documentId = "${documentId}"`,
      });
      
      console.log(`[Meilisearch] Deleted document ${documentId} from KB ${knowledgeBaseId}`);
    } catch (error) {
      console.error(`[Meilisearch] Failed to delete document:`, error);
    }
  }

  /**
   * 关键词搜索
   * @param knowledgeBaseId 知识库 ID
   * @param query 搜索关键词
   * @param limit 返回数量
   * @returns 搜索结果
   */
  async search(
    knowledgeBaseId: string,
    query: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    try {
      const index = await this.getIndex(knowledgeBaseId);

      const results = await index.search(query, {
        limit,
        attributesToRetrieve: ['id', 'documentId', 'documentName', 'content'],
        // 高亮匹配内容
        attributesToHighlight: ['content'],
        highlightPreTag: '**',
        highlightPostTag: '**',
      });

      console.log(`[Meilisearch] Search "${query}" found ${results.hits.length} results`);

      return results.hits.map((hit, rank) => ({
        id: hit.id,
        documentId: hit.documentId,
        documentName: hit.documentName,
        content: hit._formatted?.content || hit.content,
        // Meilisearch 不返回分数，用排名转换为分数
        score: 1 / (rank + 1),
      }));
    } catch (error) {
      console.error(`[Meilisearch] Search failed:`, error);
      return [];
    }
  }

  /**
   * 检查 Meilisearch 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.health();
      return true;
    } catch {
      return false;
    }
  }
}

// 导出单例
export const meilisearchService = new MeilisearchService();

