/**
 * Agent 执行器
 * 用于调用 AgentAssistant 与其他 Agent 通信
 */
class AgentExecutor {
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
        this.agentAssistant = null;
    }

    /**
     * 初始化时获取 AgentAssistant 模块
     */
    initialize() {
        try {
            // 尝试从 serviceModules 获取 AgentAssistant
            this.agentAssistant = this.pluginManager.serviceModules?.get('AgentAssistant');
            if (!this.agentAssistant) {
                console.warn('[AgentExecutor] AgentAssistant 插件未加载');
            }
        } catch (error) {
            console.error('[AgentExecutor] 初始化失败:', error);
        }
    }

    /**
     * 执行 Agent 调用
     * @param {Object} config - 执行配置
     * @param {string} config.target - 目标 Agent 名称
     * @param {string} config.prompt - 发送给 Agent 的消息
     * @returns {Promise<Object>} 执行结果
     */
    async execute(config) {
        const { target, prompt } = config;
        
        if (!target) {
            throw new Error('AgentExecutor: 未指定目标 Agent');
        }

        if (!this.agentAssistant) {
            return {
                success: false,
                error: 'AgentAssistant 插件未加载',
                executor: 'agent',
                target: target
            };
        }

        try {
            // 调用 AgentAssistant
            const result = await this.agentAssistant.module.processToolCall({
                agent_name: target,
                prompt: prompt
            });
            
            return {
                success: true,
                result: result,
                executor: 'agent',
                target: target
            };
        } catch (error) {
            console.error(`[AgentExecutor] 调用 Agent ${target} 失败:`, error);
            return {
                success: false,
                error: error.message || '未知错误',
                executor: 'agent',
                target: target
            };
        }
    }
}

module.exports = AgentExecutor;
