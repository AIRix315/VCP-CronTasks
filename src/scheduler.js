/**
 * 核心调度引擎
 * 管理 Cron 和 Heartbeat 任务的调度
 */
const schedule = require('node-schedule');

class TaskScheduler {
    constructor(options) {
        this.taskQueue = options.taskQueue;
        this.taskStore = options.taskStore;
        this.knowledgeBaseManager = options.knowledgeBaseManager;
        this.logDiaryName = options.logDiaryName || '任务日志';
        this.debugMode = options.debugMode || false;

        this.cronJobs = new Map(); // taskId -> node-schedule Job
        this.heartbeatTimers = new Map(); // taskId -> timer
        this.pausedTasks = new Set(); // taskId Set
    }

    /**
     * 添加 Cron 任务
     */
    addCronTask(task) {
        if (this.cronJobs.has(task.id)) {
            console.warn(`[TaskScheduler] Cron 任务 ${task.id} 已存在，跳过`);
            return;
        }

        if (this.pausedTasks.has(task.id)) {
            console.log(`[TaskScheduler] Cron 任务 ${task.id} 已暂停`);
            return;
        }

        try {
            const job = schedule.scheduleJob(task.cronExpression, async () => {
                await this._executeTask(task);
            });

            this.cronJobs.set(task.id, job);
            
            // 更新下次执行时间
            const nextRun = job.nextInvocation();
            this.taskStore.updateTask(task.id, { 
                nextRun: nextRun ? nextRun.toISOString() : null 
            });

            if (this.debugMode) {
                console.log(`[TaskScheduler] Cron 任务 ${task.id} 已调度: ${task.cronExpression}`);
            }
        } catch (error) {
            console.error(`[TaskScheduler] 添加 Cron 任务失败 ${task.id}:`, error);
        }
    }

    /**
     * 添加 Heartbeat 任务
     */
    addHeartbeatTask(task) {
        if (this.heartbeatTimers.has(task.id)) {
            console.warn(`[TaskScheduler] Heartbeat 任务 ${task.id} 已存在，跳过`);
            return;
        }

        if (this.pausedTasks.has(task.id)) {
            console.log(`[TaskScheduler] Heartbeat 任务 ${task.id} 已暂停`);
            return;
        }

        try {
            const timer = setInterval(async () => {
                // 检查条件
                if (task.condition) {
                    const shouldRun = await this._checkCondition(task.condition);
                    if (!shouldRun) {
                        if (this.debugMode) {
                            console.log(`[TaskScheduler] Heartbeat 任务 ${task.id} 条件不满足，跳过`);
                        }
                        return;
                    }
                }

                await this._executeTask(task);
            }, task.intervalMs);

            this.heartbeatTimers.set(task.id, timer);

            if (this.debugMode) {
                console.log(`[TaskScheduler] Heartbeat 任务 ${task.id} 已启动: ${task.intervalMs}ms`);
            }
        } catch (error) {
            console.error(`[TaskScheduler] 添加 Heartbeat 任务失败 ${task.id}:`, error);
        }
    }

    /**
     * 检查条件
     */
    async _checkCondition(condition) {
        try {
            if (condition.type === 'diary_query') {
                if (!this.knowledgeBaseManager) {
                    console.warn('[TaskScheduler] KnowledgeBaseManager 未初始化');
                    return true; // 无条件通过
                }

                const results = await this.knowledgeBaseManager.queryDiary(
                    condition.diaryName,
                    condition.query
                );
                
                return results && results.length > 0;
            }

            // 其他条件类型...
            return true;
        } catch (error) {
            console.error('[TaskScheduler] 条件检查失败:', error);
            return false;
        }
    }

    /**
     * 执行任务
     */
    async _executeTask(task) {
        if (this.debugMode) {
            console.log(`[TaskScheduler] 开始执行任务: ${task.name} (${task.id})`);
        }

        // 更新状态为运行中
        await this.taskStore.setTaskStatus(task.id, 'running');

        try {
            // 添加到队列执行
            const result = await this.taskQueue.enqueue(task);

            // 记录执行结果
            await this.taskStore.recordExecution(task.id, result);

            // 更新状态为空闲
            await this.taskStore.setTaskStatus(task.id, 'idle');

            // 记录到日记本
            if (task.diaryName) {
                await this._logToDiary(task, result);
            }

            if (this.debugMode) {
                console.log(`[TaskScheduler] 任务执行完成: ${task.name} (${task.id})`);
            }

            return result;
        } catch (error) {
            console.error(`[TaskScheduler] 任务执行失败 ${task.id}:`, error);
            
            // 记录失败
            await this.taskStore.recordExecution(task.id, {
                success: false,
                error: error.message
            });

            // 更新状态为错误
            await this.taskStore.setTaskStatus(task.id, 'error');

            throw error;
        }
    }

    /**
     * 记录到日记本
     */
    async _logToDiary(task, result) {
        try {
            if (!this.knowledgeBaseManager) {
                return;
            }

            const diaryName = task.diaryName || this.logDiaryName;
            const timestamp = new Date().toISOString();
            const fileName = `task_${task.id}_${Date.now()}.md`;

            let retryInfo = '';
            if (task.retryState && task.retryState.totalAttempts > 1) {
                retryInfo = `

## 重试信息
- **尝试次数**: ${task.retryState.totalAttempts}
- **成功重试**: 是
- **上次失败**: ${task.retryState.lastError || '无'}
`;
            }

            const content = `# 任务执行日志

**任务ID**: ${task.id}  
**任务名称**: ${task.name}  
**执行时间**: ${timestamp}  
**执行结果**: ${result.success ? '成功' : '失败'}${retryInfo}

## 执行详情

\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`

Tag: 任务日志, ${task.name}, ${result.success ? '成功' : '失败'}
`;

            await this.knowledgeBaseManager.addFile(fileName, content, diaryName);
        } catch (error) {
            console.error('[TaskScheduler] 记录到日记本失败:', error);
        }
    }

    /**
     * 暂停任务
     */
    pauseTask(taskId) {
        // 暂停 Cron 任务
        if (this.cronJobs.has(taskId)) {
            const job = this.cronJobs.get(taskId);
            job.cancel();
            this.cronJobs.delete(taskId);
        }

        // 暂停 Heartbeat 任务
        if (this.heartbeatTimers.has(taskId)) {
            const timer = this.heartbeatTimers.get(taskId);
            clearInterval(timer);
            this.heartbeatTimers.delete(taskId);
        }

        this.pausedTasks.add(taskId);
        this.taskStore.setTaskStatus(taskId, 'paused');

        if (this.debugMode) {
            console.log(`[TaskScheduler] 任务已暂停: ${taskId}`);
        }
    }

    /**
     * 恢复任务
     */
    resumeTask(taskId) {
        this.pausedTasks.delete(taskId);
        
        const task = this.taskStore.getTask(taskId);
        if (!task) {
            console.warn(`[TaskScheduler] 恢复任务失败，任务不存在: ${taskId}`);
            return;
        }

        if (task.type === 'cron') {
            this.addCronTask(task);
        } else if (task.type === 'heartbeat') {
            this.addHeartbeatTask(task);
        }

        this.taskStore.setTaskStatus(taskId, 'idle');

        if (this.debugMode) {
            console.log(`[TaskScheduler] 任务已恢复: ${taskId}`);
        }
    }

    /**
     * 删除任务
     */
    removeTask(taskId) {
        // 停止 Cron 任务
        if (this.cronJobs.has(taskId)) {
            const job = this.cronJobs.get(taskId);
            job.cancel();
            this.cronJobs.delete(taskId);
        }

        // 停止 Heartbeat 任务
        if (this.heartbeatTimers.has(taskId)) {
            const timer = this.heartbeatTimers.get(taskId);
            clearInterval(timer);
            this.heartbeatTimers.delete(taskId);
        }

        this.pausedTasks.delete(taskId);

        if (this.debugMode) {
            console.log(`[TaskScheduler] 任务已移除: ${taskId}`);
        }
    }

    /**
     * 立即执行单个任务
     */
    async runTaskNow(taskId) {
        const task = this.taskStore.getTask(taskId);
        if (!task) {
            throw new Error(`任务不存在: ${taskId}`);
        }

        return await this._executeTask(task);
    }

    /**
     * 获取运行中的任务数
     */
    getRunningCount() {
        return this.taskQueue.getRunningCount();
    }

    /**
     * 获取调度统计
     */
    getStats() {
        return {
            cronTasks: this.cronJobs.size,
            heartbeatTasks: this.heartbeatTimers.size,
            pausedTasks: this.pausedTasks.size,
            runningTasks: this.getRunningCount(),
            queuedTasks: this.taskQueue.getQueueCount()
        };
    }

    /**
     * 关闭调度器
     */
    async shutdown() {
        // 取消所有 Cron 任务
        for (const [taskId, job] of this.cronJobs.entries()) {
            job.cancel();
        }
        this.cronJobs.clear();

        // 清除所有 Heartbeat 定时器
        for (const [taskId, timer] of this.heartbeatTimers.entries()) {
            clearInterval(timer);
        }
        this.heartbeatTimers.clear();

        this.pausedTasks.clear();

        if (this.debugMode) {
            console.log('[TaskScheduler] 已关闭');
        }
    }
}

module.exports = TaskScheduler;
