/**
 * 模块图构建器
 * 借鉴 DeepWiki 的模块级语义摘要思想
 * 为每个模块生成 LLM 摘要和 embedding
 */

import { prisma } from '@/lib/prisma';
import { configureLLM, getOpenAI, getEmbedModel } from '@/lib/llm/config';
import { RepoStructure, ModuleInfo } from './repo-structure';
import * as fs from 'fs-extra';
import * as path from 'path';

// ==================== 类型定义 ====================

export interface ModuleGraphResult {
  modulesCreated: number;
  dependenciesCreated: number;
  summariesGenerated: number;
  embeddingsGenerated: number;
}

export interface ModuleSummary {
  summary: string;
  responsibilities: string[];
  publicAPI: string[];
}

// ==================== 主函数 ====================

/**
 * 构建模块图（Layer 1）
 * @param codeBaseId 代码库 ID
 * @param repoDir 仓库目录
 * @param structure 仓库结构分析结果
 * @param onProgress 进度回调
 */
export async function buildModuleGraph(
  codeBaseId: string,
  repoDir: string,
  structure: RepoStructure,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<ModuleGraphResult> {
  const result: ModuleGraphResult = {
    modulesCreated: 0,
    dependenciesCreated: 0,
    summariesGenerated: 0,
    embeddingsGenerated: 0,
  };

  const totalModules = structure.modules.length;
  if (totalModules === 0) {
    console.log('[ModuleGraph] No modules found in structure');
    return result;
  }

  console.log(`[ModuleGraph] Building module graph for ${totalModules} modules`);

  // 配置 LLM
  configureLLM();
  const llm = getOpenAI();
  const embedModel = getEmbedModel();

  // 1. 清理旧的模块数据
  await prisma.moduleDependency.deleteMany({
    where: { from: { codeBaseId } },
  });
  await prisma.repoModule.deleteMany({
    where: { codeBaseId },
  });

  // 2. 创建模块记录
  const moduleIdMap = new Map<string, string>(); // path -> id

  for (let i = 0; i < totalModules; i++) {
    const moduleInfo = structure.modules[i];
    onProgress?.(i + 1, totalModules * 3, `创建模块: ${moduleInfo.name}`);

    try {
      const module = await prisma.repoModule.create({
        data: {
          codeBaseId,
          name: moduleInfo.name,
          path: moduleInfo.path,
          entryFile: moduleInfo.entryFile,
          version: moduleInfo.version,
          readme: moduleInfo.readme?.substring(0, 10000), // 限制长度
        },
      });

      moduleIdMap.set(moduleInfo.path, module.id);
      result.modulesCreated++;
    } catch (error: any) {
      console.error(`[ModuleGraph] Failed to create module ${moduleInfo.name}:`, error.message);
    }
  }

  console.log(`[ModuleGraph] Created ${result.modulesCreated} modules`);

  // 3. 分析并创建模块依赖关系
  for (let i = 0; i < totalModules; i++) {
    const moduleInfo = structure.modules[i];
    const fromId = moduleIdMap.get(moduleInfo.path);
    if (!fromId) continue;

    onProgress?.(totalModules + i + 1, totalModules * 3, `分析依赖: ${moduleInfo.name}`);

    // 分析模块间的依赖
    const dependencies = await analyzeModuleDependencies(
      repoDir,
      moduleInfo,
      structure.modules,
      moduleIdMap
    );

    for (const dep of dependencies) {
      try {
        await prisma.moduleDependency.create({
          data: {
            fromId,
            toId: dep.toId,
            type: dep.type,
          },
        });
        result.dependenciesCreated++;
      } catch (error: any) {
        // 忽略重复键错误
        if (!error.message.includes('Unique constraint')) {
          console.error(`[ModuleGraph] Failed to create dependency:`, error.message);
        }
      }
    }
  }

  console.log(`[ModuleGraph] Created ${result.dependenciesCreated} dependencies`);

  // 4. 为每个模块生成 LLM 摘要
  for (let i = 0; i < totalModules; i++) {
    const moduleInfo = structure.modules[i];
    const moduleId = moduleIdMap.get(moduleInfo.path);
    if (!moduleId) continue;

    onProgress?.(totalModules * 2 + i + 1, totalModules * 3, `生成摘要: ${moduleInfo.name}`);

    try {
      // 读取模块核心文件内容
      const coreContent = await readModuleCoreContent(repoDir, moduleInfo);
      
      // 生成 LLM 摘要
      const summary = await generateModuleSummary(llm, moduleInfo, coreContent);
      
      if (summary) {
        // 生成摘要的 embedding
        const summaryText = `${moduleInfo.name}: ${summary.summary}`;
        let embedding: number[] | null = null;
        
        try {
          embedding = await embedModel.getTextEmbedding(summaryText);
          result.embeddingsGenerated++;
        } catch (embedError: any) {
          console.error(`[ModuleGraph] Failed to generate embedding for ${moduleInfo.name}:`, embedError.message);
        }

        // 更新模块记录
        await prisma.repoModule.update({
          where: { id: moduleId },
          data: {
            summary: summary.summary,
            responsibilities: JSON.stringify(summary.responsibilities),
            publicAPI: JSON.stringify(summary.publicAPI),
            embedding: embedding ? JSON.stringify(embedding) : null,
          },
        });

        result.summariesGenerated++;
      }
    } catch (error: any) {
      console.error(`[ModuleGraph] Failed to generate summary for ${moduleInfo.name}:`, error.message);
    }
  }

  console.log(`[ModuleGraph] Generated ${result.summariesGenerated} summaries, ${result.embeddingsGenerated} embeddings`);

  // 5. 更新 CodeBase 的结构信息
  await prisma.codeBase.update({
    where: { id: codeBaseId },
    data: {
      repoType: structure.type,
      mainLanguage: structure.language,
      structureJson: JSON.stringify({
        type: structure.type,
        language: structure.language,
        moduleCount: structure.modules.length,
        entryPoints: structure.entryPoints,
      }),
    },
  });

  return result;
}

// ==================== 依赖分析 ====================

interface DependencyInfo {
  toId: string;
  type: string;
}

/**
 * 分析模块的依赖关系
 */
async function analyzeModuleDependencies(
  repoDir: string,
  moduleInfo: ModuleInfo,
  allModules: ModuleInfo[],
  moduleIdMap: Map<string, string>
): Promise<DependencyInfo[]> {
  const dependencies: DependencyInfo[] = [];
  const moduleDir = path.join(repoDir, moduleInfo.path);

  // 1. 从 package.json 中的 dependencies 提取
  const packageJsonPath = path.join(moduleDir, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    try {
      const packageJson = await fs.readJson(packageJsonPath);
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.peerDependencies,
      };

      for (const [depName, depVersion] of Object.entries(allDeps || {})) {
        // 检查是否是内部模块
        const depModule = allModules.find(m => 
          m.name === depName || 
          depName.endsWith(`/${m.name}`) ||
          (depVersion as string)?.startsWith('workspace:')
        );
        
        if (depModule) {
          const toId = moduleIdMap.get(depModule.path);
          if (toId && toId !== moduleIdMap.get(moduleInfo.path)) {
            dependencies.push({ toId, type: 'import' });
          }
        }
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  // 2. 从代码 import 语句分析（简单版本）
  const importDeps = await analyzeImportsInModule(moduleDir, allModules, moduleIdMap, moduleInfo.path);
  for (const dep of importDeps) {
    if (!dependencies.find(d => d.toId === dep.toId)) {
      dependencies.push(dep);
    }
  }

  return dependencies;
}

/**
 * 分析模块内的 import 语句
 */
async function analyzeImportsInModule(
  moduleDir: string,
  allModules: ModuleInfo[],
  moduleIdMap: Map<string, string>,
  currentModulePath: string
): Promise<DependencyInfo[]> {
  const dependencies: DependencyInfo[] = [];
  
  // 只检查入口文件和 src 目录下的直接文件
  const filesToCheck: string[] = [];
  
  // 检查常见入口文件
  const entryFiles = ['index.ts', 'index.tsx', 'index.js', 'main.ts', 'main.js'];
  for (const entry of entryFiles) {
    const entryPath = path.join(moduleDir, entry);
    if (await fs.pathExists(entryPath)) {
      filesToCheck.push(entryPath);
    }
    const srcEntryPath = path.join(moduleDir, 'src', entry);
    if (await fs.pathExists(srcEntryPath)) {
      filesToCheck.push(srcEntryPath);
    }
  }

  // 正则匹配 import 语句
  const importRegex = /import\s+(?:[\w{}\s*,]+\s+from\s+)?['"]([^'"]+)['"]/g;
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const filePath of filesToCheck) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      const matches = [
        ...content.matchAll(importRegex),
        ...content.matchAll(requireRegex),
      ];

      for (const match of matches) {
        const importPath = match[1];
        
        // 检查是否引用了其他模块
        for (const otherModule of allModules) {
          if (otherModule.path === currentModulePath) continue;
          
          // 检查是否匹配模块名或路径
          if (
            importPath === otherModule.name ||
            importPath.startsWith(`@${otherModule.name}/`) ||
            importPath.includes(otherModule.path)
          ) {
            const toId = moduleIdMap.get(otherModule.path);
            if (toId && !dependencies.find(d => d.toId === toId)) {
              dependencies.push({ toId, type: 'import' });
            }
          }
        }
      }
    } catch (e) {
      // 忽略读取错误
    }
  }

  return dependencies;
}

// ==================== 摘要生成 ====================

/**
 * 读取模块核心文件内容（用于生成摘要）
 */
async function readModuleCoreContent(
  repoDir: string,
  moduleInfo: ModuleInfo
): Promise<string> {
  const moduleDir = path.join(repoDir, moduleInfo.path);
  const contents: string[] = [];
  
  // 添加模块信息
  contents.push(`Module: ${moduleInfo.name}`);
  if (moduleInfo.description) {
    contents.push(`Description: ${moduleInfo.description}`);
  }

  // 读取 README（如果有）
  if (moduleInfo.readme) {
    const readmePreview = moduleInfo.readme.substring(0, 2000);
    contents.push(`\nREADME:\n${readmePreview}`);
  }

  // 读取入口文件
  if (moduleInfo.entryFile) {
    const entryPath = path.join(moduleDir, moduleInfo.entryFile);
    if (await fs.pathExists(entryPath)) {
      try {
        const entryContent = await fs.readFile(entryPath, 'utf-8');
        // 只取前 3000 字符
        contents.push(`\nEntry file (${moduleInfo.entryFile}):\n${entryContent.substring(0, 3000)}`);
      } catch (e) {}
    }
  }

  // 读取核心文件（最多 3 个）
  const coreFilesToRead = moduleInfo.coreFiles.slice(0, 3);
  for (const file of coreFilesToRead) {
    const filePath = path.join(moduleDir, file);
    if (await fs.pathExists(filePath)) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        // 只取前 2000 字符
        contents.push(`\nCore file (${file}):\n${content.substring(0, 2000)}`);
      } catch (e) {}
    }
  }

  // 限制总长度
  const fullContent = contents.join('\n');
  return fullContent.substring(0, 15000);
}

/**
 * 使用 LLM 生成模块摘要
 */
async function generateModuleSummary(
  llm: any,
  moduleInfo: ModuleInfo,
  coreContent: string
): Promise<ModuleSummary | null> {
  const prompt = `分析以下代码模块，生成简洁的摘要。

模块名称: ${moduleInfo.name}
模块路径: ${moduleInfo.path}

代码内容:
${coreContent}

请用 JSON 格式返回以下信息:
{
  "summary": "一句话描述这个模块的核心功能（50字以内）",
  "responsibilities": ["职责1", "职责2", "职责3"],
  "publicAPI": ["导出的主要函数/类名1", "导出的主要函数/类名2"]
}

只返回 JSON，不要其他内容。`;

  try {
    const response = await llm.complete({ prompt });
    const text = response.text.trim();
    
    // 尝试解析 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || `${moduleInfo.name} 模块`,
        responsibilities: Array.isArray(parsed.responsibilities) ? parsed.responsibilities : [],
        publicAPI: Array.isArray(parsed.publicAPI) ? parsed.publicAPI : [],
      };
    }
  } catch (error: any) {
    console.error(`[ModuleGraph] LLM summary generation failed for ${moduleInfo.name}:`, error.message);
  }

  // 如果 LLM 失败，使用基础信息
  return {
    summary: moduleInfo.description || `${moduleInfo.name} 模块`,
    responsibilities: [],
    publicAPI: [],
  };
}

// ==================== 查询函数 ====================

/**
 * 获取模块列表
 */
export async function getModules(codeBaseId: string) {
  return prisma.repoModule.findMany({
    where: { codeBaseId },
    orderBy: { name: 'asc' },
  });
}

/**
 * 获取模块详情（包含依赖）
 */
export async function getModuleWithDependencies(moduleId: string) {
  return prisma.repoModule.findUnique({
    where: { id: moduleId },
    include: {
      dependencies: {
        include: {
          to: true,
        },
      },
      dependents: {
        include: {
          from: true,
        },
      },
    },
  });
}

/**
 * 向量搜索模块（用于问题路由）
 */
export async function searchModulesBySummary(
  codeBaseId: string,
  queryEmbedding: number[],
  limit: number = 5
): Promise<Array<{ id: string; name: string; path: string; summary: string; score: number }>> {
  const modules = await prisma.repoModule.findMany({
    where: {
      codeBaseId,
      embedding: { not: null },
    },
    select: {
      id: true,
      name: true,
      path: true,
      summary: true,
      embedding: true,
    },
  });

  // 计算相似度
  const results = modules
    .map(module => {
      const embedding = module.embedding ? JSON.parse(module.embedding) : null;
      if (!embedding) return null;

      const score = cosineSimilarity(queryEmbedding, embedding);
      return {
        id: module.id,
        name: module.name,
        path: module.path,
        summary: module.summary || '',
        score,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * 获取模块图统计
 */
export async function getModuleGraphStats(codeBaseId: string) {
  const moduleCount = await prisma.repoModule.count({
    where: { codeBaseId },
  });

  const dependencyCount = await prisma.moduleDependency.count({
    where: { from: { codeBaseId } },
  });

  const withSummary = await prisma.repoModule.count({
    where: { codeBaseId, summary: { not: null } },
  });

  const withEmbedding = await prisma.repoModule.count({
    where: { codeBaseId, embedding: { not: null } },
  });

  return {
    moduleCount,
    dependencyCount,
    withSummary,
    withEmbedding,
  };
}

