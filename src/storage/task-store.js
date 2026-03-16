/**
 * 任务存储模块
 * 复用 VCPToolBox 的 VCPTimedContacts 文件监控模式
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class TaskStore {
    constructor(storagePath) {
        this.storagePath = storagePath;
        this.cronDir = path.join(storagePath, 'cron');
        this.heartbeatDir = path.join(storagePath, 'heartbeat');
        this.tasks = new Map(); // taskId -> taskConfig
        this.watcher = null;
        this.onTaskAdded = null; // 回调函数
        this.onTaskRemoved = null; // 回调函数
    }

    /**
     * 初始化存储
     */
    async initialize() {
        // 创建存储目录
        await fs.mkdir(this.cronDir, { recursive: true });
        await fs.mkdir(this.heartbeatDir, { recursive: true });
        
        // 加载所有现有任务
        await this._loadAllTasks();
        
        console.log(`[TaskStore] 已加载 ${this.tasks.size} 个任务`);
    }

    /**
     * 加载所有任务
     */
    async _loadAllTasks() {
        // 加载 Cron 任务
        try {
            const cronFiles = await fs.readdir(this.cronDir);
            for (const file of cronFiles) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(this.cronDir, file);
                    await this._loadTaskFromFile(filePath, 'cron');
                }
            }
        } catch (error) {
            console.error('[TaskStore] 加载 Cron 任务失败:', error);
        }

        // 加载 Heartbeat 任务
        try {
            const heartbeatFiles = await fs.readdir(this.heartbeatDir);
            for (const file of heartbeatFiles) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(this.heartbeatDir, file);
                    await this._loadTaskFromFile(filePath, 'heartbeat');
                }
            }
        } catch (error) {
            console.error('[TaskStore] 加载 Heartbeat 任务失败:', error);
        }
    }

    /**
     * 从文件加载单个任务
     */
    async _loadTaskFromFile(filePath, type) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const task = JSON.parse(content);
            
            // 验证任务格式
            if (!task.id) {
                console.warn(`[TaskStore] 任务文件缺少 ID: ${filePath}`);
                return;
            }

            // 确保类型一致
            task.type = type;
            
            this.tasks.set(task.id, task);
        } catch (error) {
            console.error(`[TaskStore] 加载任务文件失败 ${filePath}:`, error);
        }
    }

    /**
     * 保存任务
     */
    async saveTask(task) {
        if (!task.id) {
            task.id = uuidv4();
        }

        const dir = task.type === 'cron' ? this.cronDir : this.heartbeatDir;
        const filePath = path.join(dir, `${task.id}.json`);

        try {
            await fs.writeFile(filePath, JSON.stringify(task, null, 2), 'utf-8');
            this.tasks.set(task.id, task);
            
            if (this.onTaskAdded) {
                this.onTaskAdded(task);
            }
            
            return task;
        } catch (error) {
            console.error(`[TaskStore] 保存任务失败 ${task.id}:`, error);
            throw error;
        }
    }

    /**
     * 删除任务
     */
    async deleteTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return false;
        }

        const dir = task.type === 'cron' ? this.cronDir : this.heartbeatDir;
        const filePath = path.join(dir, `${taskId}.json`);

        try {
            await fs.unlink(filePath);
            this.tasks.delete(taskId);
            
            if (this.onTaskRemoved) {
                this.onTaskRemoved(taskId);
            }
            
            return true;
        } catch (error) {
            console.error(`[TaskStore] 删除任务失败 ${taskId}:`, error);
            return false;
        }
    }

    /**
     * 获取任务
     */
    getTask(taskId) {
        return this.tasks.get(taskId);
    }

    /**
     * 获取所有任务
     */
    getAllTasks() {
        return Array.from(this.tasks.values());
    }

    /**
     * 获取特定类型的任务
     */
    getTasksByType(type) {
        return this.getAllTasks().filter(task => task.type === type);
    }

    /**
     * 更新任务
     */
    async updateTask(taskId, updates) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`任务不存在: ${taskId}`);
        }

        const updatedTask = { ...task, ...updates, id: taskId };
        return await this.saveTask(updatedTask);
    }

    /**
     * 设置任务状态
     */
    async setTaskStatus(taskId, status) {
        return await this.updateTask(taskId, { 
            status, 
            statusUpdatedAt: new Date().toISOString() 
        });
    }

    /**
     * 记录任务执行
     */
    async recordExecution(taskId, executionResult) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return;
        }

        const execution = {
            timestamp: new Date().toISOString(),
            success: executionResult.success,
            result: executionResult.result,
            error: executionResult.error
        };

        if (!task.executions) {
            task.executions = [];
        }
        task.executions.push(execution);
        task.lastRun = execution.timestamp;
        task.runCount = (task.runCount || 0) + 1;

        // 只保留最近 10 次执行记录
        if (task.executions.length > 10) {
            task.executions = task.executions.slice(-10);
        }

        await this.saveTask(task);
    }

    /**
     * 关闭存储
     */
    async shutdown() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
}

module.exports = TaskStore;
