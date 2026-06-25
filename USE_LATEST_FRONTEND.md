# 使用最新前端界面连接后端

**最后更新**: 2026-06-25

本文档说明如何使用 `CampusGeo Print-a-Map.html`（最新设计稿）连接到后端 API。

---

## 📂 文件说明

### 原始文件（静态原型）

**文件**: `CampusGeo Print-a-Map.html`  
**状态**: ❌ 无后端连接  
**用途**: 设计稿/原型演示

### 注入后端版本（推荐使用）

**文件**: `CampusGeo-with-Backend.html`  
**状态**: ✅ 已连接 localhost:3001  
**用途**: 完整功能测试

### 注入脚本

**文件**: `inject-backend.js`  
**功能**:
- 拦截搜索框输入
- 连接 localhost:3001 后端
- 渲染 GeoJSON 到地图
- 显示 AI 回答

---

## 🚀 使用步骤

### 步骤 1：启动后端

```bash
cd "C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent\backend\dev-server"
pnpm dev

# 应该显示：
# CampusGeo dev server listening at http://localhost:3001
```

### 步骤 2：打开前端

**方式 A：双击打开（推荐）**

1. 找到文件：`CampusGeo-with-Backend.html`
2. 双击，浏览器自动打开

**方式 B：手动打开**

在浏览器地址栏输入：
```
file:///C:/Users/linyuliu89/Dropbox/Academy/Claude%20Code/GIS%20Agent/CampusGeo-with-Backend.html
```

### 步骤 3：测试查询

1. **打开浏览器开发者工具**（F12）
2. **查看 Console**，应该显示：
   ```
   [CampusGeo Backend] Injection script loaded
   [CampusGeo Backend] Found search input: <input...>
   [CampusGeo Backend] ✓ Ready! Test with: window.testBackend("your query")
   ```

3. **在搜索框输入查询**：
   ```
   How many trees are on campus?
   ```

4. **按回车**

### 步骤 4：验证结果

**预期行为**：

1. **Console 输出**：
   ```
   [CampusGeo Backend] Intercepted query: How many trees are on campus?
   [CampusGeo Backend] Querying: How many trees are on campus?
   [CampusGeo Backend] Event: tool_call query_trees
   [CampusGeo Backend] Event: tool_result 
   [CampusGeo Backend] Updating map with 5488 features
   [CampusGeo Backend] Layer added to map
   [CampusGeo Backend] Query complete
   ```

2. **地图更新**：
   - 地图上出现 **5488 个金色点**（树木位置）
   - 地图自动缩放到数据范围

3. **答案面板**：
   - 右下角出现悬浮面板
   - 显示 AI 回答："There are 5,488 trees documented..."

---

## 🧪 手动测试（如果搜索框不工作）

在浏览器 Console 中运行：

```javascript
// 测试后端连接
window.testBackend('How many trees?')

// 测试其他查询
window.testBackend('Show me buildings')
window.testBackend('Where are all-gender restrooms?')
```

---

## 🔍 故障排除

### 问题 1：Console 显示 "Search input not found"

**原因**: 页面还没加载完成，或搜索框结构不同。

**解决**：
1. 等待 5 秒后刷新页面
2. 手动运行：`window.testBackend('your query')`

---

### 问题 2：CORS 错误

```
Access to fetch at 'http://localhost:3001' from origin 'null' has been blocked
```

**原因**: 文件协议（`file://`）的 CORS 限制。

**解决方案 A**：使用本地服务器

```bash
# 安装简单 HTTP 服务器
npm install -g http-server

# 在项目目录运行
cd "C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent"
http-server -p 8080

# 访问
# http://localhost:8080/CampusGeo-with-Backend.html
```

**解决方案 B**：启动 Chrome 禁用 CORS（仅测试用）

```bash
chrome.exe --disable-web-security --user-data-dir="C:\temp\chrome-dev"
```

然后打开 `CampusGeo-with-Backend.html`。

---

### 问题 3：地图不显示标记

**可能原因**：
- ArcGIS API 未加载完成
- `mapView` 变量名不对

**调试步骤**：

1. Console 运行：
   ```javascript
   console.log('Available map variables:', 
     Object.keys(window).filter(k => k.toLowerCase().includes('map'))
   );
   ```

2. 找到正确的变量名（例如 `window.view`）

3. 修改 `inject-backend.js` 第 138 行：
   ```javascript
   const mapView = window.view;  // 改为实际的变量名
   ```

---

### 问题 4：后端连接失败

```
后端连接失败: Failed to fetch
```

**检查清单**：
- [ ] 后端运行中：`curl http://localhost:3001/health`
- [ ] 端口正确（3001）
- [ ] 没有防火墙阻止

---

## 📊 测试查询示例

### 树木查询
```
How many trees?
Show me maple trees
Find mature oak trees in Main Quad
```

### 建筑查询
```
Show me academic buildings
Where is Regenstein Library?
Find LEED certified buildings
```

### 设施查询
```
Where are all-gender restrooms?
Show me bike racks near Harper
Find parking near Crerar
```

---

## 🔧 高级：自定义注入脚本

如果需要修改注入脚本：

1. 编辑 `inject-backend.js`
2. 修改 API 端点（第 10 行）：
   ```javascript
   const API_BASE = 'http://localhost:3001';
   ```
3. 刷新浏览器（Ctrl+F5 强制刷新）

---

## ✅ 成功标准

- [ ] Console 显示 `[CampusGeo Backend] ✓ Ready!`
- [ ] 搜索框可输入
- [ ] 按回车触发后端查询
- [ ] Console 显示完整事件流
- [ ] 地图显示金色标记
- [ ] 右下角显示 AI 回答面板

**全部 ✓ = 最新前端已连接后端！**

---

## 📁 相关文件

| 文件 | 用途 |
|------|------|
| `CampusGeo Print-a-Map.html` | 原始设计稿（无后端） |
| `CampusGeo-with-Backend.html` | 注入后端版本 ✅ |
| `inject-backend.js` | 后端连接脚本 |
| `backend/dev-server/` | 后端服务器 |
| `test-frontend.html` | 简单测试工具 |

---

## 🎯 下一步

测试成功后：

1. **优化注入脚本**：更好地集成到原页面 UI
2. **创建生产版本**：修改 API_BASE 为生产 URL
3. **部署到 CloudFront**：Phase 1 完成后部署

---

**现在打开 `CampusGeo-with-Backend.html` 测试吧！** 🎉
