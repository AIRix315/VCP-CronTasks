/**
 * REST API 路由
 * 提供 HTTP API 端点
 */
function registerRoutes(router, { scheduler, taskStore, updatePlaceholder }) {
    
    // 获取所有任务
    router.get('/v1/cron_tasks', async (req, res) => {
        try {
            const tasks = taskStore.getAllTasks();
            res.json({
                success: true,
                data: tasks
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 创建任务
    router.post('/v1/cron_tasks/create', async (req, res) => {
        try {
            const task = req.body;
            
            // 验证必填字段
            if (!task.name) {
                return res.status(400).json({
                    success: false,
                    error: '缺少任务名称'
                });
            }

            if (!task.type || !['cron', 'heartbeat'].includes(task.type)) {
                return res.status(400).json({
                    success: false,
                    error: '无效的任务类型，必须是 cron 或 heartbeat'
                });
            }

            if (task.type === 'cron' && !task.cronExpression) {
                return res.status(400).json({
                    success: false,
                    error: 'Cron 任务需要提供 cronExpression'
                });
            }

            if (task.type === 'heartbeat' && !task.intervalMs) {
                return res.status(400).json({
                    success: false,
                    error: 'Heartbeat 任务需要提供 intervalMs'
                });
            }

            if (!task.executor || !task.executor.type) {
                return res.status(400).json({
                    success: false,
                    error: '缺少执行器配置'
                });
            }

            // 设置默认值
            task.enabled = task.enabled !== false;
            task.status = 'idle';
            task.createdAt = new Date().toISOString();

            // 保存任务
            await taskStore.saveTask(task);

            // 添加到调度器
            if (task.enabled) {
                if (task.type === 'cron') {
                    scheduler.addCronTask(task);
                } else if (task.type === 'heartbeat') {
                    scheduler.addHeartbeatTask(task);
                }
            }

            // 更新占位符
            if (updatePlaceholder) {
                updatePlaceholder();
            }

            res.json({
                success: true,
                data: task
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 更新任务
    router.put('/v1/cron_tasks/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            
            const task = taskStore.getTask(id);
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: '任务不存在'
                });
            }

            // 先暂停旧任务
            scheduler.pauseTask(id);

            // 更新任务
            const updatedTask = await taskStore.updateTask(id, updates);

            // 如果任务已启用，重新添加
            if (updatedTask.enabled && updatedTask.status !== 'paused') {
                if (updatedTask.type === 'cron') {
                    scheduler.addCronTask(updatedTask);
                } else if (updatedTask.type === 'heartbeat') {
                    scheduler.addHeartbeatTask(updatedTask);
                }
            }

            // 更新占位符
            if (updatePlaceholder) {
                updatePlaceholder();
            }

            res.json({
                success: true,
                data: updatedTask
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 删除任务
    router.delete('/v1/cron_tasks/:id', async (req, res) => {
        try {
            const { id } = req.params;
            
            // 停止任务
            scheduler.removeTask(id);

            // 删除任务
            const deleted = await taskStore.deleteTask(id);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    error: '任务不存在'
                });
            }

            // 更新占位符
            if (updatePlaceholder) {
                updatePlaceholder();
            }

            res.json({
                success: true,
                message: '任务已删除'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 暂停任务
    router.post('/v1/cron_tasks/:id/pause', async (req, res) => {
        try {
            const { id } = req.params;
            
            const task = taskStore.getTask(id);
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: '任务不存在'
                });
            }

            scheduler.pauseTask(id);

            res.json({
                success: true,
                message: '任务已暂停'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 恢复任务
    router.post('/v1/cron_tasks/:id/resume', async (req, res) => {
        try {
            const { id } = req.params;
            
            const task = taskStore.getTask(id);
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: '任务不存在'
                });
            }

            scheduler.resumeTask(id);

            // 更新占位符
            if (updatePlaceholder) {
                updatePlaceholder();
            }

            res.json({
                success: true,
                message: '任务已恢复'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 立即执行任务
    router.post('/v1/cron_tasks/:id/run', async (req, res) => {
        try {
            const { id } = req.params;
            
            const task = taskStore.getTask(id);
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: '任务不存在'
                });
            }

            // 立即执行
            const result = await scheduler.runTaskNow(id);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 获取任务执行历史
    router.get('/v1/cron_tasks/:id/history', async (req, res) => {
        try {
            const { id } = req.params;
            
            const task = taskStore.getTask(id);
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: '任务不存在'
                });
            }

            res.json({
                success: true,
                data: task.executions || []
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 获取统计信息
    router.get('/v1/cron_tasks/stats', async (req, res) => {
        try {
            const stats = scheduler.getStats();
            const tasks = taskStore.getAllTasks();
            
            res.json({
                success: true,
                data: {
                    ...stats,
                    totalTasks: tasks.length,
                    cronCount: tasks.filter(t => t.type === 'cron').length,
                    heartbeatCount: tasks.filter(t => t.type === 'heartbeat').length
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 获取单个任务
    router.get('/v1/cron_tasks/:id', async (req, res) => {
        try {
            const { id } = req.params;
            
            const task = taskStore.getTask(id);
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: '任务不存在'
                });
            }

            res.json({
                success: true,
                data: task
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
}

module.exports = registerRoutes;
