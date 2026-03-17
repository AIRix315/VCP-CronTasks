# VCP-CronTasks v1.1.0 版本发布说明

> **发布版本**: v1.1.0  
> **发布日期**: 2026-03-17  
> **更新类型**: 功能增强  
> **兼容性**: 向后兼容

---

## 🎉 版本概要

**VCP-CronTasks v1.1.0 正式发布！**

本版本新增了生产级的失败重试机制和任务数限制功能，大幅提升了系统的稳定性和可靠性。

---

## ✨ 新增功能

### 1. 失败重试机制 ⭐

任务执行失败时自动重试，提高任务成功率。

**功能特性**:
- ✅ 最多3次重试（可配置）
- ✅ 指数退避策略：30秒 → 60秒 → 300秒
- ✅ 连续5次失败自动禁用任务
- ✅ 完整的重试状态记录

**配置项**:
```bash
CRON_TASK_RETRY_ENABLED=true          # 启用重试
CRON_TASK_MAX_RETRIES=3               # 最大重试次数
CRON_TASK_RETRY_BACKOFF_MS=30000,60000,300000  # 退避间隔
```

### 2. 任务数限制 ⭐

防止任务无限增长，保护系统资源。

**功能特性**:
- ✅ 全局任务数限制（默认100）
- ✅ Per-Agent任务数限制（默认20）
- ✅ 可配置拒绝或警告模式
- ✅ 实时限额状态查询

**配置项**:
```bash
CRON_TASK_GLOBAL_LIMIT=100            # 全局限制
CRON_TASK_PER_AGENT_LIMIT=20          # Per-Agent限制
CRON_TASK_LIMIT_ACTION=reject         # reject|warn
```

### 3. Agent ID 支持

任务可指定所属Agent，实现精细化的任务管理。

**使用方式**:
```javascript
{
  command: 'CreateCronTask',
  name: '备份任务',
  agentId: 'Nova',  // 指定Agent
  ...
}
```

### 4. 增强的占位符

`{{VCP_CRON_TASK_STATS}}` 现在显示限额信息：
```
Cron任务: 5个, Heartbeat任务: 3个, 运行中: 2个, 全局限额: 8/100
```

---

## 📝 更新日志

### v1.1.0 (2026-03-17)

#### 新增功能
- **feat**: 实现失败重试机制（最多3次，指数退避）
- **feat**: 实现任务数限制（全局100 + Per-Agent 20）
- **feat**: 添加连续失败自动禁用功能（5次）
- **feat**: 增强日志记录，显示重试信息
- **feat**: 添加限额状态显示
- **feat**: 支持Agent ID自动注入

#### 测试
- **test**: 添加单元测试脚本
- **test**: 添加集成测试脚本
- **test**: 添加生产环境测试脚本
- **test**: 全部测试通过（100%）

#### 文档
- **docs**: 添加完整的设计文档
- **docs**: 添加代码审核报告
- **docs**: 添加执行计划书
- **docs**: 添加生产部署报告

#### 配置
- **config**: 新增6个配置项
- **config**: 向后兼容，默认值安全

---

## 🚀 快速开始

### 升级步骤

1. **备份现有配置**
   ```bash
   cp config.env config.env.backup
   ```

2. **更新代码**
   ```bash
   git pull origin master
   ```

3. **更新配置**
   ```bash
   # 复制新配置项到现有config.env
   cat config.env.example >> config.env
   ```

4. **重启服务**
   ```bash
   pm2 restart vcptoolbox
   ```

### 验证安装

```bash
# 运行测试
node production-test.js

# 预期输出：
# ✅ 生产环境测试全部通过！
# ✅ VCP-CronTasks v1.1 已成功部署并运行！
```

---

## 📊 性能影响

| 指标 | 影响 | 说明 |
|------|------|------|
| 内存占用 | +10KB/任务 | retryState存储 |
| 启动延迟 | +1ms | 配置解析 |
| 任务执行 | +0.1ms | 状态检查 |
| 磁盘I/O | 无变化 | 不修改存储频率 |

---

## 🔒 向后兼容性

**完全向后兼容！**

- ✅ 所有新配置都有默认值
- ✅ 不配置新功能时行为不变
- ✅ 现有任务无需修改
- ✅ 可配置禁用新功能

```bash
# 禁用新功能（恢复v1.0行为）
CRON_TASK_RETRY_ENABLED=false
CRON_TASK_GLOBAL_LIMIT=999999
```

---

## 🐛 修复问题

### 已知限制
- Per-Agent限制需要任务指定agentId
- 高频任务（<5秒）可能产生较多日志

### 计划修复
- v1.2.0: 批量日记写入优化
- v1.2.0: 队列背压控制

---

## 📚 相关文档

- [设计文档](Docs/vcp-crontasks-retry-limits-designV1.1.md)
- [审核报告](Docs/vcp-crontasks-code-audit-reportV2.1.md)
- [部署指南](Docs/production-deployment-report.md)
- [API文档](Docs/execution-plan.md)

---

## 🤝 贡献者

- 开发团队：VCP开发团队
- 设计：基于Openfang和Openclaw最佳实践
- 测试：完整单元测试+集成测试+生产测试

---

## 📞 支持

如有问题，请：
1. 查看[部署指南](Docs/production-deployment-report.md)
2. 运行 `node production-test.js` 诊断
3. 提交Issue到GitHub

---

**版本**: v1.1.0  
**Git标签**: 建议 `git tag v1.1.0`  
**发布状态**: ✅ 已发布

---

🎉 **感谢使用 VCP-CronTasks！**
