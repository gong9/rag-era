/**
 * 任务状态管理模块
 * 追踪当前会话的任务进度和上下文
 */

import type { TaskState } from './types';

/**
 * 任务状态存储（内存缓存）
 */
const taskStateCache = new Map<string, TaskState>();

/**
 * 获取任务状态
 */
export function getTaskState(sessionId: string): TaskState | null {
  return taskStateCache.get(sessionId) || null;
}

/**
 * 创建新的任务状态
 */
export function createTaskState(sessionId: string): TaskState {
  const state: TaskState = {
    sessionId,
    currentTask: null,
    subTasks: [],
    context: {},
    lastUpdated: new Date(),
  };
  taskStateCache.set(sessionId, state);
  return state;
}

/**
 * 更新当前任务
 */
export function setCurrentTask(sessionId: string, task: string): TaskState {
  let state = taskStateCache.get(sessionId);
  if (!state) {
    state = createTaskState(sessionId);
  }
  state.currentTask = task;
  state.lastUpdated = new Date();
  return state;
}

/**
 * 添加子任务
 */
export function addSubTask(
  sessionId: string, 
  description: string
): TaskState {
  let state = taskStateCache.get(sessionId);
  if (!state) {
    state = createTaskState(sessionId);
  }
  
  state.subTasks.push({
    id: `task_${Date.now()}`,
    description,
    status: 'pending',
  });
  state.lastUpdated = new Date();
  return state;
}

/**
 * 更新子任务状态
 */
export function updateSubTaskStatus(
  sessionId: string,
  taskId: string,
  status: 'pending' | 'in_progress' | 'completed'
): TaskState | null {
  const state = taskStateCache.get(sessionId);
  if (!state) return null;
  
  const task = state.subTasks.find(t => t.id === taskId);
  if (task) {
    task.status = status;
    state.lastUpdated = new Date();
  }
  return state;
}

/**
 * 设置任务上下文
 */
export function setTaskContext(
  sessionId: string,
  key: string,
  value: any
): TaskState {
  let state = taskStateCache.get(sessionId);
  if (!state) {
    state = createTaskState(sessionId);
  }
  state.context[key] = value;
  state.lastUpdated = new Date();
  return state;
}

/**
 * 清除任务状态
 */
export function clearTaskState(sessionId: string): void {
  taskStateCache.delete(sessionId);
}

/**
 * 格式化任务状态为上下文字符串
 */
export function formatTaskStateAsContext(state: TaskState | null): string {
  if (!state || (!state.currentTask && state.subTasks.length === 0)) {
    return '';
  }
  
  const lines: string[] = ['## 当前任务状态'];
  
  if (state.currentTask) {
    lines.push(`当前任务: ${state.currentTask}`);
  }
  
  if (state.subTasks.length > 0) {
    lines.push('子任务:');
    state.subTasks.forEach((task, i) => {
      const statusIcon = task.status === 'completed' ? '✅' : 
                        task.status === 'in_progress' ? '🔄' : '⏳';
      lines.push(`  ${i + 1}. ${statusIcon} ${task.description}`);
    });
  }
  
  if (Object.keys(state.context).length > 0) {
    lines.push('上下文:');
    Object.entries(state.context).forEach(([key, value]) => {
      lines.push(`  - ${key}: ${JSON.stringify(value)}`);
    });
  }
  
  return lines.join('\n');
}

/**
 * 从对话中自动检测任务
 * 简单的规则匹配，可以扩展为 LLM 检测
 */
export function detectTaskFromQuery(query: string): {
  hasTask: boolean;
  taskDescription: string | null;
} {
  // 任务关键词
  const taskKeywords = [
    '帮我', '请帮', '我想', '我要', '需要', '麻烦',
    '分析', '总结', '整理', '对比', '列出', '找出',
  ];
  
  const hasTask = taskKeywords.some(k => query.includes(k));
  
  if (hasTask) {
    // 提取任务描述（简单截取）
    const taskDescription = query.length > 50 
      ? query.substring(0, 50) + '...'
      : query;
    return { hasTask: true, taskDescription };
  }
  
  return { hasTask: false, taskDescription: null };
}

/**
 * 清理过期的任务状态（超过 1 小时）
 */
export function cleanupExpiredStates(): number {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  let cleaned = 0;
  
  taskStateCache.forEach((state, sessionId) => {
    if (now - state.lastUpdated.getTime() > oneHour) {
      taskStateCache.delete(sessionId);
      cleaned++;
    }
  });
  
  return cleaned;
}

