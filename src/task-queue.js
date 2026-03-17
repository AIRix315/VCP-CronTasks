/**
 * 任务队列
 * 管理并发任务执行
 */
class TaskQueue {
    constructor(maxConcurrent = 10, retryConfig = {}) {
        this.maxConcurrent = maxConcurrent;
        this.running = new Map();
        this.queue = [];
        this.executors = new Map();
        this.onTaskStarted = null;
        this.onTaskCompleted = null;
        this.onTaskFailed = null;
        
        this.retryConfig = {
            enabled: retryConfig.enabled !== false,
            maxRetries: retryConfig.maxRetries || 3,
            backoffMs: retryConfig.backoffMs || [30000, 60000, 300000]
        };
    }

    /**
     * 注册执行器
     */
    registerExecutor(type, executor) {
        this.executors.set(type, executor);
    }

    /**
     * 添加任务到队列
     */
    async enqueue(task) {
        return new Promise((resolve, reject) => {
            const queueItem = {
                task,
                resolve,
                reject,
                enqueueTime: Date.now()
            };
            
            this.queue.push(queueItem);
            this._process();
        });
    }

    /**
     * 处理队列
     */
    async _process() {
        // 检查并发限制
        if (this.running.size >= this.maxConcurrent) {
            return;
        }

        // 检查队列
        if (this.queue.length === 0) {
            return;
        }

        // 取出下一个任务
        const queueItem = this.queue.shift();
        const { task, resolve, reject } = queueItem;

        // 添加到运行中
        this.running.set(task.id, {
            task,
            startTime: Date.now()
        });

        // 通知任务开始
        if (this.onTaskStarted) {
            this.onTaskStarted(task);
        }

        try {
            // 执行任务
            const result = await this._executeTask(task);
            
            // 通知任务完成
            if (this.onTaskCompleted) {
                this.onTaskCompleted(task, result);
            }
            
            resolve(result);
        } catch (error) {
            console.error(`[TaskQueue] 任务执行失败 ${task.id}:`, error);
            
            // 通知任务失败
            if (this.onTaskFailed) {
                this.onTaskFailed(task, error);
            }
            
            reject(error);
        } finally {
            // 从运行中移除
            this.running.delete(task.id);
            
            // 继续处理队列
            this._process();
        }
    }

    /**
     * 执行单个任务
     */
    async _executeTask(task) {
        if (!task.retryState) {
            task.retryState = {
                consecutiveErrors: 0,
                lastError: null,
                lastErrorAt: null,
                nextRetryAt: null,
                totalAttempts: 0,
                isDisabled: false
            };
        }
        
        if (task.retryState.isDisabled) {
            throw new Error(`任务 ${task.id} 已因连续失败被禁用`);
        }

        const maxAttempts = 1 + (this.retryConfig.enabled ? this.retryConfig.maxRetries : 0);
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                task.retryState.totalAttempts++;
                
                const result = await this._doExecute(task);
                
                task.retryState.consecutiveErrors = 0;
                task.retryState.lastError = null;
                task.retryState.nextRetryAt = null;
                
                return {
                    ...result,
                    attempts: attempt,
                    succeeded: true
                };
                
            } catch (error) {
                lastError = error;
                task.retryState.consecutiveErrors++;
                task.retryState.lastError = error.message;
                task.retryState.lastErrorAt = new Date().toISOString();
                
                if (attempt < maxAttempts) {
                    const backoffMs = this.retryConfig.backoffMs[attempt - 1] || 
                                     this.retryConfig.backoffMs[this.retryConfig.backoffMs.length - 1];
                    
                    console.warn(
                        `[TaskQueue] 任务 ${task.id} 第 ${attempt} 次执行失败，` +
                        `${backoffMs}ms 后重试: ${error.message}`
                    );
                    
                    await this._delay(backoffMs);
                }
            }
        }
        
        if (task.retryState.consecutiveErrors >= 5) {
            task.retryState.isDisabled = true;
            console.error(`[TaskQueue] 任务 ${task.id} 连续失败 ${task.retryState.consecutiveErrors} 次，已自动禁用`);
        }
        
        throw lastError;
    }

    async _doExecute(task) {
        const { executor: executorConfig } = task;
        
        if (!executorConfig) {
            throw new Error('任务缺少执行器配置');
        }

        const { type } = executorConfig;
        const executor = this.executors.get(type);
        
        if (!executor) {
            throw new Error(`未找到执行器类型: ${type}`);
        }

        const result = await executor.execute(executorConfig);
        
        return {
            taskId: task.id,
            taskName: task.name,
            executorType: type,
            executedAt: new Date().toISOString(),
            ...result
        };
    }
    
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getRunningCount() {
        return this.running.size;
    }

    /**
     * 获取队列中的任务数
     */
    getQueueCount() {
        return this.queue.length;
    }

    /**
     * 获取运行中的任务列表
     */
    getRunningTasks() {
        return Array.from(this.running.values()).map(item => ({
            id: item.task.id,
            name: item.task.name,
            startTime: item.startTime,
            runningDuration: Date.now() - item.startTime
        }));
    }

    /**
     * 清空队列
     */
    clearQueue() {
        // 拒绝所有等待中的任务
        while (this.queue.length > 0) {
            const { reject } = this.queue.shift();
            reject(new Error('队列被清空'));
        }
    }

    /**
     * 关闭队列
     */
    async shutdown() {
        this.clearQueue();
        
        // 等待所有运行中的任务完成（最多等待 30 秒）
        const startTime = Date.now();
        while (this.running.size > 0 && Date.now() - startTime < 30000) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 如果还有任务在运行，记录警告
        if (this.running.size > 0) {
            console.warn(`[TaskQueue] 关闭时仍有 ${this.running.size} 个任务在运行`);
        }
    }
}

module.exports = TaskQueue;
