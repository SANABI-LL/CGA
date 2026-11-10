# Bug: 树木图层的 right-of-way 归属没有被识别

**归属：后端**（字段语义缺失；前端弹窗已补显示）

## 现象

提问 `Total number of trees on campus / Number of trees in right of way / Dollar value`

- 回答说 "Trees in right-of-way: Not tagged in inventory"，并解释 `location` 和 `notes` 字段查不到
- 地图把全部 5,510 棵一起画上，没有区分

## 真实数据语义

`trees.geojson` 里 **`UChicagoIn`** 字段编码了归属：

| `UChicagoIn` 值 | 含义 |
|---|---|
| 空 / null / `''` | **校园树**（芝大产权范围内） |
| 有值，如 `Midway Plaisance`、`CDOT` | **公共道路树（right-of-way）**——树在公共用地上，管理方是值里写的那个机构 |

字段名不直观（`UChicagoIn` 读起来像"在芝大内"，实际含义相反），所以模型自己猜不出来。**这和 CHRS 那次一样：字段在数据里，但工具层没告诉模型它是什么。**

## 修复

### 1. `treeFields.ts`（或等价的树图层字段说明）— 加字段字典

在树工具的描述里明确写：

> `UChicagoIn` — ownership flag. **Empty = campus tree** (University-owned land).
> **Non-empty = right-of-way tree**; the value names the public authority responsible
> (e.g. "Midway Plaisance" for Chicago Park District land, "CDOT" for Chicago DOT
> parkways). To count campus trees, filter `UChicagoIn` is null/empty. To count
> right-of-way trees, filter `UChicagoIn` is not empty. To group by authority, group
> on the non-empty values.

如果树工具有 allowlist，确认 `UChicagoIn` 在里面没被剥掉（CHRS 那次就是被 allowlist 剥掉了）。

### 2. 查询工具支持"为空 / 不为空"过滤

检查 `queryS3Layer` / `queryCampusLayer` 的 where-clause 是否支持 `isNull` / `isNotNull`（或 `= ''` / `!= ''`）。如果只有 `=`、`in`、`contains`、数值比较，需要加这两个运算符——"字段为空"是这个问题的核心过滤条件，现有运算符表达不了。

同时把**空字符串和 null 视为等价**：GeoJSON 从 WebMap 导出时空值可能是 `""`、`null` 或字段缺失三种形态。

### 3. 系统提示

> Tree ownership: use the `UChicagoIn` field, never `location` or `notes`. Empty means
> campus tree; a value means right-of-way tree managed by that authority. When asked
> about "campus trees" vs "right-of-way trees", return two separate counts and put only
> the requested subset in `mapUpdate` (or both with `_kind` tags so the map can color them
> differently).

### 4. 顺带：估值问题的诚实回答是对的

回答里 "inventory does not include dollar values, use i-Tree / CTLA" 这段是对的，保留。如果之后想支持，i-Tree 的估值公式需要 `DBH`、`Species`、`Condition`、`Location` 四个字段，树图层里都有——这是一个可做的后端工具，但不在本次范围。

## 验证

1. `how many trees are on campus vs in the right-of-way?` → 两个数字，加起来 = 5,510
2. `show me the trees along the Midway` → 只返回 `UChicagoIn = 'Midway Plaisance'` 的树
3. `which authority manages the most right-of-way trees near campus?` → 按 `UChicagoIn` 值分组计数
4. 点任意一棵树 → 弹窗 Ownership 行显示 "Campus" 或 "Right-of-way · CDOT"（前端已做）

## 前端已做

- 树弹窗新增 **Ownership** 行：空值显示 "Campus"，有值显示 "Right-of-way · {值}" 并用琥珀色标出
- PDF 数据表新增 "Right-of-way" 列

后端能区分两类后，我这边可以按归属给树上不同颜色（校园树深绿、公共道路树琥珀），并在图例里标注两类计数。
