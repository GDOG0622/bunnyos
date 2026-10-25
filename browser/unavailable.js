function unavailable() { throw new Error('此功能需要自部署版服务；网页版不能执行本机命令或充当网络代理。'); }
module.exports = { spawn: unavailable, get: unavailable, request: unavailable,
    StdioClientTransport: class { constructor() { unavailable(); } },
    generateVAPIDKeys: unavailable, setVapidDetails: unavailable, sendNotification: unavailable };
