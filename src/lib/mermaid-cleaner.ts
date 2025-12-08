/**
 * Mermaid 语法清洗和校验模块
 * 支持多种 Mermaid 图表类型的清洗和验证
 */

// 支持的图表类型及其声明关键字
const CHART_TYPES: Record<string, string[]> = {
  flowchart: ['flowchart'],
  sequence: ['sequenceDiagram'],
  er: ['erDiagram'],
  gantt: ['gantt'],
  mindmap: ['mindmap'],
  state: ['stateDiagram-v2', 'stateDiagram'],
};

export interface CleanResult {
  success: boolean;
  data?: string;
  error?: string;
  logs: string[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface StandaloneLine {
  original: string;
  trimmed: string;
}

/**
 * 检测 Mermaid 图表类型
 */
function detectChartType(mermaid: string): string | null {
  const firstLine = mermaid.trim().split('\n')[0].trim();
  
  for (const [type, keywords] of Object.entries(CHART_TYPES)) {
    if (keywords.some(keyword => firstLine.startsWith(keyword))) {
      return type;
    }
  }
  
  return null;
}

/**
 * 清洗和修复 Mermaid 语法（支持多种图表类型）
 */
export function cleanMermaidSyntax(rawMermaid: string): CleanResult {
  const logs: string[] = [];
  
  try {
    if (!rawMermaid || typeof rawMermaid !== 'string') {
      return {
        success: false,
        error: 'Mermaid 语法必须是非空字符串',
        logs
      };
    }

    let cleaned = rawMermaid.trim();
    logs.push('原始长度: ' + cleaned.length);

    // 步骤 1: 移除 markdown 代码块标记
    const beforeMarkdown = cleaned;
    cleaned = cleaned
      .replace(/^```mermaid\s*/gm, '')
      .replace(/```\s*$/gm, '')
      .trim();
    
    if (beforeMarkdown !== cleaned) {
      logs.push('✓ 已移除 markdown 代码块标记');
    }

    // 步骤 2: 移除多余的空白行（保留单个换行）
    cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

    // 步骤 2.5: 移除节点文本中的 \n 换行符（转换器不支持）
    cleaned = cleaned.replace(/\\n/g, ' ');
    logs.push('✓ 已移除节点文本中的换行符（\\n）');

    // 步骤 3: 检测图表类型
    const chartType = detectChartType(cleaned);
    
    if (!chartType) {
      // 如果没有检测到图表类型，尝试添加 flowchart 开头（兼容旧逻辑）
      logs.push('⚠ 未检测到图表类型，假设为 flowchart');
      
      const lines = cleaned.split('\n');
      const firstLine = lines[0].trim();
      
      // 步骤 3.1: 修复第一行如果第一个节点缺少 ID
      const startsWithBracket = /^[\[\(\{]/.test(firstLine);
      
      if (startsWithBracket) {
        logs.push(`⚠ 第一个节点缺少 ID: "${firstLine}"，添加默认 ID`);
        
        // 给第一个节点添加 ID：Start
        cleaned = `Start${cleaned}`;
        logs.push('✓ 已添加默认节点 ID: Start');
      }
      
      // 步骤 3.2: 添加开头（确保换行）
      cleaned = `flowchart TD\n  ${cleaned}`;
      logs.push('✓ 已添加 flowchart TD 开头');
    } else {
      logs.push(`✓ 检测到图表类型: ${chartType}`);
    }

    // 步骤 4: 针对 flowchart 类型进行特殊清洗
    if (chartType === 'flowchart') {
      cleaned = removeOrphanedNodeDefinitions(cleaned, logs);
    }

    // 步骤 5: 验证基本语法
    const validation = validateMermaidSyntax(cleaned, chartType);
    if (!validation.valid) {
      logs.push('✗ 语法验证失败: ' + validation.errors.join(', '));
      return {
        success: false,
        error: '语法验证失败: ' + validation.errors.join('; '),
        logs
      };
    }

    logs.push('✓ 清洗完成，最终长度: ' + cleaned.length);
    
    return {
      success: true,
      data: cleaned,
      logs
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logs.push('✗ 清洗过程出错: ' + errorMessage);
    return {
      success: false,
      error: errorMessage,
      logs
    };
  }
}

/**
 * 移除游离的节点定义
 */
function removeOrphanedNodeDefinitions(mermaid: string, logs: string[]): string {
  const lines = mermaid.split('\n');
  const firstLine = lines[0];
  const contentLines = lines.slice(1);
  
  // 找出所有参与连接的节点（通过箭头连接的行）
  const connectedNodes = new Set<string>();
  const connectionLines: string[] = [];
  const standaloneLines: StandaloneLine[] = [];
  
  contentLines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    // 检查是否是连接行（包含箭头）
    if (trimmed.includes('-->') || trimmed.includes('-.->') || trimmed.includes('---')) {
      connectionLines.push(line);
      
      // 提取参与连接的所有节点ID
      const nodeIdPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*[\[\{\(\|]/g;
      let match;
      while ((match = nodeIdPattern.exec(trimmed)) !== null) {
        connectedNodes.add(match[1]);
      }
      
      // 也要匹配箭头前后的纯ID
      const parts = trimmed.split(/-->|---|-\.->|\|/);
      parts.forEach(part => {
        const id = part.trim().split(/[\[\{\(\s]/)[0];
        if (id && /^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
          connectedNodes.add(id);
        }
      });
    } else {
      standaloneLines.push({ original: line, trimmed });
    }
  });
  
  // 过滤掉游离的节点定义
  let removedCount = 0;
  const validStandaloneLines = standaloneLines.filter(({ original, trimmed }) => {
    const nodeDefMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[\[\{\(\|]/);
    if (nodeDefMatch) {
      const nodeId = nodeDefMatch[1];
      if (!connectedNodes.has(nodeId)) {
        logs.push(`⚠ 移除游离节点定义: ${trimmed}`);
        removedCount++;
        return false;
      }
    }
    return true;
  });
  
  if (removedCount > 0) {
    logs.push(`✓ 已移除 ${removedCount} 个游离节点定义`);
  }
  
  // 重新组合
  const result = [
    firstLine,
    ...connectionLines,
    ...validStandaloneLines.map(l => l.original)
  ].join('\n');
  
  return result;
}

/**
 * 验证 Mermaid 基本语法（支持多种图表类型）
 */
function validateMermaidSyntax(mermaid: string, chartType: string | null): ValidationResult {
  const errors: string[] = [];
  const lines = mermaid.split('\n').map(l => l.trim()).filter(l => l);

  if (lines.length === 0) {
    errors.push('图表内容为空');
    return { valid: false, errors };
  }

  const firstLine = lines[0];

  // 根据图表类型进行不同的验证
  switch (chartType) {
    case 'flowchart':
      return validateFlowchart(lines, errors);
    
    case 'sequence':
      if (!firstLine.startsWith('sequenceDiagram')) {
        errors.push('时序图必须以 sequenceDiagram 开头');
      }
      if (lines.length < 2) {
        errors.push('时序图内容为空');
      }
      break;
    
    case 'er':
      if (!firstLine.startsWith('erDiagram')) {
        errors.push('ER图必须以 erDiagram 开头');
      }
      if (lines.length < 2) {
        errors.push('ER图内容为空');
      }
      break;
    
    case 'gantt':
      if (!firstLine.startsWith('gantt')) {
        errors.push('甘特图必须以 gantt 开头');
      }
      // 检查是否有 title 和 dateFormat
      const hasTitle = lines.some(l => l.startsWith('title'));
      const hasDateFormat = lines.some(l => l.startsWith('dateFormat'));
      if (!hasTitle) {
        errors.push('甘特图缺少 title 声明');
      }
      if (!hasDateFormat) {
        errors.push('甘特图缺少 dateFormat 声明');
      }
      break;
    
    case 'mindmap':
      if (!firstLine.startsWith('mindmap')) {
        errors.push('思维导图必须以 mindmap 开头');
      }
      // 检查是否有 root 节点
      const hasRoot = lines.some(l => l.includes('root((') || l.includes('root('));
      if (!hasRoot && lines.length < 3) {
        errors.push('思维导图缺少根节点');
      }
      break;
    
    case 'state':
      if (!firstLine.startsWith('stateDiagram')) {
        errors.push('状态图必须以 stateDiagram-v2 或 stateDiagram 开头');
      }
      if (lines.length < 2) {
        errors.push('状态图内容为空');
      }
      break;
    
    default:
      // 未知类型，只做最基本的验证
      if (lines.length < 2) {
        errors.push('图表内容过少');
      }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 验证流程图语法
 */
function validateFlowchart(lines: string[], errors: string[]): ValidationResult {
  const firstLine = lines[0];
  
  // 规则 1: 必须以 flowchart 开头
  if (!firstLine.startsWith('flowchart')) {
    errors.push('第一行必须是 flowchart TD 或 flowchart LR');
  }

  // 规则 2: 第一行后面必须是 TD、LR、TB、RL、BT 之一
  const direction = firstLine.replace('flowchart', '').trim();
  if (!['TD', 'LR', 'TB', 'RL', 'BT', ''].includes(direction)) {
    errors.push(`不支持的流程图方向: ${direction}`);
  }

  // 规则 3: 必须至少有一个节点或连接
  if (lines.length < 2) {
    errors.push('流程图内容为空，至少需要一个节点');
  }

  // 规则 4: 检查是否有基本的连接语法
  const hasConnections = lines.slice(1).some(line => 
    line.includes('-->') || line.includes('-.->') || line.includes('---')
  );
  
  if (!hasConnections && lines.length > 1) {
    errors.push('未检测到节点连接（-->），可能不是有效的流程图');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 格式化 Mermaid 语法（用于展示）
 */
export function formatMermaidSyntax(mermaid: string): string {
  const lines = mermaid.split('\n');
  const formatted: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    if (i === 0) {
      // 第一行不缩进
      formatted.push(line);
    } else {
      // 其他行缩进 2 空格
      formatted.push('  ' + line);
    }
  }
  
  return formatted.join('\n');
}

