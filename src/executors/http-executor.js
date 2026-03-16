/**
 * HTTP 执行器
 * 用于调用外部 HTTP API
 */
class HttpExecutor {
    constructor() {
        // 使用 Node.js 内置的 https/http 模块
        this.https = require('https');
        this.http = require('http');
    }

    /**
     * 执行 HTTP 请求
     * @param {Object} config - 执行配置
     * @param {string} config.url - 目标 URL
     * @param {string} config.method - HTTP 方法 (GET/POST/PUT/DELETE)
     * @param {Object} config.headers - 请求头
     * @param {Object} config.body - 请求体 (JSON 对象)
     * @param {number} config.timeout - 超时时间 (毫秒)
     * @returns {Promise<Object>} 执行结果
     */
    async execute(config) {
        const { 
            url, 
            method = 'GET', 
            headers = {}, 
            body,
            timeout = 30000 
        } = config;
        
        if (!url) {
            throw new Error('HttpExecutor: 未指定 URL');
        }

        try {
            const result = await this._makeRequest(url, method, headers, body, timeout);
            
            return {
                success: true,
                result: result,
                executor: 'http',
                url: url,
                method: method
            };
        } catch (error) {
            console.error(`[HttpExecutor] HTTP 请求失败:`, error);
            return {
                success: false,
                error: error.message || '未知错误',
                executor: 'http',
                url: url,
                method: method
            };
        }
    }

    /**
     * 发起 HTTP 请求
     */
    _makeRequest(url, method, headers, body, timeout) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? this.https : this.http;
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method.toUpperCase(),
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                timeout: timeout
            };

            const req = client.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        // 尝试解析为 JSON
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (e) {
                        // 返回原始文本
                        resolve({ text: data, statusCode: res.statusCode });
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }

            req.end();
        });
    }
}

module.exports = HttpExecutor;
