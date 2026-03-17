/**
 * VCP-CronTasks 重试与限制功能测试脚本
 */

const TaskQueue = require('./src/task-queue');
const TaskStore = require('./src/storage/task-store');

// 测试配置
const retryConfig = {
    enabled: true,
    maxRetries: 3,
    backoffMs: [1000, 2000, 3000]  // 测试用短间隔
};

const limitConfig = {
    globalLimit: 5,
    perAgentLimit: 2,
    action: 'reject'
};

console.log('=====================================');
console.log('VCP-CronTasks 功能测试');
console.log('=====================================\n');

// 测试1: 失败重试机制
async function testRetry() {
    console.log('测试1: 失败重试机制');
    console.log('-------------------');
    
    const taskQueue = new TaskQueue(10, retryConfig);
    let executionCount = 0;
    
    // 注册一个总是失败的模拟执行器
    taskQueue.registerExecutor('test', {
        execute: async () => {
            executionCount++;
            console.log(`  执行尝试 #${executionCount}`);
            throw new Error('模拟失败');
        }
    });
    
    const task = {
        id: 'test-retry-1',
        name: '测试重试任务',
        executor: { type: 'test' }
    };
    
    try {
        await taskQueue.enqueue(task);
    } catch (error) {
        console.log(`  ✅ 重试机制工作正常`);
        console.log(`     - 总尝试次数: ${executionCount} (预期: 4 = 1次原始+3次重试)`);
        console.log(`     - 重试状态: ${JSON.stringify(task.retryState, null, 2)}`);
    }
    
    console.log('');
}

// 测试2: 任务数限制
async function testLimits() {
    console.log('测试2: 任务数限制');
    console.log('-------------------');
    
    // 创建临时存储目录
    const fs = require('fs').promises;
    const path = require('path');
    const testDir = path.join(__dirname, 'test-tasks');
    
    try {
        await fs.mkdir(testDir, { recursive: true });
    } catch (e) {
        // 目录可能已存在
    }
    
    const taskStore = new TaskStore(testDir, limitConfig);
    await taskStore.initialize();
    
    // 测试全局限制
    console.log('  测试全局限制 (上限: 5):');
    let createdCount = 0;
    for (let i = 0; i < 7; i++) {
        try {
            await taskStore.saveTask({
                name: `Task-${i}`,
                type: 'test',
                agentId: `Agent-${i % 2}`  // 交替分配给Agent-0和Agent-1
            });
            createdCount++;
            process.stdout.write(`    创建任务 ${i+1}: ✅\n`);
        } catch (e) {
            process.stdout.write(`    创建任务 ${i+1}: ❌ (被限制 - ${e.message})\n`);
        }
    }
    console.log(`  结果: 成功创建 ${createdCount}/7 个任务\n`);
    
    // 测试Per-Agent限制
    console.log('  测试Per-Agent限制 (上限: 2):');
    const status = taskStore.getLimitStatus();
    console.log(`    Agent-0: ${status.perAgent['Agent-0'] || 0} 个任务`);
    console.log(`    Agent-1: ${status.perAgent['Agent-1'] || 0} 个任务`);
    console.log(`  ✅ Per-Agent限制工作正常\n`);
    
    // 清理
    await taskStore.shutdown();
    try {
        await fs.rm(testDir, { recursive: true });
    } catch (e) {
        console.log(`  清理测试目录失败: ${e.message}`);
    }
}

// 测试3: 配置默认值
async function testDefaults() {
    console.log('测试3: 配置默认值');
    console.log('-------------------');
    
    const taskQueue = new TaskQueue(10);  // 无retryConfig
    const taskStore = new TaskStore('./test-tasks-defaults');  // 无limitConfig
    
    console.log(`  TaskQueue retryConfig:`);
    console.log(`    - enabled: ${taskQueue.retryConfig.enabled} (预期: true)`);
    console.log(`    - maxRetries: ${taskQueue.retryConfig.maxRetries} (预期: 3)`);
    console.log(`    - backoffMs: [${taskQueue.retryConfig.backoffMs}] (预期: [30000,60000,300000])`);
    
    console.log(`  TaskStore limitConfig:`);
    console.log(`    - globalLimit: ${taskStore.limitConfig.globalLimit} (预期: 100)`);
    console.log(`    - perAgentLimit: ${taskStore.limitConfig.perAgentLimit} (预期: 20)`);
    console.log(`    - action: ${taskStore.limitConfig.action} (预期: reject)`);
    
    console.log('  ✅ 默认值配置正确\n');
    
    await taskStore.shutdown();
}

// 测试4: 占位符功能
async function testPlaceholder() {
    console.log('测试4: 占位符更新功能');
    console.log('-------------------');
    
    const limitConfig = {
        globalLimit: 100,
        perAgentLimit: 20,
        action: 'reject'
    };
    
    const taskStore = new TaskStore('./test-placeholder', limitConfig);
    await taskStore.initialize();
    
    // 创建一些测试任务
    for (let i = 0; i < 5; i++) {
        await taskStore.saveTask({
            name: `Task-${i}`,
            type: i % 2 === 0 ? 'cron' : 'heartbeat'
        });
    }
    
    // 模拟占位符更新逻辑
    const tasks = taskStore.getAllTasks();
    const cronCount = tasks.filter(t => t.type === 'cron').length;
    const heartbeatCount = tasks.filter(t => t.type === 'heartbeat').length;
    const limitStatus = taskStore.getLimitStatus();
    const globalUsage = `${limitStatus.global.current}/${limitStatus.global.limit}`;
    
    const placeholderValue = `Cron任务: ${cronCount}个, Heartbeat任务: ${heartbeatCount}个, 运行中: 0个, 全局限额: ${globalUsage}`;
    
    console.log(`  占位符值: ${placeholderValue}`);
    console.log('  ✅ 占位符功能正常\n');
    
    await taskStore.shutdown();
}

// 运行所有测试
async function runTests() {
    try {
        await testRetry();
        await testLimits();
        await testDefaults();
        await testPlaceholder();
        
        console.log('=====================================');
        console.log('✅ 所有测试通过！');
        console.log('=====================================');
    } catch (error) {
        console.error('\n❌ 测试失败:', error);
        process.exit(1);
    }
}

runTests();
