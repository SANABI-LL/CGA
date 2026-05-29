# 有状态 GIS AI Agent - 实施指南

## 🎯 三层记忆系统

### 第一层：记住"人"（User Memory）

**实现示例:**

```javascript
// lambda/handlers/user-memory.js
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

class UserMemory {
  async getUserContext(userId) {
    const user = await dynamodb.get({
      TableName: 'gis_users',
      Key: { userId }
    }).promise();
    
    return {
      profile: user.Item?.profile || {},
      preferences: user.Item?.preferences || this.getDefaultPreferences(),
      queryHistory: user.Item?.queryHistory || [],
      spatialInterests: user.Item?.spatialInterests || []
    };
  }
  
  async updateUserLearning(userId, query, results) {
    // 1. 提取用户兴趣
    const interests = this.extractInterests(query, results);
    
    // 2. 更新偏好
    await dynamodb.update({
      TableName: 'gis_users',
      Key: { userId },
      UpdateExpression: `
        SET queryHistory = list_append(if_not_exists(queryHistory, :empty), :newQuery),
            spatialInterests = :interests,
            lastActive = :now
      `,
      ExpressionAttributeValues: {
        ':empty': [],
        ':newQuery': [{
          query,
          timestamp: Date.now(),
          layersUsed: this.extractLayers(query),
          spatialExtent: this.calculateExtent(results)
        }],
        ':interests': interests,
        ':now': Date.now()
      }
    }).promise();
  }
  
  extractInterests(query, results) {
    // AI 分析用户兴趣
    const layers = this.extractLayers(query);
    const spatialFocus = this.analyzeSpatialFocus(results);
    
    return {
      preferredLayers: layers,
      focusAreas: spatialFocus,
      queryPatterns: this.identifyPatterns(query)
    };
  }
}

module.exports = UserMemory;
```

---

### 第二层：记住"空间上下文"（Spatial Session）

**实现示例:**

```javascript
// lambda/handlers/spatial-session.js
const AWS = require('aws-sdk');
const elasticache = new AWS.ElastiCache();
const redis = require('redis');

class SpatialSession {
  constructor() {
    this.redis = redis.createClient({
      host: process.env.ELASTICACHE_ENDPOINT
    });
  }
  
  async saveMapState(sessionId, mapState) {
    const state = {
      center: mapState.center,
      zoom: mapState.zoom,
      bearing: mapState.bearing,
      pitch: mapState.pitch,
      visibleLayers: mapState.visibleLayers,
      selectedFeatures: mapState.selectedFeatures,
      activeFilters: mapState.activeFilters,
      timestamp: Date.now()
    };
    
    // 保存到 Redis，1小时过期
    await this.redis.setex(
      `session:${sessionId}`,
      3600,
      JSON.stringify(state)
    );
    
    return state;
  }
  
  async getMapState(sessionId) {
    const state = await this.redis.get(`session:${sessionId}`);
    return state ? JSON.parse(state) : null;
  }
  
  async appendConversation(sessionId, message) {
    const key = `conversation:${sessionId}`;
    await this.redis.rpush(key, JSON.stringify({
      ...message,
      timestamp: Date.now()
    }));
    await this.redis.expire(key, 3600);
  }
  
  async getConversationHistory(sessionId) {
    const key = `conversation:${sessionId}`;
    const messages = await this.redis.lrange(key, 0, -1);
    return messages.map(m => JSON.parse(m));
  }
}

module.exports = SpatialSession;
```

**前端集成:**

```javascript
// frontend/src/hooks/useSpatialSession.js
import { useEffect, useRef } from 'react';

export function useSpatialSession(map, sessionId) {
  const lastState = useRef(null);
  
  // 监听地图状态变化
  useEffect(() => {
    if (!map) return;
    
    const saveState = debounce(async () => {
      const currentState = {
        center: map.getCenter().toArray(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        visibleLayers: getVisibleLayers(map),
        selectedFeatures: getSelectedFeatures(map)
      };
      
      // 只有状态真正变化时才保存
      if (JSON.stringify(currentState) !== JSON.stringify(lastState.current)) {
        await fetch('/api/session/save-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, mapState: currentState })
        });
        
        lastState.current = currentState;
      }
    }, 500);
    
    // 监听所有地图事件
    map.on('moveend', saveState);
    map.on('zoomend', saveState);
    map.on('click', saveState);
    
    return () => {
      map.off('moveend', saveState);
      map.off('zoomend', saveState);
      map.off('click', saveState);
    };
  }, [map, sessionId]);
  
  // 恢复会话
  const restoreSession = async () => {
    const response = await fetch(`/api/session/${sessionId}`);
    const { mapState } = await response.json();
    
    if (mapState) {
      map.jumpTo({
        center: mapState.center,
        zoom: mapState.zoom,
        bearing: mapState.bearing,
        pitch: mapState.pitch
      });
      
      // 恢复图层可见性
      mapState.visibleLayers.forEach(layerId => {
        map.setLayoutProperty(layerId, 'visibility', 'visible');
      });
      
      // 恢复选中要素
      if (mapState.selectedFeatures.length > 0) {
        highlightFeatures(map, mapState.selectedFeatures);
      }
    }
  };
  
  return { restoreSession };
}
```

---

### 第三层：主动触发（Proactive Agent）

**实现示例:**

```javascript
// lambda/triggers/spatial-watcher.js
const { Pool } = require('pg');
const AWS = require('aws-sdk');
const sns = new AWS.SNS();

// PostgreSQL 连接
const pool = new Pool({
  host: process.env.RDS_ENDPOINT,
  database: 'campus_gis',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// 监听 PostgreSQL NOTIFY
exports.handler = async (event) => {
  const client = await pool.connect();
  
  try {
    // 订阅数据变化通知
    await client.query('LISTEN data_changed');
    
    client.on('notification', async (msg) => {
      const change = JSON.parse(msg.payload);
      console.log('Data change detected:', change);
      
      // 查找受影响的订阅
      const affectedSubs = await findAffectedSubscriptions(change);
      
      // 触发通知
      for (const sub of affectedSubs) {
        await notifyUser(sub, change);
      }
    });
    
  } finally {
    client.release();
  }
};

async function findAffectedSubscriptions(change) {
  const { table, operation, geom } = change;
  
  // 查询所有相关订阅
  const client = await pool.connect();
  
  const result = await client.query(`
    SELECT s.*, u.email, u.name
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    WHERE s.layer_name = $1
      AND s.status = 'active'
      AND ST_Intersects(
        ST_GeomFromGeoJSON($2),
        s.bounds
      )
  `, [table, JSON.stringify(geom)]);
  
  client.release();
  return result.rows;
}

async function notifyUser(subscription, change) {
  const { user_id, email, notification_config } = subscription;
  
  // 构建通知消息
  const message = buildNotificationMessage(subscription, change);
  
  // 发送邮件
  if (notification_config.email) {
    await sns.publish({
      TopicArn: process.env.EMAIL_TOPIC_ARN,
      Message: JSON.stringify({
        to: email,
        subject: `GIS Alert: ${change.operation} in ${change.table}`,
        body: message
      })
    }).promise();
  }
  
  // 发送 WebSocket 推送
  if (notification_config.realtime) {
    await sendWebSocketMessage(user_id, {
      type: 'spatial_alert',
      data: change,
      message
    });
  }
  
  // 记录触发
  await logTrigger(subscription.id, change);
}

function buildNotificationMessage(subscription, change) {
  const { table, operation, attributes } = change;
  
  return `
    <h2>Spatial Alert</h2>
    <p><strong>Action:</strong> ${operation}</p>
    <p><strong>Layer:</strong> ${table}</p>
    <p><strong>Details:</strong></p>
    <ul>
      ${Object.entries(attributes).map(([k, v]) => 
        `<li>${k}: ${v}</li>`
      ).join('')}
    </ul>
    <p><a href="${process.env.APP_URL}/map?highlight=${change.id}">View on Map</a></p>
  `;
}
```

**订阅创建接口:**

```javascript
// lambda/api/create-subscription.js
exports.handler = async (event) => {
  const { userId, subscription } = JSON.parse(event.body);
  
  // 验证用户权限
  await validateUser(userId);
  
  // 创建订阅
  const subId = await createSubscription({
    userId,
    layerName: subscription.layer,
    bounds: subscription.bounds,
    conditions: subscription.conditions,
    notification: {
      email: subscription.notifyEmail,
      realtime: subscription.notifyRealtime,
      frequency: subscription.frequency || 'realtime'
    }
  });
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      subscriptionId: subId,
      status: 'active',
      message: 'Subscription created successfully'
    })
  };
};

async function createSubscription(config) {
  const client = await pool.connect();
  
  try {
    const result = await client.query(`
      INSERT INTO subscriptions (
        user_id, 
        layer_name, 
        bounds, 
        conditions, 
        notification_config,
        status
      ) VALUES ($1, $2, ST_GeomFromGeoJSON($3), $4, $5, 'active')
      RETURNING id
    `, [
      config.userId,
      config.layerName,
      JSON.stringify(config.bounds),
      JSON.stringify(config.conditions),
      JSON.stringify(config.notification)
    ]);
    
    return result.rows[0].id;
  } finally {
    client.release();
  }
}
```

---

## 🎯 智能建议系统

```javascript
// lambda/suggestions/smart-suggestions.js
const AWS = require('aws-sdk');
const anthropic = require('@anthropic-ai/sdk');

class SmartSuggestions {
  async generateSuggestions(userId) {
    // 1. 获取用户上下文
    const context = await this.getUserFullContext(userId);
    
    // 2. 分析模式
    const patterns = this.analyzePatterns(context);
    
    // 3. 生成建议
    const suggestions = [];
    
    // 建议 A: 基于查询历史
    if (context.queryHistory.length > 0) {
      const relatedQueries = await this.findRelatedQueries(context.queryHistory);
      suggestions.push({
        type: 'related_query',
        title: 'You might also want to explore',
        queries: relatedQueries
      });
    }
    
    // 建议 B: 数据更新通知
    const updates = await this.checkAreaUpdates(patterns.frequentAreas);
    if (updates.length > 0) {
      suggestions.push({
        type: 'area_update',
        title: 'New data in areas you frequently visit',
        updates
      });
    }
    
    // 建议 C: 创建订阅
    if (!context.subscriptions || context.subscriptions.length === 0) {
      suggestions.push({
        type: 'create_subscription',
        title: 'Get notified about changes',
        recommendation: this.recommendSubscription(patterns)
      });
    }
    
    // 建议 D: 空间书签
    if (patterns.frequentAreas.length > 0 && !this.hasBookmark(context, patterns.frequentAreas[0])) {
      suggestions.push({
        type: 'create_bookmark',
        title: 'Save this view',
        area: patterns.frequentAreas[0]
      });
    }
    
    return suggestions;
  }
  
  analyzePatterns(context) {
    const queries = context.queryHistory;
    
    // 提取频繁访问区域
    const areaFrequency = {};
    queries.forEach(q => {
      const key = this.hashExtent(q.spatialExtent);
      areaFrequency[key] = (areaFrequency[key] || 0) + 1;
    });
    
    const frequentAreas = Object.entries(areaFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, count]) => ({
        extent: this.unhashExtent(key),
        frequency: count
      }));
    
    // 提取常用图层
    const layerUsage = {};
    queries.forEach(q => {
      q.layersUsed.forEach(layer => {
        layerUsage[layer] = (layerUsage[layer] || 0) + 1;
      });
    });
    
    return {
      frequentAreas,
      preferredLayers: Object.entries(layerUsage)
        .sort((a, b) => b[1] - a[1])
        .map(([layer]) => layer)
    };
  }
  
  async findRelatedQueries(history) {
    // 使用 Claude 生成相关查询
    const recentQueries = history.slice(-5).map(h => h.query);
    
    const prompt = `Based on these recent GIS queries:
${recentQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Suggest 3 related queries that would provide additional spatial insights.
Return only JSON array: ["query1", "query2", "query3"]`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });
    
    return JSON.parse(response.content[0].text);
  }
}

module.exports = SmartSuggestions;
```

---

## 🚀 部署脚本

```bash
#!/bin/bash
# deploy.sh - 完整 AWS 部署脚本

set -e

echo "🚀 Deploying GIS AI Agent with Stateful Memory..."

# 1. 创建 DynamoDB 表
echo "📊 Creating DynamoDB tables..."
aws dynamodb create-table \
  --table-name gis_users \
  --attribute-definitions \
    AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

aws dynamodb create-table \
  --table-name gis_sessions \
  --attribute-definitions \
    AttributeName=sessionId,AttributeType=S \
  --key-schema AttributeName=sessionId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --time-to-live-specification Enabled=true,AttributeName=expiresAt

aws dynamodb create-table \
  --table-name gis_subscriptions \
  --attribute-definitions \
    AttributeName=subscriptionId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=subscriptionId,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"userId-index","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

# 2. 创建 RDS PostgreSQL + PostGIS
echo "🗄️ Creating RDS PostgreSQL..."
aws rds create-db-instance \
  --db-instance-identifier campus-gis-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 14.7 \
  --master-username postgres \
  --master-user-password $DB_PASSWORD \
  --allocated-storage 20 \
  --publicly-accessible false

# 等待 RDS 就绪
aws rds wait db-instance-available --db-instance-identifier campus-gis-db

# 3. 安装 PostGIS
echo "🌍 Installing PostGIS..."
# 连接到 RDS 并执行
psql -h $RDS_ENDPOINT -U postgres -d postgres -c "CREATE EXTENSION postgis;"

# 4. 创建 ElastiCache Redis
echo "💾 Creating ElastiCache Redis..."
aws elasticache create-cache-cluster \
  --cache-cluster-id gis-session-cache \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --num-cache-nodes 1

# 5. 部署 Lambda 函数
echo "⚡ Deploying Lambda functions..."
cd lambda
zip -r query-handler.zip query-handler.js node_modules/
zip -r memory-manager.zip memory-manager.js node_modules/
zip -r trigger-engine.zip trigger-engine.js node_modules/

aws lambda create-function \
  --function-name gis-query-handler \
  --runtime nodejs18.x \
  --role $LAMBDA_ROLE_ARN \
  --handler query-handler.handler \
  --zip-file fileb://query-handler.zip \
  --environment Variables="{ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY,RDS_ENDPOINT=$RDS_ENDPOINT}"

# 6. 创建 API Gateway
echo "🌐 Creating API Gateway..."
aws apigatewayv2 create-api \
  --name gis-agent-api \
  --protocol-type HTTP \
  --target arn:aws:lambda:us-east-1:ACCOUNT_ID:function:gis-query-handler

# 7. 部署前端
echo "🎨 Deploying frontend..."
cd ../frontend
npm run build
aws s3 sync build/ s3://gis-agent-frontend
aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_ID --paths "/*"

echo "✅ Deployment complete!"
echo "🔗 API URL: https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com"
echo "🔗 Frontend: https://YOUR_CLOUDFRONT_DOMAIN"
```

---

## 📝 总结

这套架构实现了：

1. **记住人** - 用户偏好、查询历史、空间兴趣
2. **记住空间** - 地图状态、会话上下文、空间书签
3. **主动行动** - 数据变化监听、智能通知、建议生成

**这不是工具，是基础设施。**

下一步：开始实施 Phase 1！
