/**
 * 插件执行器
 * 用于调用其他 VCP 插件
 */
class PluginExecutor {
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
    }

    /**
     * 执行插件调用
     * @param {Object} config - 执行配置
     * @param {string} config.target - 目标插件名称
     * @param {string} config.method - 调用的方法/命令
     * @param {Object} config.payload - 传递给插件的参数
     * @returns {Promise<Object>} 执行结果
     */
    async execute(config) {
        const { target, method, payload = {} } = config;
        
        if (!target) {
            throw new Error('PluginExecutor: 未指定目标插件');
        }

        try {
            // 构建工具调用参数
            const toolArgs = {
                command: method,
                ...payload
            };

            // 调用插件
            const result = await this.pluginManager.processToolCall(target, toolArgs);
            
            return {
                success: true,
                result: result,
                executor: 'plugin',
                target: target,
                method: method
            };
        } catch (error) {
            console.error(`[PluginExecutor] 执行插件 ${target} 失败:`, error);
            return {
                success: false,
                error: error.message || '未知错误',
                executor: 'plugin',
                target: target,
                method: method
            };
        }
    }
}

module.exports = PluginExecutor;
