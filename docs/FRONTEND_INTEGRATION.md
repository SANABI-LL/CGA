# 前后端集成指南

本文档说明如何将 Claude Design 前端与 AWS Lambda 后端集成。

---

## 🎯 **核心流程**

```
用户提问 → 前端 API 调用 → Lambda Agent → Bedrock 推理 → 
工具调用 (S3 GeoJSON) → 返回结果 → 前端渲染地图
```

---

## 📡 **API 端点**

### **POST /api/agent**

**请求格式**：
```typescript
interface AgentRequest {
  query: string          // 用户查询，例如："去年种了多少棵树？"
  sessionId: string      // 会话 ID (用于跟踪上下文)
  userId?: string        // 可选：用户 ID
}
```

**响应格式** (Server-Sent Events 流式)：
```typescript
// Event: text
{
  type: 'text',
  content: '2023年种了45棵树'
}

// Event: tool_call
{
  type: 'tool_call',
  toolName: 'query_trees'
}

// Event: tool_result
{
  type: 'tool_result',
  toolName: 'query_trees',
  data: {
    summary: { totalCount: 45, topSpecies: [...] },
    features: { type: 'FeatureCollection', features: [...] }
  }
}

// Event: map_update (特殊事件，包含 GeoJSON)
{
  type: 'tool_result',
  toolName: 'query_trees',
  mapUpdate: {
    features: { type: 'FeatureCollection', features: [...] },
    center?: [lon, lat]
  }
}

// Event: done
{
  type: 'done'
}
```

---

## 🔌 **前端集成代码**

### **方式 1：使用现有的 API 客户端**

在你的 Claude Design HTML 中，添加这个 JavaScript：

```javascript
// 配置
const API_ENDPOINT = 'https://your-api-gateway-id.execute-api.us-east-1.amazonaws.com/prod/api/agent'

// SSE 客户端
async function queryAgent(userQuery) {
  const sessionId = getOrCreateSessionId()

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: userQuery,
      sessionId: sessionId
    })
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  // 处理流式响应
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let aiResponse = ''
  let mapFeatures = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6))

        switch (data.type) {
          case 'text':
            // 累积 AI 文本回复
            aiResponse += data.content
            updateChatUI(aiResponse)
            break

          case 'tool_result':
            // 检查是否有地图更新
            if (data.mapUpdate && data.mapUpdate.features) {
              mapFeatures = data.mapUpdate.features
              // 立即更新地图
              updateMapWithGeoJSON(mapFeatures)
            }
            break

          case 'done':
            // 查询完成
            console.log('Query completed')
            break
        }
      }
    }
  }

  return {
    text: aiResponse,
    features: mapFeatures
  }
}

// Session ID 管理
function getOrCreateSessionId() {
  let sessionId = sessionStorage.getItem('campusgeo_session_id')
  if (!sessionId) {
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    sessionStorage.setItem('campusgeo_session_id', sessionId)
  }
  return sessionId
}

// 更新地图 (假设你使用 ArcGIS Maps SDK 或 Leaflet)
function updateMapWithGeoJSON(geojson) {
  // 清除现有图层
  if (window.currentMapLayer) {
    map.remove(window.currentMapLayer)
  }

  // 添加新的 GeoJSON 图层
  window.currentMapLayer = L.geoJSON(geojson, {
    pointToLayer: (feature, latlng) => {
      return L.circleMarker(latlng, {
        radius: 6,
        fillColor: '#800000',  // UChicago maroon
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
      })
    },
    onEachFeature: (feature, layer) => {
      // 添加点击事件
      if (feature.properties) {
        layer.bindPopup(
          `<strong>${feature.properties.SPECIES || 'Unknown'}</strong><br>
           Planted: ${feature.properties.YEAR_PLANTED || 'N/A'}<br>
           Location: ${feature.properties.LOCATION || 'N/A'}`
        )
      }
    }
  }).addTo(map)

  // 自动缩放到图层范围
  map.fitBounds(window.currentMapLayer.getBounds(), { padding: [50, 50] })
}

// 更新聊天 UI
function updateChatUI(text) {
  const answerDiv = document.getElementById('ai-answer')
  if (answerDiv) {
    answerDiv.textContent = text
  }
}
```

---

### **方式 2：React 集成 (如果你的前端用 React)**

```typescript
// hooks/useAgentQuery.ts
import { useState, useCallback } from 'react'

interface MapUpdate {
  features: GeoJSON.FeatureCollection
  center?: [number, number]
}

export function useAgentQuery() {
  const [isLoading, setIsLoading] = useState(false)
  const [answer, setAnswer] = useState('')
  const [mapData, setMapData] = useState<MapUpdate | null>(null)
  const [error, setError] = useState<string | null>(null)

  const query = useCallback(async (userQuery: string) => {
    setIsLoading(true)
    setError(null)
    setAnswer('')
    setMapData(null)

    const sessionId = sessionStorage.getItem('campusgeo_session_id') ||
                      `session_${Date.now()}_${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem('campusgeo_session_id', sessionId)

    try {
      const response = await fetch(process.env.REACT_APP_API_ENDPOINT!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userQuery, sessionId })
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue

          const event = JSON.parse(line.slice(6))

          if (event.type === 'text') {
            setAnswer(prev => prev + event.content)
          } else if (event.type === 'tool_result' && event.mapUpdate) {
            setMapData(event.mapUpdate)
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { query, isLoading, answer, mapData, error }
}
```

**使用示例**：
```typescript
// components/QueryInterface.tsx
import { useAgentQuery } from '../hooks/useAgentQuery'
import { useEffect } from 'react'

export function QueryInterface() {
  const { query, isLoading, answer, mapData, error } = useAgentQuery()

  useEffect(() => {
    if (mapData) {
      // 更新地图
      updateMapWithGeoJSON(mapData.features)
      if (mapData.center) {
        map.setView(mapData.center, 16)
      }
    }
  }, [mapData])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const input = e.currentTarget.querySelector('input')
    if (input?.value) {
      query(input.value)
      input.value = ''
    }
  }

  return (
    <div className="query-interface">
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Ask about campus — e.g., '去年种了多少棵树？'"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Querying...' : 'Ask'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {answer && (
        <div className="answer">
          <h3>Answer:</h3>
          <p>{answer}</p>
        </div>
      )}

      {mapData && (
        <div className="map-info">
          <p>Displaying {mapData.features.features.length} features on map</p>
        </div>
      )}
    </div>
  )
}
```

---

## 🗺️ **地图渲染选项**

### **选项 1：ArcGIS Maps SDK for JavaScript**

```javascript
// 初始化地图
require([
  'esri/Map',
  'esri/views/MapView',
  'esri/layers/GeoJSONLayer'
], function(Map, MapView, GeoJSONLayer) {

  const map = new Map({
    basemap: 'gray-vector'  // 暖色调基础地图
  })

  const view = new MapView({
    container: 'mapDiv',
    map: map,
    center: [-87.5987, 41.7886],  // UChicago Main Quad
    zoom: 15
  })

  // 从 API 响应更新地图
  window.updateMapWithGeoJSON = function(geojson) {
    // 移除现有图层
    if (window.currentLayer) {
      map.remove(window.currentLayer)
    }

    // 创建临时 Blob URL
    const blob = new Blob([JSON.stringify(geojson)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    // 添加 GeoJSON 图层
    window.currentLayer = new GeoJSONLayer({
      url: url,
      renderer: {
        type: 'simple',
        symbol: {
          type: 'simple-marker',
          color: [128, 0, 0, 0.8],  // UChicago maroon
          size: 8,
          outline: { color: 'white', width: 1 }
        }
      },
      popupTemplate: {
        title: '{SPECIES}',
        content: 'Planted: {YEAR_PLANTED}<br>Location: {LOCATION}'
      }
    })

    map.add(window.currentLayer)

    // 缩放到图层范围
    window.currentLayer.when(() => {
      view.goTo(window.currentLayer.fullExtent.expand(1.2))
    })
  }
})
```

### **选项 2：Leaflet**

```javascript
// 初始化 Leaflet 地图
const map = L.map('map').setView([41.7886, -87.5987], 15)

// 添加基础地图 (暖色调)
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap © CartoDB'
}).addTo(map)

// 更新地图函数
window.updateMapWithGeoJSON = function(geojson) {
  if (window.currentLayer) {
    map.removeLayer(window.currentLayer)
  }

  window.currentLayer = L.geoJSON(geojson, {
    pointToLayer: (feature, latlng) => {
      return L.circleMarker(latlng, {
        radius: 6,
        fillColor: '#800000',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.8
      })
    },
    onEachFeature: (feature, layer) => {
      layer.bindPopup(`
        <strong>${feature.properties.SPECIES || 'Unknown'}</strong><br>
        Planted: ${feature.properties.YEAR_PLANTED || 'N/A'}<br>
        Location: ${feature.properties.LOCATION || 'N/A'}
      `)
    }
  }).addTo(map)

  map.fitBounds(window.currentLayer.getBounds(), { padding: [50, 50] })
}
```

---

## 🧪 **测试端到端流程**

### **1. 本地测试（开发环境）**

```bash
# 启动本地 dev-server
cd backend/dev-server
pnpm dev

# 前端指向本地 API
const API_ENDPOINT = 'http://localhost:3001/api/agent'
```

### **2. 测试查询示例**

```javascript
// 在浏览器控制台测试
queryAgent("去年种了多少棵树？").then(result => {
  console.log('Answer:', result.text)
  console.log('Features:', result.features)
})

// 预期输出：
// Answer: "2023年种了45棵树，主要分布在Main Quad区域。最多的树种是红橡树（12棵）..."
// Features: { type: "FeatureCollection", features: [...] }
```

### **3. 验证地图渲染**

打开浏览器开发者工具：
1. Network 标签：确认 SSE 流式响应
2. Console：检查是否有错误
3. 地图：应该看到树木点标记

---

## 📋 **完整示例查询**

| 用户问题 | Agent 调用的工具 | 返回数据 |
|---------|----------------|---------|
| "去年种了多少棵树？" | `query_trees({year: 2023})` | 45 棵树的 GeoJSON + 统计 |
| "Main Quad 有多少橡树？" | `query_trees({location: "Main Quad", species: "Oak"})` | 12 个点位 + 地图 |
| "Regenstein 附近的建筑" | `find_campus_nearby({referenceLocation: "Regenstein", featureType: "building"})` | 5-10 个建筑轮廓 |
| "最近的 Divvy 站点" | `get_bike_stations()` | 实时单车站点数据 |

---

## 🔒 **CORS 配置**

确保 API Gateway 允许你的前端域名：

```typescript
// backend/lambdas/ai-agent/handler.ts
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'

export const handler = awslambda.streamifyResponse(async (event, responseStream, context) => {
  const metadata = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,  // 关键！
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
  // ...
})
```

---

## 🚀 **部署清单**

- [ ] Lambda 部署成功（包含 queryTrees 工具）
- [ ] API Gateway 配置 CORS
- [ ] 前端 API_ENDPOINT 指向正确的 URL
- [ ] S3 树木 GeoJSON 文件已上传
- [ ] DynamoDB 表已创建
- [ ] 测试查询："去年种了多少棵树？"
- [ ] 地图正确渲染 GeoJSON 点位
- [ ] SSE 流式响应正常

---

## 📚 **相关文档**

- [Lambda Agent 架构](../backend/lambdas/ai-agent/README.md)
- [工具开发指南](./TOOL_DEVELOPMENT.md)
- [GeoJSON 上传指南](../scripts/README_UPLOAD.md)
- [API 参考](./API_REFERENCE.md)

---

**最后更新**: 2026-06-22  
**维护者**: CampusGeo Team
