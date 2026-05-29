# UChicago GIS AI Agent - AWS 有状态代理架构

## 🎯 核心理念

**不是工具，是基础设施**
- ✅ 记住每个用户的空间工作流
- ✅ 跨会话保持上下文
- ✅ 主动感知数据变化
- ✅ 自动触发空间分析

---

## 🏗️ AWS 架构图

```
┌─────────────────────────────────────────────────────────┐
│                      用户层                              │
│  Web App (CloudFront + S3) / Mobile App                 │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   API Gateway (REST/WebSocket)           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    Lambda Functions                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐│
│  │  Query   │  │  Memory  │  │  Trigger │  │  Notify ││
│  │ Handler  │  │  Manager │  │  Engine  │  │ Service ││
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘│
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   状态存储层                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ DynamoDB     │  │ ElastiCache  │  │ S3           │ │
│  │ (用户状态)   │  │ (会话缓存)   │  │ (地图状态)   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    数据层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ RDS PostGIS  │  │ Aurora       │  │ EventBridge  │ │
│  │ (空间数据)   │  │ (分析数据)   │  │ (事件总线)   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                  外部服务                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Anthropic    │  │ SNS/SES      │  │ CloudWatch   │ │
│  │ (Claude API) │  │ (通知服务)   │  │ (监控)       │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 数据模型设计

### 1. 用户状态表 (DynamoDB)

```json
// users 表
{
  "userId": "user123",
  "profile": {
    "name": "John Doe",
    "role": "facilities_manager",
    "preferences": {
      "defaultLayers": ["trees", "buildings"],
      "defaultExtent": {
        "center": [-87.5987, 41.7896],
        "zoom": 15
      }
    }
  },
  "queryHistory": [
    {
      "timestamp": "2026-05-10T10:30:00Z",
      "query": "trees planted in 2024",
      "results": ["tree_001", "tree_002"],
      "extent": {...}
    }
  ],
  "subscriptions": [
    {
      "id": "sub_001",
      "type": "spatial_watch",
      "condition": {
        "layer": "trees",
        "bounds": {...},
        "trigger": "new_features"
      },
      "notification": "email"
    }
  ],
  "spatialBookmarks": [
    {
      "name": "Main Quad",
      "extent": {...},
      "layers": ["trees", "buildings"]
    }
  ],
  "createdAt": "2026-01-01T00:00:00Z",
  "lastActive": "2026-05-11T14:20:00Z"
}
```

### 2. 会话状态表 (DynamoDB)

```json
// sessions 表
{
  "sessionId": "sess_abc123",
  "userId": "user123",
  "currentContext": {
    "mapState": {
      "center": [-87.5987, 41.7896],
      "zoom": 16,
      "bearing": 45,
      "pitch": 60,
      "visibleLayers": ["trees", "buildings"],
      "selectedFeatures": ["building_001"]
    },
    "conversationHistory": [
      {
        "role": "user",
        "content": "Show me buildings over 50m",
        "timestamp": "2026-05-11T14:15:00Z"
      },
      {
        "role": "assistant",
        "content": "Found 3 buildings...",
        "queryPlan": {...},
        "results": [...]
      }
    ],
    "activeFilters": {
      "buildings": "height > 50"
    }
  },
  "expiresAt": 1746835200  // TTL
}
```

### 3. 空间订阅表 (DynamoDB)

```json
// subscriptions 表
{
  "subscriptionId": "sub_001",
  "userId": "user123",
  "type": "spatial_watch",
  "config": {
    "layer": "trees",
    "bounds": {
      "type": "Polygon",
      "coordinates": [[...]]
    },
    "conditions": {
      "event": "insert",
      "filter": "plant_year = 2024"
    }
  },
  "notification": {
    "method": "email",
    "frequency": "realtime",
    "template": "New trees planted in your watched area"
  },
  "status": "active",
  "lastTriggered": "2026-05-10T09:00:00Z"
}
```

### 4. 空间数据表 (RDS PostGIS)

```sql
-- trees 表
CREATE TABLE trees (
  id SERIAL PRIMARY KEY,
  species VARCHAR(100),
  plant_date DATE,
  plant_year INTEGER,
  location VARCHAR(200),
  steward VARCHAR(100),
  geom GEOMETRY(Point, 4326),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 空间索引
CREATE INDEX trees_geom_idx ON trees USING GIST (geom);

-- 触发器：数据变化时通知
CREATE OR REPLACE FUNCTION notify_data_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('data_changed', 
    json_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'id', NEW.id,
      'geom', ST_AsGeoJSON(NEW.geom)
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trees_change_trigger
AFTER INSERT OR UPDATE ON trees
FOR EACH ROW EXECUTE FUNCTION notify_data_change();
```

---

## ⚙️ Lambda Functions 设计

### 1. Query Handler (查询处理)

```javascript
// lambda/query-handler.js
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const anthropic = require('@anthropic-ai/sdk');

exports.handler = async (event) => {
  const { userId, sessionId, query } = JSON.parse(event.body);
  
  // 1. 获取用户上下文
  const userContext = await getUserContext(userId);
  const sessionContext = await getSessionContext(sessionId);
  
  // 2. 调用 Claude 理解查询
  const queryPlan = await interpretQuery(query, {
    userPreferences: userContext.preferences,
    mapState: sessionContext.mapState,
    queryHistory: userContext.queryHistory.slice(-5)
  });
  
  // 3. 执行空间查询
  const results = await executeGISQuery(queryPlan);
  
  // 4. 更新会话状态
  await updateSessionContext(sessionId, {
    query,
    queryPlan,
    results,
    mapState: calculateNewMapState(results)
  });
  
  // 5. 学习用户偏好
  await updateUserProfile(userId, {
    lastQuery: query,
    interestLayers: extractLayers(queryPlan),
    spatialFocus: calculateSpatialFocus(results)
  });
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      results,
      queryPlan,
      suggestions: generateSmartSuggestions(userContext, results)
    })
  };
};

// AI 查询理解（带上下文）
async function interpretQuery(query, context) {
  const prompt = `You are a GIS AI agent with memory.

User Query: "${query}"

User Context:
- Preferred layers: ${context.userPreferences.defaultLayers.join(', ')}
- Recent queries: ${context.queryHistory.map(h => h.query).join('; ')}
- Current map state: center ${context.mapState.center}, zoom ${context.mapState.zoom}
- Visible layers: ${context.mapState.visibleLayers.join(', ')}

Based on the user's history and current context, interpret this query and generate:
{
  "layer": "...",
  "queryType": "...",
  "whereClause": "...",
  "spatialFilter": {...},
  "explanation": "...",
  "contextualInsight": "Why this query matters based on user history"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });
  
  return JSON.parse(response.content[0].text);
}
```

### 2. Memory Manager (记忆管理)

```javascript
// lambda/memory-manager.js
exports.handler = async (event) => {
  const { userId, action, data } = JSON.parse(event.body);
  
  switch (action) {
    case 'create_bookmark':
      return await createSpatialBookmark(userId, data);
    
    case 'update_preferences':
      return await updateUserPreferences(userId, data);
    
    case 'get_context':
      return await getUserFullContext(userId);
    
    case 'create_subscription':
      return await createSpatialSubscription(userId, data);
  }
};

// 创建空间书签
async function createSpatialBookmark(userId, bookmarkData) {
  await dynamodb.update({
    TableName: 'users',
    Key: { userId },
    UpdateExpression: 'SET spatialBookmarks = list_append(spatialBookmarks, :bookmark)',
    ExpressionAttributeValues: {
      ':bookmark': [{
        id: generateId(),
        name: bookmarkData.name,
        extent: bookmarkData.extent,
        layers: bookmarkData.layers,
        createdAt: new Date().toISOString()
      }]
    }
  }).promise();
  
  return { success: true };
}

// 创建空间订阅
async function createSpatialSubscription(userId, subscription) {
  const subscriptionId = generateId();
  
  // 保存到 DynamoDB
  await dynamodb.put({
    TableName: 'subscriptions',
    Item: {
      subscriptionId,
      userId,
      type: subscription.type,
      config: subscription.config,
      notification: subscription.notification,
      status: 'active',
      createdAt: new Date().toISOString()
    }
  }).promise();
  
  // 注册 EventBridge 规则
  await registerEventBridgeRule(subscriptionId, subscription.config);
  
  return { subscriptionId, status: 'active' };
}
```

### 3. Trigger Engine (触发引擎)

```javascript
// lambda/trigger-engine.js
// 监听 PostgreSQL NOTIFY 或 DynamoDB Streams

const AWS = require('aws-sdk');
const sns = new AWS.SNS();

exports.handler = async (event) => {
  // 处理数据变化事件
  for (const record of event.Records) {
    const change = parseChangeEvent(record);
    
    // 查找受影响的订阅
    const affectedSubs = await findAffectedSubscriptions(change);
    
    // 触发通知
    for (const sub of affectedSubs) {
      await triggerNotification(sub, change);
    }
  }
};

// 查找受影响的订阅
async function findAffectedSubscriptions(change) {
  const { layer, geom, operation } = change;
  
  // 查询所有活跃订阅
  const subs = await dynamodb.query({
    TableName: 'subscriptions',
    IndexName: 'status-index',
    KeyConditionExpression: 'status = :status',
    ExpressionAttributeValues: {
      ':status': 'active'
    }
  }).promise();
  
  // 空间过滤
  return subs.Items.filter(sub => {
    if (sub.config.layer !== layer) return false;
    
    // PostGIS 空间查询
    return checkSpatialIntersection(geom, sub.config.bounds);
  });
}

// 发送通知
async function triggerNotification(subscription, change) {
  const user = await getUser(subscription.userId);
  
  if (subscription.notification.method === 'email') {
    await sns.publish({
      TopicArn: process.env.EMAIL_TOPIC_ARN,
      Message: generateEmailContent(subscription, change, user),
      Subject: `GIS Alert: ${change.operation} in ${change.layer}`
    }).promise();
  }
  
  // 更新最后触发时间
  await dynamodb.update({
    TableName: 'subscriptions',
    Key: { subscriptionId: subscription.subscriptionId },
    UpdateExpression: 'SET lastTriggered = :now',
    ExpressionAttributeValues: {
      ':now': new Date().toISOString()
    }
  }).promise();
}
```

### 4. Smart Suggestions (智能建议)

```javascript
// lambda/suggestions.js
exports.handler = async (event) => {
  const { userId } = JSON.parse(event.body);
  
  const userContext = await getUserContext(userId);
  
  // 基于历史生成建议
  const suggestions = await generateSuggestions(userContext);
  
  return {
    statusCode: 200,
    body: JSON.stringify(suggestions)
  };
};

async function generateSuggestions(context) {
  const suggestions = [];
  
  // 1. 常访问区域的更新
  const frequentAreas = analyzeFrequentAreas(context.queryHistory);
  for (const area of frequentAreas) {
    const updates = await checkAreaUpdates(area);
    if (updates.length > 0) {
      suggestions.push({
        type: 'area_update',
        message: `${updates.length} new features in ${area.name}`,
        action: 'view_updates',
        data: updates
      });
    }
  }
  
  // 2. 相关查询建议
  const relatedQueries = await findRelatedQueries(context.queryHistory);
  suggestions.push({
    type: 'related_query',
    queries: relatedQueries
  });
  
  // 3. 数据质量问题
  const qualityIssues = await detectDataQualityIssues(context.spatialFocus);
  if (qualityIssues.length > 0) {
    suggestions.push({
      type: 'data_quality',
      issues: qualityIssues
    });
  }
  
  return suggestions;
}
```

---

## 🔄 完整工作流示例

### 场景 1: 用户首次查询

```
1. 用户: "Show me trees planted in 2024"
   ↓
2. Query Handler:
   - 检查用户历史（空）
   - Claude 解析查询
   - 执行 PostGIS 查询
   - 返回结果
   ↓
3. Memory Manager:
   - 保存查询到 queryHistory
   - 标记用户兴趣: trees layer
   - 记录空间焦点区域
   ↓
4. 返回结果 + 建议订阅该区域
```

### 场景 2: 3天后，新树种植

```
1. PostGIS 触发器: 新行插入 trees 表
   ↓
2. Trigger Engine:
   - 接收 NOTIFY 事件
   - 检查空间订阅
   - 发现用户 "user123" 订阅了该区域
   ↓
3. Notification Service:
   - 发送邮件: "5 new trees planted in your watched area"
   - 推送 Web 通知
   ↓
4. 用户点击通知 → 自动加载地图到该区域
```

### 场景 3: 用户再次查询

```
1. 用户: "Show me"（不完整查询）
   ↓
2. Query Handler:
   - 加载用户上下文
   - 发现上次查询: trees
   - 发现空间焦点: Main Quad
   ↓
3. Claude 理解:
   "Based on your recent interest in trees near Main Quad,
    I'll show you the latest tree data in that area"
   ↓
4. 自动补全查询 → 返回结果
```

---

## 💰 AWS 成本估算

### 小规模（< 1000 用户）

| 服务 | 用量 | 月成本 |
|------|------|--------|
| Lambda | 100万次请求 | $0.20 |
| DynamoDB | 5GB + 100万读写 | $1.50 |
| RDS PostgreSQL | db.t3.micro | $15 |
| ElastiCache | cache.t3.micro | $12 |
| S3 + CloudFront | 10GB + 10万请求 | $5 |
| SNS/SES | 1000封邮件 | $0.10 |
| **总计** | | **~$35/月** |

### 中规模（1万用户）

| 服务 | 用量 | 月成本 |
|------|------|--------|
| Lambda | 1000万次请求 | $2 |
| DynamoDB | 50GB + 1000万读写 | $15 |
| RDS PostgreSQL | db.t3.small | $30 |
| ElastiCache | cache.t3.small | $25 |
| CloudFront | 100GB | $8 |
| **总计** | | **~$80/月** |

---

## 🚀 实施路线图

### Phase 1: 基础有状态能力（2周）

- [ ] DynamoDB 用户表 + 会话表
- [ ] Lambda Query Handler with context
- [ ] ElastiCache 会话缓存
- [ ] 基础 Memory Manager

### Phase 2: 空间订阅系统（2周）

- [ ] PostGIS 触发器
- [ ] DynamoDB 订阅表
- [ ] Trigger Engine Lambda
- [ ] SNS/SES 通知集成

### Phase 3: 智能建议引擎（2周）

- [ ] 查询历史分析
- [ ] 空间焦点识别
- [ ] 相关查询推荐
- [ ] 主动通知系统

### Phase 4: 高级功能（持续）

- [ ] 多用户协作
- [ ] 空间工作流自动化
- [ ] 预测性分析
- [ ] 时间序列空间分析

---

## 📊 监控和优化

### CloudWatch Metrics

```javascript
// 自定义指标
await cloudwatch.putMetricData({
  Namespace: 'GIS-Agent',
  MetricData: [
    {
      MetricName: 'ContextRecall',
      Value: contextHitRate,
      Unit: 'Percent'
    },
    {
      MetricName: 'QueryResponseTime',
      Value: responseTime,
      Unit: 'Milliseconds'
    },
    {
      MetricName: 'SubscriptionTriggers',
      Value: triggerCount,
      Unit: 'Count'
    }
  ]
}).promise();
```

### 性能优化

1. **缓存策略**
   - 用户上下文: ElastiCache (TTL 1小时)
   - 查询结果: CloudFront (TTL 5分钟)
   - 空间数据: PostGIS materialized views

2. **索引优化**
   - DynamoDB GSI: userId-lastActive
   - PostGIS GIST: 所有几何字段
   - ElastiCache: 会话 ID 键

3. **成本优化**
   - Lambda Provisioned Concurrency 仅在高峰时段
   - DynamoDB On-Demand 模式
   - S3 Intelligent Tiering

---

## 🎯 核心差异化

这套架构让你能对面试官说：

> "我设计了一个有状态的空间AI代理系统，能够：
> 1. 跨会话记住用户的空间工作流
> 2. 主动感知空间数据变化并推送通知
> 3. 基于历史行为提供智能空间建议
> 4. 在 AWS 上以 Serverless 架构部署，成本低于传统方案 70%"

**这在 GIS 行业几乎没人能做到。**

---

## 📚 相关文档

- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [DynamoDB Design Patterns](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [PostGIS Spatial Analysis](https://postgis.net/documentation/)
- [Anthropic Claude API](https://docs.anthropic.com/)
