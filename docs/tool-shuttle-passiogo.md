# Tool: 校园巴士实时位置与到站预测（Passio GO）

**归属：后端**（新数据源接入；前端在文末有一小段配合）

## 现状

`get_shuttle_arrivals`（或同名工具）目前指向 TransLoc，返回 mock 数据并在回答里自述"live TransLoc API key is not configured"。
**TransLoc 已废弃**：芝大 2024 年 3 月起迁移到 Passio GO，TransLoc 于 2024-08-01 停用。所以不是缺 key 的问题，是数据源整个换了。

## 数据源

Passio GO 没有公开的官方 API，但有两条可用路径，都不需要 key：

### 路径 A：GTFS-Realtime（推荐主路径）
标准协议、CORS 开放、一个请求拿到所有车辆 / 所有到站预测。
- 车辆位置 `VehiclePositions`、到站预测 `TripUpdates`、服务公告 `ServiceAlerts`，均为 protobuf，用 `gtfs-realtime-bindings` 解析
- 静态 GTFS zip（路线 polyline、站点、时刻表）约 20 KB，按 ETag 缓存，`feed_end_date` 过期后需重取
- 具体 feed URL 请在 Lambda 里对 `https://passiogo.com` 的 UChicago 页面（`uchicago.passiogo.com` 或 system id 1068）抓一次网络请求确认；`nhausspiegel/busbus` 仓库（Brown 用同一供应商）记录了完整发现方法

### 路径 B：私有 JSON 端点（兜底 / 补充）
`https://passiogo.com/mapGetData.php`，未文档化但被多个开源项目稳定使用：

| 用途 | 调用 | 参数 |
|---|---|---|
| 路线列表 | `POST ?getRoutes=1` | `{"systemSelected0":"1068","amount":1}` |
| 站点 + 路线 polyline | `POST ?getStops=2` | `{"s0":"1068","sA":1}` |
| 实时车辆 | `POST ?getBuses=2` | `{"s0":"1068","sA":1}` |
| 某站到站预测 | `GET ?eta=3&stopIds=<id>&routeId=<id>` | — |
| 服务公告 | `POST goServices.php?getAlertMessages=1` | `{"systemSelected0":"1068","amount":1,"routesAmount":0}` |

**UChicago system id = 1068**（username `chicago`，品牌色 `#843c39`）。
注意：这些端点带 `appVersion` 参数（getBuses=2、getRoutes=1、schedule=4），Passio 会不定期升版，要在代码里集中配置、便于改。

## 工具设计

### 1. 静态数据 ETL（一次性 + 每周刷新）
把 UChicago 的站点和路线写进 S3 作为普通图层：
- `layers/shuttle_stops.geojson` — Point，属性 `StopID`、`Name`、`Routes[]`
- `layers/shuttle_routes.geojson` — LineString，属性 `RouteID`、`Name`、`ShortName`、`Color`（Passio 的 `groupColor`）

注册到 `queryS3Layer.ts` / `queryCampusLayer.ts` / `digest.ts`（同 Subarea 那次的三处），`nameFields` 用 `['Name']`。
这样"Logan Center 附近有哪个巴士站"、"NightRide 走哪条路"这类问题走现有管线，不需要实时调用。

### 2. 新工具 `getShuttleArrivals`
替换现有 TransLoc 版本：

```ts
input: {
  stopName: z.string().optional().describe('Stop name or nearby building, e.g. "Logan Center", "Regenstein"'),
  routeName: z.string().optional().describe('Filter to one route, e.g. "Red Line/Arts Block", "NightRide North"'),
  limit: z.number().int().min(1).max(10).default(5),
}
```

逻辑：
1. `stopName` 模糊匹配 `shuttle_stops.geojson`（归一化；找不到时按建筑坐标取最近 2 个站）
2. 拉 `TripUpdates`（或 `eta=3`），筛出该站的预测，按到达时间排序取 `limit` 条
3. 同时拉 `VehiclePositions`，把预测里出现的车辆位置附上
4. 返回：

```ts
{
  found: true,
  stop: { id, name, lat, lon },
  fetchedAt: ISO,                      // 前端要显示"X 秒前"
  source: 'passiogo-gtfsrt' | 'passiogo-json',
  arrivals: [{
    routeId, routeName, routeShortName, routeColor,
    vehicleId, vehicleLabel,
    etaSeconds, etaText,                // "4 min"
    scheduled: bool,                    // 是否只有时刻表、没有实时
    vehicle: { lat, lon, bearing, speed } | null,
  }],
  alerts: [{ title, body, routeIds[] }],   // 改线 / 停运公告
  mapUpdate: FeatureCollection,        // 见下
  _mapFocus: null,
}
```

`mapUpdate` 里放三类要素：
- 目标站点（Point，`_kind: 'stop'`）
- 涉及路线的 polyline（LineString，`_kind: 'route'`，带 `Color`）
- 预测里出现的车辆位置（Point，`_kind: 'vehicle'`，带 `bearing`、`etaText`、`routeColor`）

### 3. 新工具 `getShuttlePositions`（可选，第二步再做）
"现在有多少车在跑"、"NightRide 的车现在在哪"这类问题。只拉 `VehiclePositions`，全部车辆上图。

### 4. 系统提示

> Shuttle data comes from Passio GO (the university's live tracker since 2024). When a
> shuttle question names a place, call `get_shuttle_arrivals` with that place as `stopName`.
> Always state when the data was fetched. If `arrivals` is empty during service hours, say
> so and point the user to passiogo.com — never fabricate arrival times. Overnight and on
> university holidays an empty vehicle list is normal, not an error.

### 5. 缓存与限流
- 静态 GTFS / 站点路线：S3 缓存 7 天，ETag 校验
- `VehiclePositions` / `TripUpdates`：Lambda 内存缓存 **10 秒**——多个用户同时问不会打爆上游，又足够实时
- 上游失败：返回 `found: false, reason: 'upstream_unavailable'`，**不要退回 mock**——现有 mock 数据已经在回答里造成"4 min"这种看似真实的假数字

### 6. 删掉 TransLoc 残留
- 删除 TransLoc 相关代码和 env var
- 删掉那条 "live TransLoc API key is not configured" 的 mock 提示——它现在会误导用户去找一个不存在的 key

## 验证

1. `when will the next shuttle arrive at Logan Center?` → 真实到站时间 + 地图上有站点 / 路线 / 车辆
2. `where are the NightRide shuttles right now?` → 车辆位置上图
3. `is there any shuttle detour today?` → alerts 列表
4. 凌晨 3 点问第 1 问 → 明确说明当前无车、给出首班时间，不返回空白也不编数字

## 前端配合（我这边，拿到返回形状后做）

- 站点 / 路线 / 车辆三类要素各自样式：站点小圆点、路线按 `Color` 描边、车辆用带 `bearing` 旋转的箭头符号，车辆点带 `etaText` 标注
- 到站卡：路线色条 + 车辆号 + ETA，`scheduled: true` 的行灰显并标注 "scheduled"，右上角 "Updated 12s ago"
- **自动刷新**：到站卡显示期间每 15 秒重新拉一次（前端直接 re-ask 同一问题成本太高——建议后端暴露一个轻量 `GET /api/shuttle/arrivals?stopId=` 端点绕过 agent，前端定时拉这个）
- 公告条：有 alerts 时在卡片顶部显示琥珀色横条
