/**
 * GitHub 仓库获取模块
 * 使用 GitHub API 下载 zip 归档（更可靠，支持代理）
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';

const execAsync = promisify(exec);

export interface CodeFileInfo {
  path: string;
  relativePath: string;
  language: 'ts' | 'tsx' | 'js' | 'jsx' | 'md' | 'json' | 'other';
  size: number;
}

// 支持的代码文件扩展名
const CODE_EXTENSIONS: Record<string, CodeFileInfo['language']> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'jsx',
  '.md': 'md',
  '.json': 'json',
};

// 忽略的目录和文件
const IGNORE_PATTERNS = [
  // 依赖和缓存
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.turbo',
  '__pycache__',
  '.pytest_cache',
  'vendor',
  '.idea',
  '.vscode',
  // 锁文件
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

// 用于 LightRAG 知识图谱的额外过滤规则（减少处理量）
export const LIGHTRAG_IGNORE_PATTERNS = [
  // 测试相关
  '__tests__',
  '__test__',
  'test',
  'tests',
  'spec',
  'specs',
  '__mocks__',
  '__fixtures__',
  'fixtures',
  // 示例和文档
  'examples',
  'example',
  'demo',
  'demos',
  'docs',
  'doc',
  // 工具和脚本
  'scripts',
  'tools',
  'benchmarks',
  // 构建配置
  '.github',
  '.husky',
  'rollup',
  'webpack',
  'vite',
];

// 用于 LightRAG 的文件名过滤（正则）
export const LIGHTRAG_FILE_IGNORE_PATTERNS = [
  /\.test\.(ts|js|tsx|jsx)$/,
  /\.spec\.(ts|js|tsx|jsx)$/,
  /\.e2e\.(ts|js|tsx|jsx)$/,
  /\.bench\.(ts|js|tsx|jsx)$/,
  /\.d\.ts$/,  // 类型声明文件
  /\.config\.(ts|js|mjs|cjs)$/,  // 配置文件
  /\.stories\.(ts|js|tsx|jsx)$/,  // Storybook
];

/**
 * 检查文件是否应该被 LightRAG 处理
 * @param relativePath 相对路径
 * @param quickMode 快速模式：只处理 src/ 或核心目录
 */
export function shouldIncludeForLightRAG(relativePath: string, quickMode: boolean = false): boolean {
  // 检查目录
  for (const pattern of LIGHTRAG_IGNORE_PATTERNS) {
    if (relativePath.includes(`/${pattern}/`) || relativePath.startsWith(`${pattern}/`)) {
      return false;
    }
  }
  
  // 检查文件名
  const fileName = relativePath.split('/').pop() || '';
  for (const regex of LIGHTRAG_FILE_IGNORE_PATTERNS) {
    if (regex.test(fileName)) {
      return false;
    }
  }
  
  // 快速模式：只处理核心目录的 src 文件夹
  if (quickMode) {
    // 常见的核心代码目录（优先处理 src/ 子目录）
    const corePatterns = [
      // 标准项目结构
      /^src\//,
      /^lib\//,
      /^core\//,
      /^app\//,
      // Vue.js monorepo 核心包的 src 目录
      /^packages\/(runtime-core|compiler-core|reactivity|shared|vue|runtime-dom|compiler-dom)\/src\//,
      // React 项目结构
      /^components\//,
      /^hooks\//,
      /^utils\//,
      /^services\//,
      /^api\//,
      // 常见的源码目录
      /\/src\//,
    ];
    
    // 检查是否在核心目录中
    const isInCoreDir = corePatterns.some(pattern => pattern.test(relativePath));
    
    // 也包含根目录下的入口文件
    const isRootEntry = !relativePath.includes('/') && 
      /^(index|main|app)\.(ts|tsx|js|jsx)$/.test(fileName);
    
    if (!isInCoreDir && !isRootEntry) {
      return false;
    }
  }
  
  return true;
}

/**
 * 估算 LightRAG 处理的文件数量
 */
export function estimateLightRAGFiles(
  files: { path: string; language: string }[],
  quickMode: boolean = false
): { included: number; excluded: number; coreLanguages: string[] } {
  const coreLanguages = ['ts', 'tsx', 'js', 'jsx', 'vue', 'py', 'go', 'rs', 'java'];
  let included = 0;
  let excluded = 0;
  
  for (const file of files) {
    if (!coreLanguages.includes(file.language)) {
      excluded++;
      continue;
    }
    if (shouldIncludeForLightRAG(file.path, quickMode)) {
      included++;
    } else {
      excluded++;
    }
  }
  
  return { included, excluded, coreLanguages };
}

/**
 * 克隆 GitHub 仓库
 * 优先使用 GitHub zip API 下载（更可靠），失败则回退到 git 命令
 * @param url GitHub 仓库 URL
 * @param targetDir 目标目录
 * @param branch 分支名（默认 main）
 * @param onProgress 进度回调
 */
export async function cloneRepo(
  url: string,
  targetDir: string,
  branch: string = 'main',
  onProgress?: (phase: string, progress: number) => void
): Promise<void> {
  // 确保目标目录存在
  await fs.ensureDir(targetDir);
  
  // 如果目录已存在内容，先清空
  const files = await fs.readdir(targetDir);
  if (files.length > 0) {
    await fs.emptyDir(targetDir);
  }

  const repoInfo = parseGitHubUrl(url);
  if (!repoInfo) {
    throw new Error('无效的 GitHub 仓库 URL');
  }

  console.log(`[GitHub] Downloading ${repoInfo.owner}/${repoInfo.repo} (branch: ${branch}) to ${targetDir}`);

  // 方法1: 使用 GitHub zip API 下载
  try {
    await downloadAndExtractZip(repoInfo.owner, repoInfo.repo, branch, targetDir, onProgress);
    console.log(`[GitHub] Download completed: ${targetDir}`);
    return;
  } catch (zipError: any) {
    console.warn(`[GitHub] Zip download failed, trying git clone:`, zipError.message);
  }

  // 方法2: 回退到 git 命令
  try {
    onProgress?.('Cloning', 10);
    const gitUrl = normalizeGitHubUrl(url);
    const command = `git clone --depth 1 --single-branch --branch ${branch} "${gitUrl}" "${targetDir}"`;
    console.log(`[GitHub] Running: ${command}`);
    
    await execAsync(command, {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
    
    onProgress?.('Cloning', 100);
    console.log(`[GitHub] Clone completed: ${targetDir}`);
  } catch (gitError: any) {
    console.error(`[GitHub] Git clone also failed:`, gitError);
    throw new Error(`克隆仓库失败: ${gitError.stderr || gitError.message}`);
  }
}

/**
 * 使用 GitHub API 下载 zip 并解压
 */
async function downloadAndExtractZip(
  owner: string,
  repo: string,
  branch: string,
  targetDir: string,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> {
  const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
  console.log(`[GitHub] Downloading zip from: ${zipUrl}`);
  
  onProgress?.('Downloading', 10);

  const response = await fetch(zipUrl, {
    headers: {
      'User-Agent': 'RAG-App/1.0',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`);
  }

  onProgress?.('Downloading', 50);

  // 创建临时目录用于解压
  const tempDir = path.join(targetDir, '../', `temp_${Date.now()}`);
  await fs.ensureDir(tempDir);

  try {
    // 将响应流写入临时 zip 文件
    const zipPath = path.join(tempDir, 'repo.zip');
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(zipPath, Buffer.from(arrayBuffer));
    
    onProgress?.('Extracting', 70);

    // 使用 adm-zip 解压
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);

    onProgress?.('Extracting', 90);

    // GitHub zip 会创建一个 repo-branch 目录，需要移动内容
    const extractedDirs = await fs.readdir(tempDir);
    const repoDir = extractedDirs.find(d => d.startsWith(`${repo}-`) && d !== 'repo.zip');
    
    if (repoDir) {
      const sourcePath = path.join(tempDir, repoDir);
      // 移动所有内容到目标目录
      const items = await fs.readdir(sourcePath);
      for (const item of items) {
        await fs.move(path.join(sourcePath, item), path.join(targetDir, item), { overwrite: true });
      }
    }

    onProgress?.('Complete', 100);
  } finally {
    // 清理临时目录
    await fs.remove(tempDir);
  }
}

/**
 * 规范化 GitHub URL
 */
function normalizeGitHubUrl(url: string): string {
  // 移除末尾的斜杠
  url = url.replace(/\/$/, '');
  
  // 如果没有 .git 后缀，添加它
  if (!url.endsWith('.git')) {
    url = url + '.git';
  }
  
  // 确保使用 https
  if (url.startsWith('git@github.com:')) {
    url = url.replace('git@github.com:', 'https://github.com/');
  }
  
  return url;
}

/**
 * 遍历目录获取所有代码文件
 * @param dir 目录路径
 * @param baseDir 基础目录（用于计算相对路径）
 */
export async function walkCodeFiles(
  dir: string,
  baseDir?: string
): Promise<CodeFileInfo[]> {
  const files: CodeFileInfo[] = [];
  const base = baseDir || dir;
  
  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(base, fullPath);
      
      // 检查是否应该忽略
      if (shouldIgnore(entry.name, relativePath)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const language = CODE_EXTENSIONS[ext];
        
        if (language) {
          const stat = await fs.stat(fullPath);
          files.push({
            path: fullPath,
            relativePath,
            language,
            size: stat.size,
          });
        }
      }
    }
  }
  
  await walk(dir);
  
  // 按路径排序
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  
  console.log(`[GitHub] Found ${files.length} code files in ${dir}`);
  return files;
}

/**
 * 检查是否应该忽略该文件/目录
 */
function shouldIgnore(name: string, relativePath: string): boolean {
  // 检查名称是否在忽略列表中
  if (IGNORE_PATTERNS.includes(name)) {
    return true;
  }
  
  // 检查相对路径是否包含忽略的目录
  for (const pattern of IGNORE_PATTERNS) {
    if (relativePath.includes(`/${pattern}/`) || relativePath.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  
  // 忽略隐藏文件（以 . 开头，但保留 .md 等）
  if (name.startsWith('.') && !name.match(/^\.[a-z]+$/)) {
    return true;
  }
  
  return false;
}

/**
 * 读取代码文件内容
 */
export async function readCodeFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    console.error(`[GitHub] Failed to read file ${filePath}:`, error);
    return '';
  }
}

/**
 * 获取仓库信息（从 URL 解析）
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    // 支持多种 URL 格式
    // https://github.com/owner/repo
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    
    const cleanUrl = url.replace(/\.git$/, '').replace(/\/$/, '');
    
    if (cleanUrl.includes('github.com')) {
      const parts = cleanUrl.split('/');
      const repoIndex = parts.findIndex(p => p.includes('github.com'));
      if (repoIndex !== -1 && parts.length >= repoIndex + 3) {
        return {
          owner: parts[repoIndex + 1],
          repo: parts[repoIndex + 2],
        };
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

