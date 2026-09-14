# Bug: 树木估值字段 `EstValue` 未被识别

**归属：后端**（字段字典缺失；前端弹窗 / 表格 / 色阶已接）

## 现象

提问树木的 dollar value，回答说 "inventory does not include appraised monetary values per tree"，建议用户自己做 i-Tree / CTLA 评估。

但 `trees.geojson` 里 **`EstValue`** 列就是每棵树的估值（美元）。工具层没告诉模型这个字段存在，模型就按常识说"没有"。

## 这是同一类问题的第三次

| 字段 | 问题 | 结果 |
|---|---|---|
| `CHRS` | 被 allowlist 剥掉 | "没有历史评级数据" |
| `UChicagoIn` | 名字反直觉、无字典 | "没有 right-of-way 标记" |
| **`EstValue`** | **无字典** | **"没有估值数据"** |

模式一致：**数据在，语义不在。** 建议这次不只修 `EstValue`，把树图层的字段字典一次补全（见第 3 节）。

## 修复

### 1. 树工具的字段描述加 `EstValue`

> `EstValue` — appraised replacement value of the tree in US dollars (numeric).
> Use for "dollar value", "worth", "most valuable trees", totals and averages.
> Sum it for aggregate questions; sort descending for "most valuable" questions.

如果有 allowlist，确认 `EstValue` 在内。

### 2. 聚合能力检查

"Dollar value of each of those" 这类问题需要按 `UChicagoIn` 分组后**求和**。检查查询工具是否支持 `sum` / `avg` / `count` 聚合；如果只能返回要素列表让模型自己加，5,510 条会超 token 上限。需要的话加一个 `aggregate: { field, op, groupBy }` 参数——这和 top-N 排序是同一类"工具该做、不该让模型在文本里做"的事。

### 3. 顺带补全树图层字段字典

请 dump 一条树记录的全部 properties 键，逐个写含义。已知的：

| 字段 | 含义 |
|---|---|
| `TreeID` | 编号 |
| `CommonName` / `ScientName` | 俗名 / 学名 |
| `Condition` | 健康状况（Good / Fair / Poor / Dead…） |
| `AgeClass` | 龄级 |
| `CanRadius` | 冠幅半径（ft） |
| `DBH` / `DBH1` | 胸径（in） |
| `UChicagoIn` | 归属：空=校园树，有值=公共道路树（管理方） |
| `EstValue` | 估值（USD） |
| `TreeNotes` | 备注 |

其余未知字段请一并列出，不确定含义的标 "unknown"，**不要猜**（buildingFields.ts 的注释里有猜错字段名弄坏查询的先例）。

### 4. 系统提示

> Tree dollar values ARE in the inventory (`EstValue`, USD). Never say valuation data is
> unavailable. For "value of campus vs right-of-way trees", aggregate `EstValue` grouped
> by `UChicagoIn` empty/non-empty.

## 验证

1. `what is the total dollar value of campus trees vs right-of-way trees?` → 两个金额 + 总计
2. `show me the 10 most valuable trees on campus` → 10 棵，地图按估值渐变着色
3. `average value of a tree on the Midway` → 一个数字
4. 点任意一棵树 → 弹窗 "Appraised value $X,XXX"（前端已做）

## 前端已做

- 弹窗新增 **Appraised value** 行（美元格式）
- PDF 数据表新增 **Value ($)** 列
- `EstValue` 加入数值色阶候选：问 "valuable / worth / dollar / expensive" 时地图按估值冷→暖渐变，图例显示金额范围
