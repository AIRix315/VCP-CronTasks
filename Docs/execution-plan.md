# VCP-CronTasks 实施方案 - 执行计划书

> **版本**: v1.0  
> **状态**: 已确认可行，等待执行  
> **预计工作量**: 4-5小时  
> **风险等级**: 低

---

## 一、可行性分析结论

### 1.1 架构兼容性: ✅ 完全兼容

经过实际代码审查，确认以下架构特性：

| 组件 | 当前设计 | 方案兼容性 | 修改难度 |
|------|---------|-----------|----------|
| **TaskQueue** | 类构造函数接收maxConcurrent | 可扩展为接收retryConfig | ⭐ 低 |
| **TaskStore** | 类构造函数接收storagePath | 可扩展为接收limitConfig | ⭐ 低 |
| **index.js** | 集中初始化，配置从config读取 | 直接添加新配置解析 | ⭐ 低 |
| **scheduler.js** | 使用async/await，有日记集成 | 增强日志记录即可 | ⭐ 低 |
| **config.env** | 已有配置模板 | 直接追加新配置项 | ⭐ 低 |

### 1.2 技术可行性: ✅ 无技术障碍

**关键验证点:**

1. **Promise/Async支持**: 代码已使用async/await，支持重试的异步等待
2. **Map存储结构**: TaskStore使用Map，支持O(1)的任务计数查询
3. **配置系统**: 已有config.env读取机制，无需改动基础设施
4. **日记集成**: 已有knowledgeBaseManager集成，可直接增强
5. **错误处理**: 已有try-catch结构，可包装重试逻辑

### 1.3 风险评估: 🟢 低风险

| 风险项 | 概率 | 影响 | 缓解措施 |
|--------|------|------|----------|
| 配置向后不兼容 | 低 | 中 | 所有新配置都有默认值 |
| 重试导致资源耗尽 | 低 | 高 | 指数退避+最大重试限制 |
| 任务限制误杀 | 低 | 中 | 可配置为warn模式而非reject |
| 磁盘I/O激增 | 中 | 中 | 批量写入优化 |

---

## 二、执行计划概览

### 2.1 文件修改清单

| 优先级 | 文件 | 修改类型 | 预计行数 | 依赖 |
|--------|------|----------|----------|------|
| P0 | `config.env.example` | 追加配置 | +15行 | 无 |
| P0 | `src/task-queue.js` | 增强 | +45行 | 配置定义 |
| P0 | `src/storage/task-store.js` | 增强 | +35行 | 配置定义 |
| P0 | `index.js` | 修改初始化 | +20行 | 以上两个文件 |
| P1 | `src/scheduler.js` | 增强日志 | +15行 | 重试逻辑 |

### 2.2 实施顺序

```
阶段1: 基础配置 (30分钟)
  └─ config.env.example (添加配置项)

阶段2: 核心功能 (3小时)
  ├─ task-queue.js (失败重试)
  ├─ task-store.js (任务限制)
  └─ index.js (配置传递)

阶段3: 优化增强 (1小时)
  └─ scheduler.js (日志增强+批量写入)

阶段4: 测试验证 (30分钟)
  └─ 功能测试 + 代码审查
```

---

## 三、详细实施指南

### 阶段1: 基础配置

#### 文件: `config.env.example`

**位置**: 在文件末尾追加

**新增内容**:
```bash
# ============================================
# VCP-CronTasks 增强配置 (v1.1+)
# ============================================

# ---- 失败重试配置 ----
# 是否启用失败重试 (默认: true)
CRON_TASK_RETRY_ENABLED=true

# 最大重试次数 (默认: 3, 范围: 0-10)
CRON_TASK_MAX_RETRIES=3

# 退避间隔(ms)，逗号分隔，默认: 30s, 60s, 300s
CRON_TASK_RETRY_BACKOFF_MS=30000,60000,300000

# ---- 任务数限制配置 ----
# 全局最大任务数 (默认: 100, 范围: 10-1000)
CRON_TASK_GLOBAL_LIMIT=100

# 每Agent最大任务数 (默认: 20, 范围: 5-100)
CRON_TASK_PER_AGENT_LIMIT=20

# 超出限制时的行为: reject(拒绝) | warn(警告但允许)
CRON_TASK_LIMIT_ACTION=reject
```

---

### 阶段2: 核心功能

#### 2.1 文件: `src/task-queue.js`

**当前构造函数** (第5-14行):
```javascript
class TaskQueue {
    constructor(maxConcurrent = 10) {
        this.maxConcurrent = maxConcurrent;
        this.running = new Map();
        this.queue = [];
        this.executors = new Map();
        this.onTaskStarted = null;
        this.onTaskCompleted = null;
        this.onTaskFailed = null;
    }
```

**修改方案**:
1. **第6行**: 修改构造函数参数
2. **第15行后**: 添加辅助方法

**具体修改**:

```javascript
// 第6行修改:
constructor(maxConcurrent = 10, retryConfig = {}) {

// 第14行后追加:
    // 新增: 重试配置
    this.retryConfig = {
        enabled: retryConfig.enabled !== false,
        maxRetries: retryConfig.maxRetries || 3,
        backoffMs: retryConfig.backoffMs || [30000, 60000, 300000]
    };
```

**当前 _executeTask 方法** (第100-124行):

**修改方案**:
1. 将原 _executeTask 重命名为 _doExecute
2. 新增包装方法 _executeTask 处理重试逻辑
3. 在第179行后添加辅助方法 _delay

**具体代码** (插入到第100行，替换原有方法):

```javascript
/**
 * 执行单个任务（带重试包装）
 */
async _executeTask(task) {
    // 初始化重试状态
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
    
    // 如果任务已被禁用，直接拒绝
    if (task.retryState.isDisabled) {
        throw new Error(`任务 ${task.id} 已因连续失败被禁用`);
    }

    const maxAttempts = 1 + (this.retryConfig.enabled ? this.retryConfig.maxRetries : 0);
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            task.retryState.totalAttempts++;
            
            // 执行实际任务
            const result = await this._doExecute(task);
            
            // 成功: 重置失败计数
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
            
            // 检查是否还有重试机会
            if (attempt < maxAttempts) {
                const backoffMs = this.retryConfig.backoffMs[attempt - 1] || 
                                 this.retryConfig.backoffMs[this.retryConfig.backoffMs.length - 1];
                
                console.warn(
                    `[TaskQueue] 任务 ${task.id} 第 ${attempt} 次执行失败，` +
                    `${backoffMs}ms 后重试: ${error.message}`
                );
                
                // 指数退避等待
                await this._delay(backoffMs);
            }
        }
    }
    
    // 所有重试耗尽，任务失败
    // 连续失败达到阈值，自动禁用任务
    if (task.retryState.consecutiveErrors >= 5) {
        task.retryState.isDisabled = true;
        console.error(`[TaskQueue] 任务 ${task.id} 连续失败 ${task.retryState.consecutiveErrors} 次，已自动禁用`);
    }
    
    throw lastError;
}

/**
 * 实际执行任务（原有逻辑）
 */
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

    // 执行
    const result = await executor.execute(executorConfig);
    
    return {
        taskId: task.id,
        taskName: task.name,
        executorType: type,
        executedAt: new Date().toISOString(),
        ...result
    };
}

/**
 * 延迟工具方法
 */
_delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

#### 2.2 文件: `src/storage/task-store.js`

**当前构造函数** (第10-19行):
```javascript
class TaskStore {
    constructor(storagePath) {
        this.storagePath = storagePath;
        this.cronDir = path.join(storagePath, 'cron');
        this.heartbeatDir = path.join(storagePath, 'heartbeat');
        this.tasks = new Map();
        this.watcher = null;
        this.onTaskAdded = null;
        this.onTaskRemoved = null;
    }
```

**修改方案**:
1. **第11行**: 修改构造函数参数
2. **第19行后**: 添加限制配置和辅助方法

**具体修改**:

```javascript
// 第11行修改:
constructor(storagePath, limitConfig = {}) {

// 第19行后追加:
    // 新增: 限制配置
    this.limitConfig = {
        globalLimit: limitConfig.globalLimit || 100,
        perAgentLimit: limitConfig.perAgentLimit || 20,
        action: limitConfig.action || 'reject'
    };
```

**当前 saveTask 方法** (第92-113行):

**修改方案**: 在方法开头添加限制检查逻辑

**具体修改** (在第93行前插入):

```javascript
    /**
     * 保存任务（带限制检查）
     */
    async saveTask(task) {
        // 新增: 检查全局限制
        if (this.tasks.size >= this.limitConfig.globalLimit) {
            const msg = `全局任务数限制 (${this.limitConfig.globalLimit}) 已达上限`;
            if (this.limitConfig.action === 'reject') {
                throw new Error(msg);
            } else {
                console.warn(`[TaskStore] ${msg}，但仍允许创建`);
            }
        }
        
        // 新增: 检查 Per-Agent 限制
        if (task.agentId) {
            const agentCount = this._getAgentTaskCount(task.agentId);
            if (agentCount >= this.limitConfig.perAgentLimit) {
                const msg = `Agent "${task.agentId}" 任务数限制 (${this.limitConfig.perAgentLimit}) 已达上限`;
                if (this.limitConfig.action === 'reject') {
                    throw new Error(msg);
                } else {
                    console.warn(`[TaskStore] ${msg}，但仍允许创建`);
                }
            }
        }
        
        // 原有逻辑继续...
```

**新增辅助方法** (在第226行前，即module.exports前插入):

```javascript
    /**
     * 获取 Agent 任务数
     */
    _getAgentTaskCount(agentId) {
        return this.tasks.values()
            .filter(t => t.agentId === agentId)
            .length;
    }
    
    /**
     * 获取限制状态（用于 API/占位符）
     */
    getLimitStatus() {
        const status = {
            global: {
                limit: this.limitConfig.globalLimit,
                current: this.tasks.size,
                remaining: Math.max(0, this.limitConfig.globalLimit - this.tasks.size)
            },
            perAgent: {}
        };
        
        // 统计每个 Agent 的任务数
        for (const task of this.tasks.values()) {
            if (task.agentId) {
                status.perAgent[task.agentId] = (status.perAgent[task.agentId] || 0) + 1;
            }
        }
        
        return status;
    }
```

---

#### 2.3 文件: `index.js`

**当前初始化逻辑** (第68-76行):
```javascript
        // 初始化任务存储
        const storagePath = config.CRON_TASK_STORAGE_PATH || './Plugin/CronTaskOrchestrator/tasks';
        taskStore = new TaskStore(storagePath);
        await taskStore.initialize();

        // 初始化任务队列
        const maxConcurrent = config.CRON_TASK_MAX_CONCURRENT || 10;
        const taskQueue = new TaskQueue(maxConcurrent);
```

**修改方案**: 添加配置解析并传递给构造函数

**具体修改** (替换第68-76行):

```javascript
        // 新增: 解析重试配置
        const retryConfig = {
            enabled: config.CRON_TASK_RETRY_ENABLED !== 'false',
            maxRetries: parseInt(config.CRON_TASK_MAX_RETRIES, 10) || 3,
            backoffMs: (config.CRON_TASK_RETRY_BACKOFF_MS || '30000,60000,300000')
                .split(',')
                .map(s => parseInt(s.trim(), 10))
                .filter(n => !isNaN(n))
        };

        // 新增: 解析限制配置
        const limitConfig = {
            globalLimit: parseInt(config.CRON_TASK_GLOBAL_LIMIT, 10) || 100,
            perAgentLimit: parseInt(config.CRON_TASK_PER_AGENT_LIMIT, 10) || 20,
            action: config.CRON_TASK_LIMIT_ACTION || 'reject'
        };

        // 初始化任务存储（传入限制配置）
        const storagePath = config.CRON_TASK_STORAGE_PATH || './Plugin/CronTaskOrchestrator/tasks';
        taskStore = new TaskStore(storagePath, limitConfig);
        await taskStore.initialize();

        // 初始化任务队列（传入重试配置）
        const maxConcurrent = config.CRON_TASK_MAX_CONCURRENT || 10;
        const taskQueue = new TaskQueue(maxConcurrent, retryConfig);
```

**增强占位符** (第22-41行 updatePlaceholder函数):

**修改方案**: 在原有基础上增加限制状态显示

**具体修改** (修改第31行):

```javascript
        // 新增: 限制状态
        const limitStatus = taskStore ? taskStore.getLimitStatus() : null;
        const globalUsage = limitStatus ? 
            `${limitStatus.global.current}/${limitStatus.global.limit}` : 'N/A';

        const placeholderValue = `Cron任务: ${cronCount}个, Heartbeat任务: ${heartbeatCount}个, 运行中: ${runningCount}个, 全局限额: ${globalUsage}`;
```

---

### 阶段3: 优化增强

#### 文件: `src/scheduler.js`

**当前 _logToDiary 方法** (第172-202行):

**修改方案**: 增强日志内容，添加重试信息

**具体修改** (在第186行后，执行结果行前插入):

```javascript
    // 构建重试信息
    let retryInfo = '';
    if (task.retryState && task.retryState.totalAttempts > 1) {
        retryInfo = `
## 重试信息
- **尝试次数**: ${task.retryState.totalAttempts}
- **成功重试**: 是
- **上次失败**: ${task.retryState.lastError || '无'}
`;
    }
```

并在第188行的 `**执行结果**` 后添加 `${retryInfo}`:

```javascript
**执行时间**: ${timestamp}  
**执行结果**: ${result.success ? '成功' : '失败'}
${retryInfo}

## 执行详情
```

---

## 四、关键修改点索引

### 4.1 行号速查表

| 文件 | 修改位置 | 原代码行号 | 修改类型 |
|------|---------|-----------|----------|
| `config.env.example` | 文件末尾 | 第18行后 | 追加 |
| `task-queue.js` | 构造函数 | 第6行 | 修改参数 |
| `task-queue.js` | 构造初始化 | 第14行后 | 插入 |
| `task-queue.js` | _executeTask | 第100-124行 | 完全替换 |
| `task-queue.js` | 新方法 | 第179行后 | 追加 |
| `task-store.js` | 构造函数 | 第11行 | 修改参数 |
| `task-store.js` | 构造初始化 | 第19行后 | 插入 |
| `task-store.js` | saveTask | 第93行前 | 插入 |
| `task-store.js` | 辅助方法 | 第226行前 | 追加 |
| `index.js` | 配置解析 | 第68-76行 | 替换 |
| `index.js` | 占位符 | 第31行 | 修改 |
| `scheduler.js` | _logToDiary | 第186行后 | 插入 |

---

## 五、验证检查清单

### 5.1 功能验证

- [ ] 配置读取: 新配置项能正确从config.env读取
- [ ] 重试机制: 任务失败后自动重试3次
- [ ] 指数退避: 重试间隔按30s, 60s, 300s执行
- [ ] 自动禁用: 连续5次失败后任务被禁用
- [ ] 全局限制: 达到100个任务后拒绝创建
- [ ] Per-Agent限制: 单个Agent达到20个任务后拒绝
- [ ] 占位符更新: {{VCP_CRON_TASK_STATS}}显示任务限额

### 5.2 向后兼容性

- [ ] 旧配置: 不配置新项时功能正常
- [ ] 旧任务: 已有任务能正常加载和执行
- [ ] 降级开关: 设置CRON_TASK_RETRY_ENABLED=false禁用重试

### 5.3 边界情况

- [ ] 重试次数=0: 不重试，立即失败
- [ ] 退避配置缺失: 使用默认值
- [ ] Agent无ID: 不计入Per-Agent限制
- [ ] 限制=Infinity: 实际表现为无限制

---

## 六、回滚方案

### 6.1 紧急回滚

如果出现问题，立即执行:

```bash
# 1. 在 config.env 中禁用新功能
CRON_TASK_RETRY_ENABLED=false
CRON_TASK_GLOBAL_LIMIT=999999

# 2. 重启服务
pm2 restart server
```

### 6.2 代码回滚

```bash
# 回滚到修改前
git checkout -- src/task-queue.js
.git checkout -- src/storage/task-store.js
git checkout -- index.js
git checkout -- src/scheduler.js
git checkout -- config.env.example
```

---

## 七、后续优化建议 (可选)

### 7.1 P1优先级 (实施后一周内)
- 批量日记写入优化 (减少I/O)
- 队列背压控制 (防止内存溢出)
- VCPInfo广播增强

### 7.2 P2优先级 (长期规划)
- 秒级精度文档说明 (已支持，无需代码)
- 任务统计API
- Web管理界面集成

---

## 八、执行前确认清单

- [ ] 已备份当前代码
- [ ] 已阅读并理解所有修改位置
- [ ] 测试环境可用
- [ ] 配置模板已更新
- [ ] 回滚方案已准备

---

**计划书状态**: ✅ 已就绪，等待执行指令  
**最后更新**: 2026-03-17  
**文档版本**: v1.0
