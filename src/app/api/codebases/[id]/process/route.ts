import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cloneRepo, walkCodeFiles, readCodeFile } from '@/lib/github/repo-fetcher';
import { createCodeChunks, getChunkStats } from '@/lib/github/chunk-strategy';
import { extractSymbols, saveSymbolsToDatabase, ModuleMapping } from '@/lib/github/call-graph-builder';
import { analyzeRepoStructure, getStructureStats } from '@/lib/github/repo-structure';
import { buildModuleGraph } from '@/lib/github/module-graph-builder';
import { meilisearchService } from '@/lib/meilisearch';
import * as path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 分钟超时

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const codeBaseId = params.id;

    // 获取代码库信息
    const codeBase = await prisma.codeBase.findUnique({
      where: { id: codeBaseId },
    });

    if (!codeBase) {
      return NextResponse.json({ error: '代码库不存在' }, { status: 404 });
    }

    if (codeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此代码库' }, { status: 403 });
    }

    // 创建 SSE 流
    const encoder = new TextEncoder();
    let isStreamClosed = false;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: any) => {
          // 检查流是否已关闭
          if (isStreamClosed) {
            return;
          }
          try {
            const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(message));
          } catch (e) {
            // 流已关闭，标记并清理
            isStreamClosed = true;
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              heartbeatInterval = null;
            }
            console.log('[Process] Stream closed by client');
          }
        };

        // 心跳定时器
        let lastProgress = 0;
        heartbeatInterval = setInterval(() => {
          if (isStreamClosed) {
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              heartbeatInterval = null;
            }
            return;
          }
          sendEvent('heartbeat', { 
            status: 'processing', 
            message: '处理中...',
            progress: lastProgress
          });
        }, 5000);

        try {
          // ========== Step 1: 克隆仓库 (5-20%) ==========
          await prisma.codeBase.update({
            where: { id: codeBaseId },
            data: { status: 'cloning' },
          });

          sendEvent('status', { 
            status: 'cloning', 
            message: '正在克隆仓库...',
            progress: 5
          });
          lastProgress = 5;

          const repoDir = path.join(
            process.env.UPLOAD_DIR || './uploads',
            `codebase_${codeBaseId}`
          );
          
          await cloneRepo(
            codeBase.githubUrl,
            repoDir,
            codeBase.branch,
            (phase, progress) => {
              lastProgress = 5 + (progress * 0.15); // 5-20%
              sendEvent('status', {
                status: 'cloning',
                message: `克隆中: ${phase}`,
                progress: lastProgress
              });
            }
          );

          sendEvent('status', { 
            status: 'cloning', 
            message: '克隆完成！',
            progress: 20
          });
          lastProgress = 20;

          // ========== Step 2: 结构分析 (20-25%) - DeepWiki 核心 ==========
          sendEvent('status', { 
            status: 'parsing', 
            message: '正在分析仓库结构...',
            progress: 21
          });

          await prisma.codeBase.update({
            where: { id: codeBaseId },
            data: { status: 'parsing' },
          });

          const repoStructure = await analyzeRepoStructure(repoDir, (msg) => {
            sendEvent('status', {
              status: 'parsing',
              message: msg,
              progress: 22
            });
          });

          const structureStats = getStructureStats(repoStructure);
          console.log(`[Process] Structure analysis: type=${repoStructure.type}, modules=${structureStats.moduleCount}, language=${repoStructure.language}`);

          sendEvent('status', { 
            status: 'parsing', 
            message: `结构分析完成: ${repoStructure.type} 项目, ${structureStats.moduleCount} 个模块`,
            progress: 25
          });
          lastProgress = 25;

          // ========== Step 3: 模块图构建 (25-45%) - DeepWiki Layer 1 ==========
          sendEvent('status', { 
            status: 'indexing', 
            message: '正在构建模块图...',
            progress: 26
          });

          await prisma.codeBase.update({
            where: { id: codeBaseId },
            data: { status: 'indexing' },
          });

          let moduleMapping: ModuleMapping[] = [];
          
          try {
            const moduleGraphResult = await buildModuleGraph(
              codeBaseId,
              repoDir,
              repoStructure,
              (current, total, msg) => {
                const progress = 26 + ((current / total) * 19); // 26-45%
                lastProgress = progress;
                sendEvent('status', {
                  status: 'indexing',
                  message: msg,
                  progress
                });
              }
            );

            console.log(`[Process] Module graph: ${moduleGraphResult.modulesCreated} modules, ${moduleGraphResult.summariesGenerated} summaries, ${moduleGraphResult.embeddingsGenerated} embeddings`);

            // 获取模块映射用于符号归属
            const modules = await prisma.repoModule.findMany({
              where: { codeBaseId },
              select: { id: true, path: true, name: true },
            });
            moduleMapping = modules.map(m => ({
              moduleId: m.id,
              modulePath: m.path,
              moduleName: m.name,
            }));

            sendEvent('status', { 
              status: 'indexing', 
              message: `模块图构建完成: ${moduleGraphResult.modulesCreated} 个模块, ${moduleGraphResult.summariesGenerated} 个摘要`,
              progress: 45
            });
          } catch (moduleError: any) {
            console.error('[Process] Module graph building failed:', moduleError);
            sendEvent('status', { 
              status: 'indexing', 
              message: '警告: 模块图构建失败，继续处理...',
              progress: 45
            });
          }
          lastProgress = 45;

          // ========== Step 4: 扫描文件 + 符号图构建 (45-70%) - DeepWiki Layer 2 & 3 ==========
          sendEvent('status', { 
            status: 'indexing', 
            message: '正在扫描代码文件...',
            progress: 46
          });

          const files = await walkCodeFiles(repoDir);
          
          sendEvent('status', { 
            status: 'indexing', 
            message: `发现 ${files.length} 个代码文件`,
            progress: 48
          });

          // 更新文件数量
          await prisma.codeBase.update({
            where: { id: codeBaseId },
            data: { fileCount: files.length },
          });

          // 删除旧的代码文件记录
          await prisma.codeFile.deleteMany({
            where: { codeBaseId },
          });

          // 批量创建代码文件记录
          const codeFileRecords = [];
          for (const file of files) {
            const content = await readCodeFile(file.path);
            const lineCount = content.split('\n').length;
            
            codeFileRecords.push({
              codeBaseId,
              path: file.relativePath,
              language: file.language,
              content: content.substring(0, 100000),
              lineCount,
            });
          }

          // 分批插入文件记录
          const batchSize = 50;
          for (let i = 0; i < codeFileRecords.length; i += batchSize) {
            const batch = codeFileRecords.slice(i, i + batchSize);
            await prisma.codeFile.createMany({
              data: batch,
            });
            
            const progress = 48 + ((i / codeFileRecords.length) * 7); // 48-55%
            lastProgress = progress;
            sendEvent('status', {
              status: 'indexing',
              message: `保存文件 ${Math.min(i + batchSize, codeFileRecords.length)}/${codeFileRecords.length}`,
              progress
            });
          }

          sendEvent('status', { 
            status: 'indexing', 
            message: '正在提取代码符号...',
            progress: 56
          });

          // 提取代码符号（用于关键词搜索）
          try {
            const symbolResult = await extractSymbols(files, (current, total, file) => {
              const progress = 56 + ((current / total) * 14); // 56-70%
              lastProgress = progress;
              sendEvent('status', {
                status: 'indexing',
                message: `提取符号 ${current}/${total}: ${file}`,
                progress
              });
            });

            // 保存符号到数据库（传入模块映射实现符号的模块归属）
            await saveSymbolsToDatabase(codeBaseId, symbolResult, moduleMapping);
            
            sendEvent('status', { 
              status: 'indexing', 
              message: `符号提取完成: ${symbolResult.symbols.length} 个符号`,
              progress: 70
            });
            
            console.log(`[Process] Symbols: ${symbolResult.symbols.length}`);
          } catch (symbolError: any) {
            console.error('[Process] Symbol extraction failed:', symbolError);
            sendEvent('status', { 
              status: 'indexing', 
              message: '警告: 符号提取失败，搜索功能可能受限',
              progress: 70
            });
          }
          lastProgress = 70;

          // ========== Step 5: Meilisearch 关键词索引 (70-90%) ==========
          sendEvent('status', { 
            status: 'indexing', 
            message: '正在生成代码块...',
            progress: 71
          });

          // 创建代码块
          const chunks = await createCodeChunks(files, (current, total, file) => {
            const progress = 71 + ((current / total) * 9); // 71-80%
            lastProgress = progress;
            sendEvent('status', {
              status: 'indexing',
              message: `生成代码块 ${current}/${total}: ${file}`,
              progress
            });
          });

          const chunkStats = getChunkStats(chunks);
          console.log(`[Process] Chunk stats:`, chunkStats);

          sendEvent('status', { 
            status: 'indexing', 
            message: `代码块生成完成 (${chunks.length} 个)，正在索引到搜索引擎...`,
            progress: 80
          });

          // Meilisearch 关键词索引
          try {
            const meiliDocs = chunks.map(chunk => ({
              documentId: chunk.id,
              documentName: chunk.metadata.name,
              content: chunk.content,
              chunks: [chunk.content],
            }));
            
            await meilisearchService.indexDocuments(
              `codebase_${codeBaseId}`, 
              meiliDocs,
              (current, total, message) => {
                const progress = 80 + Math.floor((current / total) * 18); // 80-98%
                sendEvent('status', { 
                  status: 'indexing', 
                  message: `搜索引擎索引中 (${current}/${total})...`,
                  progress
                });
              }
            );
            console.log(`[Process] Meilisearch indexed ${meiliDocs.length} chunks`);
          } catch (meiliError) {
            console.error('[Process] Meilisearch indexing failed:', meiliError);
            sendEvent('status', { 
              status: 'indexing', 
              message: '警告: 关键词索引失败，部分搜索功能可能不可用',
              progress: 92
            });
          }

          // ========== Step 6: 完成 (100%) ==========
          console.log(`[Process] All indexing completed (DeepWiki architecture)`);

          // 更新状态为完成
          await prisma.codeBase.update({
            where: { id: codeBaseId },
            data: { 
              status: 'completed',
              lastSyncAt: new Date(),
            },
          });

          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }

          sendEvent('complete', { 
            status: 'completed', 
            message: '处理完成！',
            progress: 100,
            stats: {
              files: files.length,
              chunks: chunks.length,
              modules: structureStats.moduleCount,
              repoType: repoStructure.type,
              language: repoStructure.language,
              ...chunkStats,
            }
          });

          isStreamClosed = true;
          controller.close();
        } catch (error: any) {
          console.error('[Process] Error:', error);
          
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          
          // 更新状态为失败
          await prisma.codeBase.update({
            where: { id: codeBaseId },
            data: { 
              status: 'failed',
              errorMessage: error.message || '处理失败',
            },
          });

          sendEvent('error', { 
            status: 'failed', 
            message: error.message || '处理失败',
            progress: 0
          });

          isStreamClosed = true;
          controller.close();
        }
      },
      cancel() {
        // 客户端断开连接时清理
        console.log('[Process] Client disconnected, cleaning up...');
        isStreamClosed = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Process endpoint error:', error);
    return NextResponse.json({ error: '处理失败' }, { status: 500 });
  }
}
