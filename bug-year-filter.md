# Bug: "buildings before 1930" 返回全部建筑

前端无问题（它只是忠实渲染后端 `mapUpdate` 里的 features）。根因在后端，两处叠加：

## 根因 1（主因）：缺失年份被当成 0，全部通过 `< 1930`

`backend/lambdas/ai-agent/tools/campus/queryS3Layer.ts` → `filterByWhereClause()` 的数值分支：

```ts
const fieldValue = parseFloat(String(f.properties[field] || '0'))
```

`Year_Completed` 缺失或为空时 → `parseFloat('0')` = **0**，而 `0 < 1930` 为真，
于是**所有没有年份数据的建筑全部命中**。308 栋里大部分没有 `Year_Completed`，
所以结果看起来"返回了全部建筑"。

同时还有第二个坑：年份信息分散在两列（`getBuildingInfo.ts` 里的 `yearFrom()` 已经知道这件事）——
`Year_Completed` 是数字，`Year_Opened` 是 ISO 字符串（`"1970-10-01T…"`）。
只查 `Year_Completed` 会漏掉只有 `Year_Opened` 的建筑。

### 修复

```ts
// 数值比较：缺失值一律不参与比较（不能退化为 0）
const numMatch = clause.match(/(\w+)\s*([><=]+)\s*(\d+(\.\d+)?)/i)
if (numMatch) {
  const [, field, op, value] = numMatch
  const numValue = parseFloat(value)
  return features.filter((f) => {
    const raw = f.properties[field]
    if (raw == null || raw === '') return false          // 关键：缺失即排除
    const fieldValue = parseFloat(String(raw))
    if (Number.isNaN(fieldValue)) return false           // 非数字也排除
    if (op === '>') return fieldValue > numValue
    if (op === '<') return fieldValue < numValue
    if (op === '>=') return fieldValue >= numValue
    if (op === '<=') return fieldValue <= numValue
    if (op === '=') return fieldValue === numValue
    return false
  })
}
```

## 根因 2：不支持的 WHERE 静默返回全部

同文件末尾的 fallback：

```ts
console.warn(`Unsupported WHERE clause: ${clause}, returning all features`)
return features
```

这是 fail-open：模型只要写出解析器不认识的条件（含 `AND`／括号／`BETWEEN`），
就会静默拿到整层数据 —— 既是"结果不对"的隐形来源，也和 `_modelSummary`
限流的初衷相悖（曾发生 5491 棵树爆上下文）。建议改为 fail-closed：

```ts
console.warn(`Unsupported WHERE clause: ${clause}`)
return { unsupported: true } as never // 或让 queryS3Layer 返回
                                      // { error: 'Unsupported filter: ...' }
```

让 `queryS3Layer` 把它变成 `{ error }` 返回给模型，模型会改写条件重试，
而不是拿到 308 条就直接汇报。

## 建议补一个专用工具（更稳）

靠模型自己拼 WHERE 字符串本身就脆弱。建议加 `findBuildingsByYear`：

```ts
export const FindBuildingsByYearInputSchema = z.object({
  before: z.number().int().min(1850).max(2100).optional(),
  after: z.number().int().min(1850).max(2100).optional(),
  maxResults: z.number().int().min(1).max(200).optional().default(60),
}).strict()
```

实现里复用 `getBuildingInfo.ts` 已有的 `yearFrom(props)`（同时读 `Year_Completed`
和 `Year_Opened`），**年份未知的建筑一律排除**，并在返回里带上
`unknownYearCount`，让模型能如实说明"另有 N 栋建成年份缺失，未计入"。

## 验证

- "Buildings constructed before 1930" → 只返回有年份且 < 1930 的建筑；
  地图 feature 数应远小于 308
- "Buildings built after 2000" → 对称验证
- 故意问一个需要复合条件的问题（如 "buildings before 1930 over 50000 sqft"）
  → 应收到 unsupported 错误并让模型改写，而不是静默返回全部
