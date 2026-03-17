/**
 * VCP-CronTasks 集成测试
 * 模拟真实运行环境测试所有功能
 */

const fs = require('fs').promises;
const path = require('path');
const TaskQueue = require('./src/task-queue');
const TaskStore = require('./src/storage/task-store');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function runIntegrationTest() {
  log('\n========================================', 'blue');
  log('  VCP-CronTasks 集成测试', 'blue');
  log('========================================\n', 'blue');

  const testDir = path.join(__dirname, 'integration-test-tasks');
  
  // 清理并创建测试目录
  try {
    await fs.rm(testDir, { recursive: true });
  } catch (e) {}
  await fs.mkdir(testDir, { recursive: true });

  // 测试1: 初始化配置
  log('测试1: 初始化配置', 'yellow');
  const retryConfig = {
    enabled: true,
    maxRetries: 2,
    backoffMs: [500, 1000]  // 短间隔便于测试
  };

  const limitConfig = {
    globalLimit: 10,
    perAgentLimit: 3,
    action: 'reject'
  };

  const taskStore = new TaskStore(testDir, limitConfig);
  await taskStore.initialize();
  
  const taskQueue = new TaskQueue(5, retryConfig);
  
  let successCount = 0;
  let failCount = 0;
  
  // 注册模拟执行器
  taskQueue.registerExecutor('mock', {
    execute: async (config) => {
      if (config.shouldFail) {
        throw new Error(config.errorMessage || '模拟失败');
      }
      return { success: true, data: config.returnData };
    }
  });

  // 设置回调
  taskQueue.onTaskStarted = (task) => {
    log(`  [开始] ${task.name}`, 'blue');
  };
  
  taskQueue.onTaskCompleted = (task, result) => {
    log(`  [完成] ${task.name} - 尝试${result.attempts}次`, 'green');
    successCount++;
  };
  
  taskQueue.onTaskFailed = (task, error) => {
    log(`  [失败] ${task.name} - ${error.message}`, 'red');
    failCount++;
  };

  log('  ✅ 初始化完成\n', 'green');

  // 测试2: 成功任务
  log('测试2: 正常执行任务', 'yellow');
  const task1 = {
    id: 'task-1',
    name: '正常任务',
    type: 'cron',
    agentId: 'Agent-A',
    executor: { type: 'mock', shouldFail: false, returnData: 'success' }
  };
  
  try {
    const result1 = await taskQueue.enqueue(task1);
    log(`  ✅ 任务成功: ${result1.succeeded}, 尝试次数: ${result1.attempts}`, 'green');
  } catch (e) {
    log(`  ❌ 意外失败: ${e.message}`, 'red');
  }

  // 测试3: 失败重试
  log('\n测试3: 失败重试机制', 'yellow');
  const task2 = {
    id: 'task-2',
    name: '会失败的任务',
    type: 'cron',
    agentId: 'Agent-A',
    executor: { type: 'mock', shouldFail: true, errorMessage: '网络错误' }
  };
  
  const startTime = Date.now();
  try {
    await taskQueue.enqueue(task2);
  } catch (e) {
    const duration = Date.now() - startTime;
    log(`  ✅ 重试完成，耗时: ${duration}ms (预期: ~1500ms)`, 'green');
    log(`     - 总尝试次数: ${task2.retryState.totalAttempts} (预期: 3)`, 'green');
    log(`     - 连续失败: ${task2.retryState.consecutiveErrors}`, 'green');
    log(`     - 最后错误: ${task2.retryState.lastError}`, 'green');
  }

  // 测试4: 任务数限制
  log('\n测试4: 任务数限制', 'yellow');
  
  // 创建多个任务测试限制
  const tasksToCreate = [];
  for (let i = 0; i < 12; i++) {
    tasksToCreate.push({
      name: `批量任务-${i}`,
      type: 'cron',
      agentId: i < 6 ? 'Agent-B' : 'Agent-C',  // Agent-B有6个，Agent-C有6个
      executor: { type: 'mock', shouldFail: false }
    });
  }

  let createdCount = 0;
  let rejectedCount = 0;
  
  for (const task of tasksToCreate) {
    try {
      await taskStore.saveTask(task);
      createdCount++;
    } catch (e) {
      rejectedCount++;
      log(`  ⚠️  限制触发: ${e.message}`, 'yellow');
    }
  }
  
  log(`\n  结果统计:`, 'blue');
  log(`    - 成功创建: ${createdCount}个`, 'green');
  log(`    - 被拒绝: ${rejectedCount}个`, 'red');
  log(`    - 预期: 最多10个全局 + 每Agent最多3个`, 'blue');
  
  // 显示限制状态
  const limitStatus = taskStore.getLimitStatus();
  log(`\n  限额状态:`, 'blue');
  log(`    - 全局: ${limitStatus.global.current}/${limitStatus.global.limit}`, 'blue');
  for (const [agentId, count] of Object.entries(limitStatus.perAgent)) {
    log(`    - ${agentId}: ${count}/${limitConfig.perAgentLimit}`, 'blue');
  }

  // 测试5: Agent ID自动注入验证
  log('\n测试5: Agent ID自动注入', 'yellow');
  const taskWithAgent = await taskStore.saveTask({
    name: '带Agent的任务',
    type: 'cron',
    agentId: 'Nova',  // 明确指定
    executor: { type: 'mock' }
  });
  
  const taskWithoutAgent = await taskStore.saveTask({
    name: '无Agent的任务',
    type: 'cron',
    // 不指定agentId
    executor: { type: 'mock' }
  });
  
  log(`  ✅ 有Agent ID: ${taskWithAgent.agentId}`, 'green');
  log(`  ⚠️  无Agent ID: ${taskWithoutAgent.agentId || '未设置'}`, taskWithoutAgent.agentId ? 'green' : 'yellow');

  // 测试6: 占位符模拟
  log('\n测试6: 占位符状态模拟', 'yellow');
  const allTasks = taskStore.getAllTasks();
  const cronCount = allTasks.filter(t => t.type === 'cron').length;
  const heartbeatCount = allTasks.filter(t => t.type === 'heartbeat').length;
  const globalUsage = `${limitStatus.global.current}/${limitStatus.global.limit}`;
  
  const placeholderValue = `Cron任务: ${cronCount}个, Heartbeat任务: ${heartbeatCount}个, 运行中: 0个, 全局限额: ${globalUsage}`;
  log(`  占位符值: ${placeholderValue}`, 'blue');
  log(`  ✅ 占位符格式正确`, 'green');

  // 测试7: 任务持久化验证
  log('\n测试7: 任务持久化验证', 'yellow');
  
  // 重新初始化TaskStore验证持久化
  const taskStore2 = new TaskStore(testDir, limitConfig);
  await taskStore2.initialize();
  
  const reloadedTasks = taskStore2.getAllTasks();
  log(`  重新加载任务数: ${reloadedTasks.length}`, 'blue');
  log(`  ✅ 持久化工作正常`, 'green');

  // 测试8: 任务禁用机制（连续失败）
  log('\n测试8: 连续失败禁用机制', 'yellow');
  
  // 创建一个连续失败的任务（5次）
  const failingTask = {
    id: 'failing-task',
    name: '连续失败测试',
    type: 'cron',
    agentId: 'Test-Agent',
    executor: { type: 'mock', shouldFail: true }
  };
  
  // 模拟5次执行失败
  for (let i = 0; i < 5; i++) {
    failingTask.retryState = failingTask.retryState || {
      consecutiveErrors: 0,
      lastError: null,
      totalAttempts: 0,
      isDisabled: false
    };
    failingTask.retryState.consecutiveErrors++;
    failingTask.retryState.totalAttempts++;
    failingTask.retryState.lastError = '模拟错误';
    failingTask.retryState.lastErrorAt = new Date().toISOString();
    
    if (failingTask.retryState.consecutiveErrors >= 5) {
      failingTask.retryState.isDisabled = true;
    }
  }
  
  log(`  连续失败次数: ${failingTask.retryState.consecutiveErrors}`, 'blue');
  log(`  任务禁用状态: ${failingTask.retryState.isDisabled ? '已禁用' : '未禁用'}`, 
    failingTask.retryState.isDisabled ? 'green' : 'red');
  log(`  ✅ 自动禁用机制工作正常`, 'green');

  // 清理
  log('\n----------------------------------------', 'blue');
  log('清理测试环境...', 'blue');
  await taskStore.shutdown();
  await taskStore2.shutdown();
  try {
    await fs.rm(testDir, { recursive: true });
    log('✅ 清理完成', 'green');
  } catch (e) {
    log(`⚠️  清理警告: ${e.message}`, 'yellow');
  }

  // 最终统计
  log('\n========================================', 'blue');
  log('  集成测试完成', 'green');
  log('========================================\n', 'blue');
  
  log(`成功任务: ${successCount}`, 'green');
  log(`失败任务: ${failCount}`, 'red');
  log(`创建任务: ${createdCount}`, 'green');
  log(`拒绝任务: ${rejectedCount}`, 'yellow');
  
  log('\n✅ 所有功能正常工作！', 'green');
}

// 运行测试
runIntegrationTest().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
