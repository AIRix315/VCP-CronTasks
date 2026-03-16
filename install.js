#!/usr/bin/env node
/**
 * VCP-CronTasks 安装脚本
 * 自动安装插件到 VCPToolBox
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const PLUGIN_NAME = 'CronTaskOrchestrator';
const REQUIRED_FILES = [
    'plugin-manifest.json',
    'index.js',
    'config.env.example',
    'src'
];

async function findVCPToolBox() {
    // 从当前目录向上查找
    let currentDir = __dirname;
    
    while (currentDir !== path.parse(currentDir).root) {
        const pluginDir = path.join(currentDir, 'Plugin');
        const serverJs = path.join(currentDir, 'server.js');
        
        if (fsSync.existsSync(pluginDir) && fsSync.existsSync(serverJs)) {
            return currentDir;
        }
        
        currentDir = path.dirname(currentDir);
    }
    
    return null;
}

async function install() {
    console.log('🔧 VCP-CronTasks 安装程序');
    console.log('');
    
    // 查找 VCPToolBox
    const vcpPath = await findVCPToolBox();
    
    if (!vcpPath) {
        console.error('❌ 错误：未找到 VCPToolBox 安装目录');
        console.error('   请确保你在 VCPToolBox/Plugin/ 目录下运行 npm install');
        console.error('   或者手动复制此文件夹到 VCPToolBox/Plugin/CronTaskOrchestrator/');
        process.exit(1);
    }
    
    console.log(`✅ 找到 VCPToolBox: ${vcpPath}`);
    
    // 检查是否是正确的插件目录
    const currentDir = __dirname;
    const currentDirName = path.basename(currentDir);
    
    if (currentDirName !== PLUGIN_NAME) {
        console.error(`❌ 错误：当前目录名称必须是 ${PLUGIN_NAME}`);
        console.error(`   当前: ${currentDirName}`);
        console.error(`   请重命名文件夹或复制到: VCPToolBox/Plugin/${PLUGIN_NAME}/`);
        process.exit(1);
    }
    
    // 验证必要文件
    console.log('🔍 验证插件文件...');
    for (const file of REQUIRED_FILES) {
        const filePath = path.join(currentDir, file);
        if (!fsSync.existsSync(filePath)) {
            console.error(`❌ 缺少必要文件: ${file}`);
            process.exit(1);
        }
    }
    
    console.log('✅ 所有文件验证通过');
    
    // 检查是否在正确的位置
    const expectedPath = path.join(vcpPath, 'Plugin', PLUGIN_NAME);
    if (currentDir !== expectedPath) {
        console.log('');
        console.log('⚠️  警告：当前目录不在预期的位置');
        console.log(`   当前: ${currentDir}`);
        console.log(`   预期: ${expectedPath}`);
        console.log('');
        console.log('📋 请手动复制此文件夹到:');
        console.log(`   ${expectedPath}`);
        console.log('');
        console.log('然后运行:');
        console.log('   cd ' + expectedPath);
        console.log('   cp config.env.example config.env');
        console.log('   cd ' + vcpPath);
        console.log('   node server.js');
        process.exit(0);
    }
    
    // 检查 node_modules
    const nodeModulesPath = path.join(currentDir, 'node_modules');
    if (!fsSync.existsSync(nodeModulesPath)) {
        console.log('');
        console.log('📦 安装依赖...');
        console.log('   运行: npm install node-schedule uuid');
    }
    
    console.log('');
    console.log('✅ 安装检查完成！');
    console.log('');
    console.log('📋 下一步:');
    console.log('   1. 复制配置文件: cp config.env.example config.env');
    console.log('   2. 编辑 config.env (可选)');
    console.log('   3. 重启 VCPToolBox: node server.js');
    console.log('');
    console.log('📖 使用文档: https://github.com/AIRix315/VCP-CronTasks#readme');
}

install().catch(error => {
    console.error('❌ 安装失败:', error);
    process.exit(1);
});
