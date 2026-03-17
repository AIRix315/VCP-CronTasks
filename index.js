/**
 * CronTaskOrchestrator 插件主入口
 * Hybridservice 类型插件：支持工具调用 + API 路由 + 占位符
 */
const TaskScheduler = require('./src/scheduler');
const TaskQueue = require('./src/task-queue');
const TaskStore = require('./src/storage/task-store');
const { PluginExecutor, AgentExecutor, HttpExecutor } = require('./src/executors');
const registerRoutes = require('./src/api/routes');

// 全局状态
let config = {};
let scheduler = null;
let taskStore = null;
let pluginManager = null;
let knowledgeBaseManager = null;
let debugMode = false;

/**
 * 更新占位符值
 */
function updatePlaceholder() {
    if (!pluginManager) return;

    try {
        const tasks = taskStore ? taskStore.getAllTasks() : [];
        const cronCount = tasks.filter(t => t.type === 'cron').length;
        const heartbeatCount = tasks.filter(t => t.type === 'heartbeat').length;
        const runningCount = scheduler ? scheduler.getRunningCount() : 0;

        const limitStatus = taskStore ? taskStore.getLimitStatus() : null;
        const globalUsage = limitStatus ? 
            `${limitStatus.global.current}/${limitStatus.global.limit}` : 'N/A';

        const placeholderValue = `Cron任务: ${cronCount}个, Heartbeat任务: ${heartbeatCount}个, 运行中: ${runningCount}个, 全局限额: ${globalUsage}`;
        
        pluginManager.staticPlaceholderValues.set('{{VCP_CRON_TASK_STATS}}', placeholderValue);

        if (debugMode) {
            console.log(`[CronTaskOrchestrator] 占位符已更新: ${placeholderValue}`);
        }
    } catch (error) {
        console.error('[CronTaskOrchestrator] 更新占位符失败:', error);
    }
}

/**
 * 初始化插件
 * @param {Object} initialConfig - 配置对象
 * @param {Object} dependencies - 依赖注入
 */
async function initialize(initialConfig, dependencies) {
    try {
        config = initialConfig;
        debugMode = config.DebugMode || false;

        console.log('[CronTaskOrchestrator] 正在初始化...');

        const PluginModule = require('../../Plugin.js');
        pluginManager = PluginModule;

        knowledgeBaseManager = dependencies?.vectorDBManager || global.knowledgeBaseManager;

        if (!knowledgeBaseManager) {
            console.warn('[CronTaskOrchestrator] KnowledgeBaseManager 未找到，日记功能将不可用');
        }

        const retryConfig = {
            enabled: config.CRON_TASK_RETRY_ENABLED !== 'false',
            maxRetries: parseInt(config.CRON_TASK_MAX_RETRIES, 10) || 3,
            backoffMs: (config.CRON_TASK_RETRY_BACKOFF_MS || '30000,60000,300000')
                .split(',')
                .map(s => parseInt(s.trim(), 10))
                .filter(n => !isNaN(n))
        };

        const limitConfig = {
            globalLimit: parseInt(config.CRON_TASK_GLOBAL_LIMIT, 10) || 100,
            perAgentLimit: parseInt(config.CRON_TASK_PER_AGENT_LIMIT, 10) || 20,
            action: config.CRON_TASK_LIMIT_ACTION || 'reject'
        };

        const storagePath = config.CRON_TASK_STORAGE_PATH || './Plugin/CronTaskOrchestrator/tasks';
        taskStore = new TaskStore(storagePath, limitConfig);
        await taskStore.initialize();

        const maxConcurrent = config.CRON_TASK_MAX_CONCURRENT || 10;
        const taskQueue = new TaskQueue(maxConcurrent, retryConfig);

        // 设置队列回调
        taskQueue.onTaskStarted = (task) => {
            if (debugMode) {
                console.log(`[CronTaskOrchestrator] 任务开始执行: ${task.name} (${task.id})`);
            }
        };

        taskQueue.onTaskCompleted = (task, result) => {
            if (debugMode) {
                console.log(`[CronTaskOrchestrator] 任务执行完成: ${task.name} (${task.id})`);
            }
            updatePlaceholder();
        };

        taskQueue.onTaskFailed = (task, error) => {
            console.error(`[CronTaskOrchestrator] 任务执行失败: ${task.name} (${task.id}):`, error);
            updatePlaceholder();
        };

        // 注册执行器
        taskQueue.registerExecutor('plugin', new PluginExecutor(pluginManager));
        
        const agentExecutor = new AgentExecutor(pluginManager);
        agentExecutor.initialize();
        taskQueue.registerExecutor('agent', agentExecutor);
        
        taskQueue.registerExecutor('http', new HttpExecutor());

        // 初始化调度器
        scheduler = new TaskScheduler({
            taskQueue,
            taskStore,
            knowledgeBaseManager,
            logDiaryName: config.CRON_TASK_LOG_DIARY || '任务日志',
            debugMode
        });

        // 加载所有已保存的任务
        const tasks = taskStore.getAllTasks();
        for (const task of tasks) {
            if (task.enabled && task.status !== 'paused') {
                if (task.type === 'cron') {
                    scheduler.addCronTask(task);
                } else if (task.type === 'heartbeat') {
                    scheduler.addHeartbeatTask(task);
                }
            }
        }

        // 设置初始占位符
        updatePlaceholder();

        console.log(`[CronTaskOrchestrator] 初始化完成，已加载 ${tasks.length} 个任务`);
    } catch (error) {
        console.error('[CronTaskOrchestrator] 初始化失败:', error);
        throw error;
    }
}

/**
 * 处理工具调用
 * @param {Object} args - 调用参数
 */
async function processToolCall(args) {
    try {
        const { command } = args;

        if (!command) {
            throw new Error('缺少 command 参数');
        }

        switch (command) {
            case 'CreateCronTask':
                return await createCronTask(args);
            case 'CreateHeartbeatTask':
                return await createHeartbeatTask(args);
            case 'ListTasks':
                return await listTasks();
            case 'PauseTask':
                return await pauseTask(args.taskId);
            case 'ResumeTask':
                return await resumeTask(args.taskId);
            case 'DeleteTask':
                return await deleteTask(args.taskId);
            case 'RunTaskNow':
                return await runTaskNow(args.taskId);
            default:
                throw new Error(`未知命令: ${command}`);
        }
    } catch (error) {
        console.error('[CronTaskOrchestrator] 工具调用失败:', error);
        return {
            status: 'error',
            error: error.message
        };
    }
}

/**
 * 创建 Cron 任务
 */
async function createCronTask(args) {
    const { name, cronExpression, executor, diaryName, condition } = args;

    if (!name || !cronExpression || !executor) {
        throw new Error('缺少必要参数：name, cronExpression, executor');
    }

    const task = {
        type: 'cron',
        name,
        cronExpression,
        executor,
        diaryName,
        condition,
        agentId: args.agentId || 'default',
        enabled: true,
        status: 'idle',
        createdAt: new Date().toISOString()
    };

    await taskStore.saveTask(task);
    scheduler.addCronTask(task);
    updatePlaceholder();

    return {
        status: 'success',
        result: {
            message: `Cron 任务 "${name}" 已创建`,
            taskId: task.id,
            task: task
        }
    };
}

/**
 * 创建 Heartbeat 任务
 */
async function createHeartbeatTask(args) {
    const { name, intervalMs, executor, diaryName, condition } = args;

    if (!name || !intervalMs || !executor) {
        throw new Error('缺少必要参数：name, intervalMs, executor');
    }

    const task = {
        type: 'heartbeat',
        name,
        intervalMs: parseInt(intervalMs, 10),
        executor,
        diaryName,
        condition,
        agentId: args.agentId || 'default',
        enabled: true,
        status: 'idle',
        createdAt: new Date().toISOString()
    };

    await taskStore.saveTask(task);
    scheduler.addHeartbeatTask(task);
    updatePlaceholder();

    return {
        status: 'success',
        result: {
            message: `Heartbeat 任务 "${name}" 已创建`,
            taskId: task.id,
            task: task
        }
    };
}

/**
 * 列出所有任务
 */
async function listTasks() {
    const tasks = taskStore.getAllTasks();
    const stats = scheduler.getStats();

    return {
        status: 'success',
        result: {
            tasks: tasks,
            stats: stats
        }
    };
}

/**
 * 暂停任务
 */
async function pauseTask(taskId) {
    if (!taskId) {
        throw new Error('缺少 taskId 参数');
    }

    const task = taskStore.getTask(taskId);
    if (!task) {
        throw new Error(`任务不存在: ${taskId}`);
    }

    scheduler.pauseTask(taskId);
    updatePlaceholder();

    return {
        status: 'success',
        result: {
            message: `任务 "${task.name}" 已暂停`,
            taskId: taskId
        }
    };
}

/**
 * 恢复任务
 */
async function resumeTask(taskId) {
    if (!taskId) {
        throw new Error('缺少 taskId 参数');
    }

    const task = taskStore.getTask(taskId);
    if (!task) {
        throw new Error(`任务不存在: ${taskId}`);
    }

    scheduler.resumeTask(taskId);
    updatePlaceholder();

    return {
        status: 'success',
        result: {
            message: `任务 "${task.name}" 已恢复`,
            taskId: taskId
        }
    };
}

/**
 * 删除任务
 */
async function deleteTask(taskId) {
    if (!taskId) {
        throw new Error('缺少 taskId 参数');
    }

    const task = taskStore.getTask(taskId);
    if (!task) {
        throw new Error(`任务不存在: ${taskId}`);
    }

    scheduler.removeTask(taskId);
    await taskStore.deleteTask(taskId);
    updatePlaceholder();

    return {
        status: 'success',
        result: {
            message: `任务 "${task.name}" 已删除`,
            taskId: taskId
        }
    };
}

/**
 * 立即执行任务
 */
async function runTaskNow(taskId) {
    if (!taskId) {
        throw new Error('缺少 taskId 参数');
    }

    const task = taskStore.getTask(taskId);
    if (!task) {
        throw new Error(`任务不存在: ${taskId}`);
    }

    const result = await scheduler.runTaskNow(taskId);

    return {
        status: 'success',
        result: {
            message: `任务 "${task.name}" 已执行`,
            taskId: taskId,
            execution: result
        }
    };
}

/**
 * 注册 API 路由
 * @param {Object} router - Express 路由
 * @param {Object} serverConfig - 服务器配置
 * @param {string} projectBasePath - 项目根路径
 */
function registerApiRoutes(router, serverConfig, projectBasePath) {
    registerRoutes(router, { scheduler, taskStore, updatePlaceholder });
}

/**
 * 关闭插件
 */
async function shutdown() {
    try {
        console.log('[CronTaskOrchestrator] 正在关闭...');

        if (scheduler) {
            await scheduler.shutdown();
        }

        if (taskStore) {
            await taskStore.shutdown();
        }

        console.log('[CronTaskOrchestrator] 已关闭');
    } catch (error) {
        console.error('[CronTaskOrchestrator] 关闭时出错:', error);
    }
}

// 导出插件接口
module.exports = {
    initialize,
    processToolCall,
    registerApiRoutes,
    shutdown
};
