/**
 * 仓库结构分析模块
 * 借鉴 DeepWiki 的结构索引思想，快速分析仓库结构，识别模块
 * 秒级完成，不调用 LLM
 */

import * as fs from 'fs-extra';
import * as path from 'path';

// ==================== 类型定义 ====================

export interface RepoStructure {
  type: 'monorepo' | 'single' | 'library';
  language: string;                    // 主要编程语言
  modules: ModuleInfo[];               // 识别到的模块列表
  entryPoints: string[];               // 入口文件列表
  readme?: string;                     // 根目录 README 内容
  skeleton: DirectoryNode;             // 目录骨架
}

export interface ModuleInfo {
  name: string;                        // 模块名: react-reconciler
  path: string;                        // 模块路径: packages/react-reconciler
  entryFile?: string;                  // 入口文件: src/index.ts
  description?: string;                // 从 package.json/README 提取的描述
  version?: string;                    // 版本号
  coreFiles: string[];                 // 核心实现文件列表
  dependencies: string[];              // 依赖的其他模块（内部依赖）
  readme?: string;                     // 模块自己的 README
}

export interface DirectoryNode {
  name: string;
  type: 'directory' | 'file';
  children?: DirectoryNode[];
  language?: string;                   // 文件语言类型
}

// ==================== 常量定义 ====================

// 常见的 monorepo packages 目录
const MONOREPO_PATTERNS = [
  'packages',
  'libs',
  'modules',
  'apps',
  'services',
  'plugins',
];

// 入口文件模式
const ENTRY_FILE_PATTERNS = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'main.ts',
  'main.tsx',
  'main.js',
  'main.jsx',
  'mod.ts',       // Deno
  'lib.rs',       // Rust
  '__init__.py',  // Python
  'main.py',
  'app.py',
  'main.go',      // Go
];

// 核心代码目录
const CORE_DIRS = ['src', 'lib', 'core', 'source'];

// 语言检测映射
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

// 忽略的目录（结构分析时跳过）
const IGNORE_DIRS = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.cache',
  'vendor',
  '.idea',
  '.vscode',
  'target',      // Rust/Java
];

// ==================== 主函数 ====================

/**
 * 分析仓库结构
 * @param repoDir 仓库目录
 * @param onProgress 进度回调
 */
export async function analyzeRepoStructure(
  repoDir: string,
  onProgress?: (message: string) => void
): Promise<RepoStructure> {
  onProgress?.('开始分析仓库结构...');

  // 1. 检测仓库类型和主要语言
  const { type, language, workspaces } = await detectRepoType(repoDir);
  onProgress?.(`识别仓库类型: ${type}, 主要语言: ${language}`);

  // 2. 读取根目录 README
  const readme = await readReadme(repoDir);

  // 3. 构建目录骨架（浅层，用于快速了解结构）
  const skeleton = await buildDirectorySkeleton(repoDir, 3);

  // 4. 识别模块
  let modules: ModuleInfo[] = [];
  
  if (type === 'monorepo') {
    modules = await analyzeMonorepoModules(repoDir, workspaces);
    onProgress?.(`识别到 ${modules.length} 个模块`);
  } else {
    // 单项目，整个项目作为一个模块
    const singleModule = await analyzeSingleModule(repoDir);
    if (singleModule) {
      modules = [singleModule];
    }
    onProgress?.('单项目模式，整个仓库作为一个模块');
  }

  // 5. 识别入口文件
  const entryPoints = await findEntryPoints(repoDir);
  onProgress?.(`找到 ${entryPoints.length} 个入口文件`);

  return {
    type,
    language,
    modules,
    entryPoints,
    readme,
    skeleton,
  };
}

// ==================== 检测函数 ====================

/**
 * 检测仓库类型
 */
async function detectRepoType(repoDir: string): Promise<{
  type: 'monorepo' | 'single' | 'library';
  language: string;
  workspaces: string[];
}> {
  let workspaces: string[] = [];

  // 检查 package.json 中的 workspaces 配置
  const packageJsonPath = path.join(repoDir, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    try {
      const packageJson = await fs.readJson(packageJsonPath);
      if (packageJson.workspaces) {
        // 支持数组或对象格式的 workspaces
        const ws = Array.isArray(packageJson.workspaces) 
          ? packageJson.workspaces 
          : packageJson.workspaces.packages || [];
        workspaces = ws;
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  // 检查 pnpm-workspace.yaml
  const pnpmWorkspacePath = path.join(repoDir, 'pnpm-workspace.yaml');
  if (await fs.pathExists(pnpmWorkspacePath)) {
    try {
      const content = await fs.readFile(pnpmWorkspacePath, 'utf-8');
      // 简单解析 YAML
      const match = content.match(/packages:\s*\n((?:\s*-\s*.+\n?)+)/);
      if (match) {
        const lines = match[1].split('\n');
        workspaces = lines
          .map(line => line.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
          .filter(line => line);
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  // 检查 lerna.json
  const lernaPath = path.join(repoDir, 'lerna.json');
  if (await fs.pathExists(lernaPath)) {
    try {
      const lernaConfig = await fs.readJson(lernaPath);
      if (lernaConfig.packages) {
        workspaces = lernaConfig.packages;
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  // 检查常见的 monorepo 目录
  for (const pattern of MONOREPO_PATTERNS) {
    const dirPath = path.join(repoDir, pattern);
    if (await fs.pathExists(dirPath)) {
      const stat = await fs.stat(dirPath);
      if (stat.isDirectory()) {
        // 检查目录下是否有子项目
        const subDirs = await fs.readdir(dirPath);
        const hasSubPackages = await Promise.all(
          subDirs.map(async (sub) => {
            const subPath = path.join(dirPath, sub);
            const subStat = await fs.stat(subPath);
            if (!subStat.isDirectory()) return false;
            // 检查是否有 package.json 或入口文件
            return await fs.pathExists(path.join(subPath, 'package.json')) ||
                   await fs.pathExists(path.join(subPath, 'src')) ||
                   await fs.pathExists(path.join(subPath, 'index.ts'));
          })
        );
        if (hasSubPackages.some(Boolean)) {
          if (!workspaces.length) {
            workspaces = [`${pattern}/*`];
          }
        }
      }
    }
  }

  // 检测主要语言
  const language = await detectMainLanguage(repoDir);

  // 判断类型
  let type: 'monorepo' | 'single' | 'library' = 'single';
  if (workspaces.length > 0) {
    type = 'monorepo';
  } else {
    // 检查是否是库项目（有 lib 或 dist 配置）
    const packageJsonPath = path.join(repoDir, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      if (packageJson.main || packageJson.module || packageJson.exports) {
        type = 'library';
      }
    }
  }

  return { type, language, workspaces };
}

/**
 * 检测主要编程语言
 */
async function detectMainLanguage(repoDir: string): Promise<string> {
  const languageCounts: Record<string, number> = {};

  async function countFiles(dir: string, depth: number = 0) {
    if (depth > 3) return; // 只检查前3层目录

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (IGNORE_DIRS.includes(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await countFiles(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const lang = LANGUAGE_EXTENSIONS[ext];
          if (lang) {
            languageCounts[lang] = (languageCounts[lang] || 0) + 1;
          }
        }
      }
    } catch (e) {
      // 忽略读取错误
    }
  }

  await countFiles(repoDir);

  // 返回文件数最多的语言
  let maxLang = 'unknown';
  let maxCount = 0;
  for (const [lang, count] of Object.entries(languageCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }

  return maxLang;
}

// ==================== 模块分析 ====================

/**
 * 分析 Monorepo 中的模块
 */
async function analyzeMonorepoModules(
  repoDir: string,
  workspaces: string[]
): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];

  // 展开 workspace 模式
  const moduleDirs = await expandWorkspaces(repoDir, workspaces);

  for (const moduleDir of moduleDirs) {
    const modulePath = path.relative(repoDir, moduleDir);
    const moduleInfo = await analyzeModuleDir(moduleDir, modulePath);
    if (moduleInfo) {
      modules.push(moduleInfo);
    }
  }

  // 按路径排序
  modules.sort((a, b) => a.path.localeCompare(b.path));

  return modules;
}

/**
 * 展开 workspace glob 模式
 */
async function expandWorkspaces(repoDir: string, patterns: string[]): Promise<string[]> {
  const dirs: string[] = [];

  for (const pattern of patterns) {
    // 处理 glob 模式 (packages/*)
    if (pattern.includes('*')) {
      const baseDir = pattern.replace(/\/?\*.*$/, '');
      const basePath = path.join(repoDir, baseDir);
      
      if (await fs.pathExists(basePath)) {
        const entries = await fs.readdir(basePath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            dirs.push(path.join(basePath, entry.name));
          }
        }
      }
    } else {
      // 直接路径
      const fullPath = path.join(repoDir, pattern);
      if (await fs.pathExists(fullPath)) {
        dirs.push(fullPath);
      }
    }
  }

  return dirs;
}

/**
 * 分析单个模块目录
 */
async function analyzeModuleDir(
  moduleDir: string,
  relativePath: string
): Promise<ModuleInfo | null> {
  const moduleName = path.basename(moduleDir);

  // 尝试读取 package.json
  let description: string | undefined;
  let version: string | undefined;
  let internalDeps: string[] = [];
  let entryFile: string | undefined;

  const packageJsonPath = path.join(moduleDir, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    try {
      const packageJson = await fs.readJson(packageJsonPath);
      description = packageJson.description;
      version = packageJson.version;
      
      // 识别入口文件
      entryFile = packageJson.main || packageJson.module;
      if (entryFile && !await fs.pathExists(path.join(moduleDir, entryFile))) {
        entryFile = undefined;
      }

      // 提取内部依赖（同一 monorepo 中的包）
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      };
      // 内部依赖通常以 @ 开头或者是 workspace: 协议
      internalDeps = Object.keys(deps || {}).filter(dep => 
        deps[dep]?.startsWith('workspace:') || 
        deps[dep]?.startsWith('file:') ||
        deps[dep] === '*'
      );
    } catch (e) {
      // 忽略解析错误
    }
  }

  // 如果没有找到入口文件，尝试常见模式
  if (!entryFile) {
    entryFile = await findModuleEntry(moduleDir);
  }

  // 查找核心文件
  const coreFiles = await findCoreFiles(moduleDir);

  // 读取模块 README
  const readme = await readReadme(moduleDir);
  if (readme && !description) {
    // 从 README 第一行提取描述
    const firstLine = readme.split('\n').find(line => 
      line.trim() && !line.startsWith('#') && !line.startsWith('!')
    );
    if (firstLine) {
      description = firstLine.trim().substring(0, 200);
    }
  }

  return {
    name: moduleName,
    path: relativePath,
    entryFile,
    description,
    version,
    coreFiles,
    dependencies: internalDeps,
    readme,
  };
}

/**
 * 分析单项目模块
 */
async function analyzeSingleModule(repoDir: string): Promise<ModuleInfo | null> {
  const moduleName = path.basename(repoDir);
  
  let description: string | undefined;
  let version: string | undefined;
  let entryFile: string | undefined;

  // 读取 package.json
  const packageJsonPath = path.join(repoDir, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    try {
      const packageJson = await fs.readJson(packageJsonPath);
      description = packageJson.description;
      version = packageJson.version;
      entryFile = packageJson.main || packageJson.module;
    } catch (e) {}
  }

  // 读取 pyproject.toml (Python)
  const pyprojectPath = path.join(repoDir, 'pyproject.toml');
  if (await fs.pathExists(pyprojectPath)) {
    try {
      const content = await fs.readFile(pyprojectPath, 'utf-8');
      const descMatch = content.match(/description\s*=\s*"([^"]+)"/);
      if (descMatch) description = descMatch[1];
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
      if (versionMatch) version = versionMatch[1];
    } catch (e) {}
  }

  if (!entryFile) {
    entryFile = await findModuleEntry(repoDir);
  }

  const coreFiles = await findCoreFiles(repoDir);
  const readme = await readReadme(repoDir);

  return {
    name: moduleName,
    path: '.',
    entryFile,
    description,
    version,
    coreFiles,
    dependencies: [],
    readme,
  };
}

/**
 * 查找模块入口文件
 */
async function findModuleEntry(moduleDir: string): Promise<string | undefined> {
  // 先检查 src 目录
  for (const coreDir of CORE_DIRS) {
    const srcDir = path.join(moduleDir, coreDir);
    if (await fs.pathExists(srcDir)) {
      for (const entryFile of ENTRY_FILE_PATTERNS) {
        const entryPath = path.join(srcDir, entryFile);
        if (await fs.pathExists(entryPath)) {
          return path.join(coreDir, entryFile);
        }
      }
    }
  }

  // 检查根目录
  for (const entryFile of ENTRY_FILE_PATTERNS) {
    const entryPath = path.join(moduleDir, entryFile);
    if (await fs.pathExists(entryPath)) {
      return entryFile;
    }
  }

  return undefined;
}

/**
 * 查找模块核心文件
 */
async function findCoreFiles(moduleDir: string, limit: number = 20): Promise<string[]> {
  const coreFiles: string[] = [];

  // 优先检查 src 目录
  for (const coreDir of CORE_DIRS) {
    const srcDir = path.join(moduleDir, coreDir);
    if (await fs.pathExists(srcDir)) {
      const files = await collectCodeFiles(srcDir, moduleDir, limit);
      coreFiles.push(...files);
      if (coreFiles.length >= limit) break;
    }
  }

  // 如果没找到，检查根目录
  if (coreFiles.length === 0) {
    const files = await collectCodeFiles(moduleDir, moduleDir, limit);
    coreFiles.push(...files);
  }

  return coreFiles.slice(0, limit);
}

/**
 * 收集代码文件
 */
async function collectCodeFiles(
  dir: string,
  baseDir: string,
  limit: number,
  depth: number = 0
): Promise<string[]> {
  if (depth > 3 || limit <= 0) return [];

  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        const subFiles = await collectCodeFiles(fullPath, baseDir, limit - files.length, depth + 1);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (LANGUAGE_EXTENSIONS[ext]) {
          files.push(relativePath);
        }
      }
    }
  } catch (e) {
    // 忽略读取错误
  }

  return files;
}

// ==================== 辅助函数 ====================

/**
 * 读取 README 文件
 */
async function readReadme(dir: string): Promise<string | undefined> {
  const readmeNames = ['README.md', 'readme.md', 'README', 'readme', 'README.txt'];
  
  for (const name of readmeNames) {
    const readmePath = path.join(dir, name);
    if (await fs.pathExists(readmePath)) {
      try {
        const content = await fs.readFile(readmePath, 'utf-8');
        // 限制长度，只取前 5000 字符
        return content.substring(0, 5000);
      } catch (e) {
        continue;
      }
    }
  }

  return undefined;
}

/**
 * 查找仓库入口文件
 */
async function findEntryPoints(repoDir: string): Promise<string[]> {
  const entryPoints: string[] = [];

  // 检查根目录
  for (const entryFile of ENTRY_FILE_PATTERNS) {
    const entryPath = path.join(repoDir, entryFile);
    if (await fs.pathExists(entryPath)) {
      entryPoints.push(entryFile);
    }
  }

  // 检查 src 目录
  for (const coreDir of CORE_DIRS) {
    const srcDir = path.join(repoDir, coreDir);
    if (await fs.pathExists(srcDir)) {
      for (const entryFile of ENTRY_FILE_PATTERNS) {
        const entryPath = path.join(srcDir, entryFile);
        if (await fs.pathExists(entryPath)) {
          entryPoints.push(path.join(coreDir, entryFile));
        }
      }
    }
  }

  return entryPoints;
}

/**
 * 构建目录骨架（用于快速了解结构）
 */
async function buildDirectorySkeleton(
  dir: string,
  maxDepth: number,
  currentDepth: number = 0
): Promise<DirectoryNode> {
  const name = path.basename(dir);
  const node: DirectoryNode = {
    name,
    type: 'directory',
    children: [],
  };

  if (currentDepth >= maxDepth) {
    return node;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const childNode = await buildDirectorySkeleton(fullPath, maxDepth, currentDepth + 1);
        node.children!.push(childNode);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = LANGUAGE_EXTENSIONS[ext];
        node.children!.push({
          name: entry.name,
          type: 'file',
          language: lang,
        });
      }
    }

    // 按名称排序，目录在前
    node.children!.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
  } catch (e) {
    // 忽略读取错误
  }

  return node;
}

/**
 * 获取模块统计信息
 */
export function getStructureStats(structure: RepoStructure): {
  moduleCount: number;
  totalCoreFiles: number;
  languages: string[];
} {
  const languages = new Set<string>();
  let totalCoreFiles = 0;

  for (const module of structure.modules) {
    totalCoreFiles += module.coreFiles.length;
    // 从核心文件推断语言
    for (const file of module.coreFiles) {
      const ext = path.extname(file).toLowerCase();
      const lang = LANGUAGE_EXTENSIONS[ext];
      if (lang) languages.add(lang);
    }
  }

  if (structure.language !== 'unknown') {
    languages.add(structure.language);
  }

  return {
    moduleCount: structure.modules.length,
    totalCoreFiles,
    languages: Array.from(languages),
  };
}

