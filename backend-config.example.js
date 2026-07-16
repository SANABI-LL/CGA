// CampusGeo 前端原型的后端配置模板。
// 复制为 backend-config.local.js（已 gitignore）并填入真实值——
// 该文件绝不能提交，也绝不能随页面托管（key 会随之公开）。
window.CAMPUSGEO_CONFIG = {
  // 生产 API Gateway 端点，或本地 dev-server http://localhost:3001
  apiBase: 'https://<api-id>.execute-api.us-east-1.amazonaws.com',
  // Lambda 的共享密钥（本地 dev-server 无需填写）
  apiKey: '<API_SECRET>',
}
