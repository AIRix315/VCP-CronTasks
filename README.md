# VCP-CronTasks

<p align="center">
  <strong>VCPToolBox 周期任务编排插件</strong><br>
  Cron 定时 + Heartbeat 心跳 双轨调度
</p>

<p align="center">
  <a href="#中文">中文</a> | <a href="#english">English</a>
</p>

---

## 中文

### 📋 目录

- [简介](#简介)
- [功能特性](#功能特性)
- [安装](#安装)
- [配置](#配置)
- [使用示例](#使用示例)
- [API 文档](#api-文档)
- [目录结构](#目录结构)

### 简介

**VCP-CronTasks** 是一个用于 [VCPToolBox](https://github.com/lioensky/VCPToolBox) 的周期任务编排插件，支持 **Cron 定时任务** 和 **Heartbeat 心跳任务** 两种调度模式。

### 功能特性

- **双轨调度**: Cron 精确时间调度 + Heartbeat 周期感知
- **多种执行器**: 支持 VCP 插件、Agent、HTTP API
- **任务持久化**: JSON 文件存储，重启自动恢复
- **并发控制**: 可配置最大并发数
- **条件触发**: Heartbeat 支持基于日记内容的条件判断
- **日志记录**: 执行结果自动记录到日记本
- **动态占位符**: `{{VCP_CRON_TASK_STATS}}` 实时显示任务统计

### 安装

#### 方法一：手动安装（推荐）

```bash
# 1. 进入 VCPToolBox 的 Plugin 目录
cd /path/to/VCPToolBox/Plugin

# 2. 克隆仓库
git clone https://github.com/AIRix315/VCP-CronTasks.git CronTaskOrchestrator

# 3. 进入插件目录
cd CronTaskOrchestrator

# 4. 复制配置文件
cp config.env.example config.env

# 5. 重启 VCPToolBox
cd /path/to/VCPToolBox
node server.js
```

#### 方法二：下载 ZIP

1. 下载 [最新版本](https://github.com/AIRix315/VCP-CronTasks/releases)
2. 解压到 `VCPToolBox/Plugin/CronTaskOrchestrator/`
3. 复制 `config.env.example` 为 `config.env`
4. 重启 VCPToolBox

### 配置

编辑 `config.env`：

```env
# 最大并发任务数
CRON_TASK_MAX_CONCURRENT=10

# 默认心跳间隔（毫秒，默认5分钟）
CRON_TASK_DEFAULT_HEARTBEAT_INTERVAL=300000

# 任务存储路径
CRON_TASK_STORAGE_PATH=./Plugin/CronTaskOrchestrator/tasks

# 任务日志存储的日记本名称
CRON_TASK_LOG_DIARY=任务日志

# 调试模式
DebugMode=false
```

### 使用示例

#### 创建 Cron 任务

在 AI 对话中使用 VCP 指令：

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」CronTaskOrchestrator「末」,
command:「始」CreateCronTask「末」,
name:「始」每日报告「末」,
cronExpression:「始」0 9 * * *「末」,
executor:「始」{"type":"plugin","target":"ReportGenerator","method":"generateDaily"}「末」
<<<[END_TOOL_REQUEST]>>>
```

#### 创建 Heartbeat 任务

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」CronTaskOrchestrator「末」,
command:「始」CreateHeartbeatTask「末」,
name:「始」监控未读邮件「末」,
intervalMs:「始」300000「末」,
condition:「始」{"type":"diary_query","query":"未读邮件"}「末」,
executor:「始」{"type":"plugin","target":"MailChecker","method":"checkUnread"}「末」
<<<[END_TOOL_REQUEST]>>>
```

### API 文档

#### REST API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/v1/cron_tasks` | 列出所有任务 |
| POST | `/v1/cron_tasks/create` | 创建新任务 |
| POST | `/v1/cron_tasks/:id/pause` | 暂停任务 |
| POST | `/v1/cron_tasks/:id/resume` | 恢复任务 |
| POST | `/v1/cron_tasks/:id/run` | 立即执行 |

### 目录结构

```
VCP-CronTasks/
├── plugin-manifest.json         # 插件清单
├── config.env.example           # 配置模板
├── index.js                     # 插件入口
├── src/
│   ├── scheduler.js             # 调度引擎
│   ├── task-queue.js            # 任务队列
│   ├── api/routes.js            # REST API
│   ├── executors/               # 执行器层
│   └── storage/task-store.js    # 任务存储
└── tasks/                       # 任务数据目录
```

---

## English

### Introduction

**VCP-CronTasks** is a periodic task orchestration plugin for [VCPToolBox](https://github.com/lioensky/VCPToolBox).

### Features

- Dual-track Scheduling: Cron + Heartbeat
- Multiple Executors: Plugins, Agents, HTTP APIs
- Task Persistence: JSON storage
- Concurrency Control
- Conditional Triggers
- Logging to Diary

### Installation

```bash
cd /path/to/VCPToolBox/Plugin
git clone https://github.com/AIRix315/VCP-CronTasks.git CronTaskOrchestrator
cd CronTaskOrchestrator
cp config.env.example config.env
cd /path/to/VCPToolBox
node server.js
```

### Usage Example

Create Cron Task:

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」CronTaskOrchestrator「末」,
command:「始」CreateCronTask「末」,
name:「始」Daily Report「末」,
cronExpression:「始」0 9 * * *「末」,
executor:「始」{"type":"plugin","target":"ReportGenerator"}「末」
<<<[END_TOOL_REQUEST]>>>
```

## License

MIT License
