# 能力缺口：没有空间关系查询（within / intersects）

**归属：后端**（这是缺一个工具能力，不是提示词能修的）

## 现象

提问 `show me all buildings under subarea C`

- AI 回答："building layer 没有 SubArea 属性，所以无法按分区过滤"，并建议用户**肉眼在地图上交叉比对**
- 地图渲染 **242 FEATURES** = 1 个分区面 + 全部 241 栋建筑
- 结果对用户毫无用处：既没有筛出 C 内的建筑，又把全campus建筑都铺上去了

AI 的诊断是对的（建筑数据确实没有 `SubArea` 列），但它给出的方案——让用户自己看——说明**它没有可用的空间工具**。

## 根本问题

现有所有查询工具都是**属性过滤**：`field op value`。
没有任何**空间关系运算**。而"A 图层里落在 B 图层某个面内的要素"是 GIS 最基础的操作之一。

同类问题会出现在所有这些提问上，不只是分区：

- `buildings in Subarea C` / `trees in Subarea O`
- `bike racks within 200m of Regenstein`（有 nearby 工具，但只对单点）
- `utilities under the Main Quad`
- `what's inside the historic district boundary`
- `buildings within 500 ft of the Midway`

## 修复方案

### 1. 新工具 `spatialQuery`（核心）

新文件 `backend/lambdas/ai-agent/tools/campus/spatialQuery.ts`：

```ts
input: {
  targetLayer: z.string()
    .describe('Layer to return features FROM, e.g. buildings, trees, bike_parking'),
  withinLayer: z.string()
    .describe('Layer providing the containing boundary, e.g. subarea'),
  withinField: z.string().optional()
    .describe('Attribute selecting which boundary feature, e.g. SubArea'),
  withinValues: z.array(z.string()).optional()
    .describe('Which boundary values, e.g. ["C"]'),
  relation: z.enum(['within', 'intersects', 'centroid_within']).default('centroid_within'),
  targetFilter: z.object({ field: z.string(), op: z.string(), value: z.any() }).optional()
    .describe('Optional extra attribute filter on the target layer'),
  fields: z.array(z.string()).optional(),
}
```

实现要点：

- 两个图层都从 S3 读（已有 `queryS3Layer` 的读取 + 缓存逻辑，复用）
- **建筑用 `centroid_within` 作默认**：建筑面常常跨越分区边界，用严格 `within` 会漏掉边界上的楼，用 `intersects` 会把只碰到一个角的楼算进来。质心判定是规划实务里的常规做法。点图层（树、车架）三种关系等价。
- point-in-polygon 用 ray casting 自己实现即可（十几行，无需引入 turf.js 增加包体积）；`MultiPolygon` 逐个 ring 判定，注意内环（洞）要反向计数
- **返回体只含 target 图层的要素**，`mapUpdate` 里也只有它们。分区面**不要**混进去——除非加一个 `includeBoundary: boolean` 参数，默认 false。这条直接对应上一个 bug 的教训。
- 返回 `matchedIn: { field, values }` 和 `boundaryFeatureCount`，让 agent 能在文字里说清"C 内共 N 栋"

### 2. 顺带修数据：给建筑打上 SubArea 标签（一次性 ETL）

即使有了 `spatialQuery`，把分区标签**预先写进 buildings.geojson** 仍然值得——之后所有"按分区筛建筑"的查询都退化成普通属性过滤，快且不会出错。

在 `export_webmap_layers.py` 里加一步：读 Subarea.geojson，对每栋建筑做质心判定，写入 `SubArea` 属性，再上传。同时把 `SubArea` 加进 `buildingFields.ts` 的 `BUILDING_FIELD_ALLOWLIST`（否则会像 CHRS 那次一样被剥掉）。

两者不冲突：ETL 解决建筑这个高频场景，`spatialQuery` 解决树/车架/管线等其余图层和任意组合。

### 3. `agent.ts` 系统提示

> When a question combines a boundary with a feature type ("buildings in Subarea C",
> "trees on the Main Quad", "utilities under the quad"), use `spatial_query` — do NOT
> return the boundary polygon plus the entire target layer and ask the user to compare
> visually. If a spatial relationship cannot be computed, say so plainly rather than
> offering a manual workaround.

最后一句很重要：宁可明确说"做不到"，也不要把分析工作推回给用户——后者比拒答更伤信任。

## 验证

1. `show me all buildings under subarea C` → 只有 C 内的建筑，数量远小于 241
2. `trees in Subarea O` → 只有 O 内的树
3. `show me the campus subarea boundaries` → 14 个分区面（反向检查，不受影响）
4. `buildings in Subarea C built before 1930` → 空间 + 属性双过滤同时生效

## 前端配合（我这边）

拿到 `spatialQuery` 的返回形状后我加：

- 结果徽标标注空间上下文，例如 `18 FEATURES · IN SUBAREA C`，让用户确认筛选生效
- 若 `includeBoundary: true`，分区面走已有的虚线边界样式（不参与数值色阶）
- 空结果时的专用文案："Subarea C 内没有符合条件的要素"，而不是通用的 NO FEATURES MATCHED
