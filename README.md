# ZY研究室

公开整站：https://zhenyuaini.github.io/

GitHub Pages 托管前端和公共数据，浏览器每分钟读取免费行情。原 EdgeOne 免费云后台继续计算收盘数据、14:30采样、份额配对和周报；GitHub Actions 自动发布到此站，访客无需登录或访问受限的后台默认域名。

盘中估算按约10分钟发布；ETF与自选股收盘后更新。排队和构建可能延迟，以每项的实际数据日期为准。失败保留原存档或显示缺失，不伪造行情。原开发仓库保持私有。

运行 node scripts/verify-public-data.mjs 检查匿名数据与最新周报。发布状态见 /data/status.json；工作流见 .github/workflows/publish-data.yml。
