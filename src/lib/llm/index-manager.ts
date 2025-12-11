/**
 * 索引管理模块
 * 负责向量索引的创建、加载、删除
 */
import { VectorStoreIndex, storageContextFromDefaults } from 'llamaindex';
import { SimpleDirectoryReader } from '@llamaindex/readers/directory';
import * as fs from 'fs-extra';
import * as path from 'path';
import { configureLLM } from './config';
import { prisma } from '../prisma';
import { meilisearchService } from '../meilisearch';
import { lightragClient } from '../lightrag-client';

// 索引缓存
const indexCache = new Map<string, VectorStoreIndex>();

/**
 * 获取存储目录
 */
export function getStorageDir(knowledgeBaseId: string): string {
  const baseDir = process.env.STORAGE_DIR || './storage';
  return path.join(baseDir, `kb_${knowledgeBaseId}`);
}

/**
 * 创建或更新知识库索引
 */
export async function createOrUpdateIndex(
  knowledgeBaseId: string,
  documentsPath: string,
  onProgress?: (progress: number, message: string) => void,
): Promise<void> {
  try {
    configureLLM();
    console.log(`[LLM] Starting index creation for KB ${knowledgeBaseId}`);
    onProgress?.(5, '初始化处理环境...');
    
    // 清除旧缓存
    if (indexCache.has(knowledgeBaseId)) {
      indexCache.delete(knowledgeBaseId);
      console.log(`[LLM] Cleared cached index for KB ${knowledgeBaseId}`);
    }
    
    const storageDir = getStorageDir(knowledgeBaseId);
    
    // 删除旧的存储目录
    if (await fs.pathExists(storageDir)) {
      await fs.remove(storageDir);
      console.log(`[LLM] Removed old storage dir: ${storageDir}`);
    }
    
    await fs.ensureDir(storageDir);

    // 检查是否有文档
    const files = await fs.readdir(documentsPath);
    if (files.length === 0) {
      console.warn(`No documents found in ${documentsPath}`);
      return;
    }

    // 加载文档
    console.log(`[LLM] Loading documents from ${documentsPath}`);
    onProgress?.(20, '加载文档内容...');
    
    const reader = new SimpleDirectoryReader();
    const documents = await reader.loadData({ directoryPath: documentsPath });

    // 为每个文档添加 metadata
    const documentContents: Map<string, { content: string; chunks: string[] }> = new Map();
    
    for (const doc of documents) {
      const filePath = doc.metadata?.file_path || doc.metadata?.filePath || '';
      const fileName = filePath ? path.basename(filePath) : '';
      const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
      
      doc.metadata = {
        ...doc.metadata,
        fileName: fileName,
        documentName: fileNameWithoutExt,
      };
      
      // 收集文档内容
      if (fileName && doc.text) {
        const existing = documentContents.get(fileName);
        if (existing) {
          existing.content += '\n\n' + doc.text;
          existing.chunks.push(doc.text);
        } else {
          documentContents.set(fileName, {
            content: doc.text,
            chunks: [doc.text],
          });
        }
      }
      
      // 在文档内容前添加文件名标识
      if (fileNameWithoutExt && doc.text) {
        doc.text = `【文档: ${fileNameWithoutExt}】\n\n${doc.text}`;
      }
      
      console.log(`[LLM] Document metadata: ${fileName} -> ${fileNameWithoutExt}`);
    }

    console.log(`[LLM] Loaded ${documents.length} documents for KB ${knowledgeBaseId}`);
    onProgress?.(35, `已加载 ${documents.length} 个文档`);

    // 保存原文到数据库
    console.log(`[LLM] Saving document content to database...`);
    onProgress?.(40, '保存文档原文到数据库...');
    
    const pdfParse = require('pdf-parse');
    const mammoth = require('mammoth');
    
    for (const fileName of files) {
      const filePath = path.join(documentsPath, fileName);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      
      const ext = path.extname(fileName).toLowerCase();
      let content = '';
      
      try {
        if (ext === '.pdf') {
          const buffer = await fs.readFile(filePath);
          const pdfData = await pdfParse(buffer);
          content = pdfData.text || '';
          console.log(`[LLM] Extracted PDF content: ${fileName} (${content.length} chars)`);
        } else if (ext === '.docx') {
          const buffer = await fs.readFile(filePath);
          const result = await mammoth.extractRawText({ buffer });
          content = result.value || '';
          console.log(`[LLM] Extracted DOCX content: ${fileName} (${content.length} chars)`);
        } else if (ext === '.txt' || ext === '.md') {
          content = await fs.readFile(filePath, 'utf-8');
          console.log(`[LLM] Read text file: ${fileName} (${content.length} chars)`);
        }
      } catch (extractError) {
        console.error(`[LLM] Failed to extract content from ${fileName}:`, extractError);
        const fallback = documentContents.get(fileName);
        if (fallback) {
          content = fallback.content;
        }
      }
      
      if (!content) continue;
      
      // 保存到数据库
      try {
        const searchName = fileName.replace(/^\d+_/, '');
        const dbDoc = await prisma.document.findFirst({
          where: {
            knowledgeBaseId,
            name: searchName,
          },
        });
        
        if (dbDoc) {
          await prisma.document.update({
            where: { id: dbDoc.id },
            data: {
              content: content,
              wordCount: content.length,
            },
          });
          console.log(`[LLM] ✅ Saved content for ${fileName} (${content.length} chars)`);
          
          documentContents.set(fileName, {
            content: content,
            chunks: [content],
          });
        } else {
          console.log(`[LLM] ⚠️ Document not found in DB: ${searchName}`);
        }
      } catch (dbError) {
        console.error(`[LLM] Failed to save content for ${fileName}:`, dbError);
      }
    }

    // 索引到 Meilisearch
    console.log(`[LLM] Indexing documents to Meilisearch...`);
    onProgress?.(45, '索引到 Meilisearch...');
    
    try {
      const meiliDocs = [];
      for (const [fileName, data] of documentContents) {
        const searchName = fileName.replace(/^\d+_/, '');
        const dbDoc = await prisma.document.findFirst({
          where: {
            knowledgeBaseId,
            name: searchName,
          },
        });
        
        if (dbDoc) {
          meiliDocs.push({
            documentId: dbDoc.id,
            documentName: fileName.replace(/\.[^/.]+$/, ''),
            content: data.content,
            chunks: data.chunks,
          });
        }
      }
      
      if (meiliDocs.length > 0) {
        await meilisearchService.indexDocuments(knowledgeBaseId, meiliDocs);
      }
    } catch (meiliError) {
      console.error(`[LLM] Meilisearch indexing failed (continuing without it):`, meiliError);
    }

    // 索引到 LightRAG
    console.log(`[LLM] Indexing documents to LightRAG...`);
    onProgress?.(47, '索引到 LightRAG（构建知识图谱）...');
    
    try {
      const lightragAvailable = await lightragClient.isAvailable();
      
      if (lightragAvailable) {
        const lightragDocs = [];
        for (const [fileName, data] of documentContents) {
          const searchName = fileName.replace(/^\d+_/, '');
          const dbDoc = await prisma.document.findFirst({
            where: {
              knowledgeBaseId,
              name: searchName,
            },
          });
          
          if (dbDoc && data.content) {
            lightragDocs.push({
              id: dbDoc.id,
              name: fileName.replace(/\.[^/.]+$/, ''),
              content: data.content,
            });
          }
        }
        
        if (lightragDocs.length > 0) {
          // 异步索引
          lightragClient.index({
            kb_id: knowledgeBaseId,
            documents: lightragDocs,
          }).then(() => {
            console.log(`[LLM] ✅ LightRAG indexing started for ${lightragDocs.length} documents`);
          }).catch((err) => {
            console.error(`[LLM] LightRAG indexing failed:`, err);
          });
        }
      } else {
        console.log(`[LLM] LightRAG not available, skipping graph indexing`);
      }
    } catch (lightragError) {
      console.error(`[LLM] LightRAG indexing failed (continuing without it):`, lightragError);
    }

    // 创建存储上下文
    console.log(`[LLM] Creating storage context at ${storageDir}`);
    onProgress?.(50, '创建存储上下文...');
    
    const storageContext = await storageContextFromDefaults({
      persistDir: storageDir,
    });

    // 创建向量索引
    console.log(`[LLM] Creating vector index for ${documents.length} documents...`);
    onProgress?.(60, `正在生成向量索引（${documents.length} 个文档）...`);
    
    const startTime = Date.now();
    const index = await VectorStoreIndex.fromDocuments(documents, { storageContext });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    onProgress?.(90, '保存索引文件...');

    // 缓存索引
    indexCache.set(knowledgeBaseId, index);

    console.log(`[LLM] ✅ Index created successfully for KB ${knowledgeBaseId}`);
    console.log(`[LLM] Total time: ${duration}s, Average: ${(parseFloat(duration) / documents.length).toFixed(2)}s per document`);
    onProgress?.(100, '索引创建完成！');
  } catch (error) {
    console.error(`[LLM] ❌ Failed to create index for KB ${knowledgeBaseId}:`, error);
    onProgress?.(0, '索引创建失败');
    throw error;
  }
}

/**
 * 加载已存在的索引
 */
export async function loadIndex(knowledgeBaseId: string): Promise<VectorStoreIndex> {
  configureLLM();
  
  // 检查缓存
  if (indexCache.has(knowledgeBaseId)) {
    return indexCache.get(knowledgeBaseId)!;
  }

  const storageDir = getStorageDir(knowledgeBaseId);

  // 检查存储目录是否存在
  if (!(await fs.pathExists(storageDir))) {
    throw new Error(`Index not found for knowledge base ${knowledgeBaseId}`);
  }

  // 从持久化存储加载
  const storageContext = await storageContextFromDefaults({
    persistDir: storageDir,
  });

  const index = await VectorStoreIndex.init({
    storageContext,
  });

  // 缓存索引
  indexCache.set(knowledgeBaseId, index);

  console.log(`Index loaded for KB ${knowledgeBaseId}`);
  return index;
}

/**
 * 删除知识库索引
 */
export async function deleteIndex(knowledgeBaseId: string): Promise<void> {
  const storageDir = getStorageDir(knowledgeBaseId);

  // 从缓存移除
  indexCache.delete(knowledgeBaseId);

  // 删除存储目录
  if (await fs.pathExists(storageDir)) {
    await fs.remove(storageDir);
    console.log(`Index deleted for KB ${knowledgeBaseId}`);
  }
}

/**
 * 检查索引是否存在
 */
export async function indexExists(knowledgeBaseId: string): Promise<boolean> {
  const storageDir = getStorageDir(knowledgeBaseId);
  return fs.pathExists(storageDir);
}

