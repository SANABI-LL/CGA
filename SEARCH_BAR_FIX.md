# 前端搜索框问题修复

**日期**: 2026-06-25  
**问题**: 前端搜索框返回预设答案，没有真正调用后端 API

---

## 🐛 问题分析

### 问题 1：后端不过滤年份

**现象**: 
```
查询: "How many trees planted in 2024?"
返回: 5488 (所有树木，未按年份过滤)
```

**原因**: `queryTrees` 工具没有 `year` 参数

**解决**: ✅ **已修复** - 添加年份过滤逻辑

---

### 问题 2：前端搜索框使用预设答案

**现象**:
- 在搜索框输入查询 → 返回预设的 2025 树木信息
- 在 Console 输入 `window.testBackend(query)` → 调用真实后端

**原因**: `CampusGeo Print-a-Map.html` 是打包的静态原型，搜索框绑定了原型脚本，而不是 `inject-backend.js`

**解决**: 需要修改注入脚本的优先级

---

## ✅ 修复方案

### 修复 1: 后端年份过滤（已完成）

**文件**: `backend/lambdas/ai-agent/tools/campus/queryTrees.ts`

**新增功能**:
```typescript
// 新增参数
year: z.number().optional().describe('Year planted or last updated')

// 过滤逻辑
if (input.year) {
  filtered = filtered.filter(f => {
    const lastUpdate = f.properties.LastUpda  // "03/25/2026"
    const match = lastUpdate?.match(/(\d{4})/)
    const updateYear = match ? parseInt(match[1]) : null
    return updateYear === input.year
  })
}
```

**测试**:
```bash
# 重启后端
cd backend/dev-server
pnpm dev

# 在浏览器 Console 测试
window.testBackend('How many trees planted in 2026?')
window.testBackend('How many trees planted in 2024?')
```

---

### 修复 2: 前端搜索框劫持（需要实现）

#### 方案 A: 更激进的事件劫持（推荐）

修改 `inject-backend.js`，在事件捕获阶段拦截：

```javascript
function hookSearchInput() {
  const searchInput = document.querySelector('input[placeholder*="CampusGeo"]') ||
                      document.querySelector('input[placeholder*="campus"]');

  if (!searchInput) {
    setTimeout(hookSearchInput, 500);
    return;
  }

  console.log('[CampusGeo Backend] Found search input:', searchInput);

  // 使用 addEventListener 的第三个参数 { capture: true } 在捕获阶段拦截
  searchInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();  // 阻止所有其他监听器

      const query = searchInput.value.trim();
      if (query) {
        console.log('[CampusGeo Backend] Intercepted query:', query);
        await queryBackend(query);
      }
    }
  }, { capture: true });  // ← 关键：捕获阶段

  // 同样处理按钮点击
  const searchButton = searchInput.closest('form')?.querySelector('button') ||
                       document.querySelector('button[type="submit"]');

  if (searchButton) {
    searchButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const query = searchInput.value.trim();
      if (query) {
        await queryBackend(query);
      }
    }, { capture: true });
  }
}
```

**原理**: 
- 事件传播顺序：**捕获阶段** → 目标阶段 → 冒泡阶段
- 原型脚本可能在目标阶段或冒泡阶段监听
- 我们在捕获阶段拦截并 `stopImmediatePropagation()`，阻止事件到达原型脚本

---

#### 方案 B: 移除原有事件监听器

更暴力的方法：克隆输入框，替换原有元素（丢弃所有旧监听器）

```javascript
function hookSearchInput() {
  const searchInput = document.querySelector('input[placeholder*="CampusGeo"]');

  if (!searchInput) {
    setTimeout(hookSearchInput, 500);
    return;
  }

  // 克隆节点（不包括事件监听器）
  const newInput = searchInput.cloneNode(true);

  // 替换原节点
  searchInput.parentNode.replaceChild(newInput, searchInput);

  // 在新节点上绑定我们的监听器
  newInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = newInput.value.trim();
      if (query) {
        await queryBackend(query);
      }
    }
  });

  console.log('[CampusGeo Backend] Replaced search input with backend version');
}
```

**原理**: 克隆 DOM 节点不会复制事件监听器，所以原型脚本的监听器被清除

---

#### 方案 C: 覆盖原型脚本的全局变量

如果原型脚本使用全局变量或函数处理搜索，我们可以覆盖它：

```javascript
// 在页面加载早期运行（在原型脚本之前）
window.handleSearch = async function(query) {
  console.log('[CampusGeo Backend] Intercepted handleSearch:', query);
  return await queryBackend(query);
};

// 或者覆盖 fetch
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const url = args[0];
  
  // 如果是原型的 API 调用，重定向到我们的后端
  if (url && url.includes('/api/prototype')) {
    console.log('[CampusGeo Backend] Redirecting prototype API to real backend');
    args[0] = 'http://localhost:3001/api/agent';
  }
  
  return originalFetch.apply(this, args);
};
```

---

## 🧪 测试步骤

### 1. 测试后端年份过滤

**在浏览器 Console 运行**:

```javascript
// 测试 2026 年的树
window.testBackend('How many trees planted in 2026?')

// 测试 2024 年的树
window.testBackend('How many trees planted in 2024?')

// 测试 2025 年的树
window.testBackend('How many trees planted in 2025?')
```

**预期结果**: 
- 不同年份返回不同的数量
- Console 显示实际过滤后的特征数

---

### 2. 测试搜索框拦截

**方式 A: 刷新页面后测试**

1. 刷新 `CampusGeo-with-Backend.html`
2. 等待 Console 显示：`[CampusGeo Backend] ✓ Ready!`
3. 在搜索框输入：`How many trees planted in 2024?`
4. 按回车

**预期结果**:
- Console 显示：`[CampusGeo Backend] Intercepted query: ...`
- 地图更新显示过滤后的树木
- 答案面板显示正确的数量（不是预设的 2025 数据）

**方式 B: 如果搜索框仍然不工作**

在 Console 运行：
```javascript
// 直接测试后端
window.testBackend('How many trees planted in 2024?')
```

---

## 📊 验证数据正确性

### 检查 GeoJSON 中的年份分布

```bash
# 下载数据
aws s3 cp s3://campusgeo-geodata-491117467175/layers/trees.geojson /tmp/trees.geojson --region us-east-1

# 统计年份分布
cat /tmp/trees.geojson | python3 -c "
import sys, json
from collections import Counter

data = json.load(sys.stdin)
years = []

for f in data['features']:
    last_update = f['properties'].get('LastUpda', '')
    if last_update:
        # 提取年份
        import re
        match = re.search(r'(\d{4})', last_update)
        if match:
            years.append(match.group(1))

counter = Counter(years)
for year, count in sorted(counter.items()):
    print(f'{year}: {count} 棵树')
"
```

**预期输出**:
```
2024: 123 棵树
2025: 456 棵树
2026: 4909 棵树
```

---

## 🔧 下一步优化

### 1. 完全替换原型脚本（推荐）

创建一个**完全重写**的前端版本：

```bash
# 从 apps/web (React) 构建生产版本
cd apps/web
pnpm build

# 生成静态 HTML
# 输出到 dist/ 目录
```

然后手动注入后端连接代码。

---

### 2. 使用 Chrome 扩展注入

创建一个 Chrome 扩展，自动在加载 `CampusGeo Print-a-Map.html` 时注入后端脚本：

**manifest.json**:
```json
{
  "manifest_version": 3,
  "name": "CampusGeo Backend Injector",
  "version": "1.0",
  "content_scripts": [{
    "matches": ["file://*/CampusGeo*"],
    "js": ["inject-backend.js"],
    "run_at": "document_start"
  }]
}
```

---

### 3. 部署到生产环境

**Phase 1 完成后**：

1. 部署 Lambda + API Gateway
2. 更新 `inject-backend.js` 的 API_BASE：
   ```javascript
   const API_BASE = 'https://your-api-gateway-id.amazonaws.com/prod'
   ```
3. 部署前端到 CloudFront + S3

---

## ✅ 临时解决方案（现在立即可用）

**最简单的方法**：

1. **打开** `CampusGeo-with-Backend.html`
2. **按 F12** 打开 Console
3. **忽略搜索框**，直接在 Console 输入：
   ```javascript
   window.testBackend('How many trees planted in 2024?')
   ```

这样可以**完全绕过前端搜索框**，直接调用后端 API。

---

## 📝 总结

| 问题 | 状态 | 解决方案 |
|------|------|---------|
| 后端不过滤年份 | ✅ **已修复** | 添加 `year` 参数到 queryTrees |
| 搜索框使用预设答案 | ⚠️ **部分解决** | 使用 Console `window.testBackend()` |
| 搜索框事件拦截 | 🔄 **待实现** | 方案 A (捕获阶段) 或方案 B (克隆节点) |

**当前最佳实践**：
- 使用 `window.testBackend(query)` 测试后端功能
- 后端年份过滤已正常工作
- 前端搜索框集成需要进一步调试

---

**立即测试**：

```javascript
// 在浏览器 Console 运行
window.testBackend('How many trees planted in 2026?')
window.testBackend('How many trees planted in 2024?')
```
