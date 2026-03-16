/**
 * 执行器统一导出
 */
const PluginExecutor = require('./plugin-executor');
const AgentExecutor = require('./agent-executor');
const HttpExecutor = require('./http-executor');

module.exports = {
    PluginExecutor,
    AgentExecutor,
    HttpExecutor
};
