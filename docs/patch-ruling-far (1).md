# check_feasibility 补丁：返回 FAR 数值字段 + 核对 Kent 的 Subarea

**归属：后端**（前端已按下面的字段名接好，返回即生效）

## 1. `ruling.far` 数值对象（必需）

前端要给加建体量按 FAR 上下限着色（绿=限内、红=超限），需要三个数字。目前它们只藏在约束的自然语言文本里，前端只能用正则猜，而且 **cap 根本没有数字**（文本是 "FAR limit for Subarea D is in PD 43 — see planning passages"），所以着色永远无法启动。

在 `ruling` 里加：

```ts
far: {
  cap: number | null,       // Subarea 的 FAR 上限，从 PD 43 段落里提取；找不到就 null，不要编
  current: number,          // 已有：Current FAR 1.71
  projected: number,        // 已有：Projected FAR 3.42
  perFloor: number,         // (projected - current) / addedFloors，前端用来实时重算不同层数
  lotAreaSf: number,        // 34,720，便于前端显示依据
  addedGfaSf: number,       // 59,336
}
```

**cap 的取法**：模型已经在读 PD 43 段落，让它顺带提取一个数字（prompt 里明确要求 "return the numeric FAR limit for this subarea as `farCap`, or null if the passages don't state one"）。数字由模型从文档抽取是可以的——它是引用，不是计算；计算（current/projected/perFloor）继续留在代码里。

如果 PD 43 对该 Subarea 确实没有明文 FAR 上限，返回 `cap: null`，同时在约束 detail 里说清"PD 43 未规定该分区的数值 FAR 上限"——前端会显示"no numeric cap returned"，比假装有上限诚实。

## 2. 顺带：约束文本里的 FAR 写法保持可解析

前端兜底正则锚定 `Current FAR: 1.71` / `Projected FAR: 3.42` / `FAR cap 2.0` 这三种写法。保留这种 "FAR" 紧邻数字的格式即可，不要写成 "the ratio is currently 1.71"。有了第 1 条的数值字段后这只是保险。

## 3. Kent 的 Subarea 已确认为 D

用户已确认 Kent Chemical Laboratory 在 **Subarea D**。后端返回正确，此前 concept 稿里的 "A" 是我们记错，前端演示兜底文案已同步改为 D。FAR 上限取 Subarea D 的即可。

## 验证

1. `Can Kent Chemical Laboratory add a 4-story addition on the east side?` → SSE `ruling.far.cap` 是数字（或 null 并有说明）；前端体量应为绿色或红色，不再是琥珀色
2. 前端 +/− 调层数时，"Projected FAR x.xx of y.yy cap" 实时变化，越过上限那一档变红
3. 前端会顺带请求 "Show me all buildings in Subarea D" 作灰色背景——确认这条查询只返回建筑（不含分区面），且数量合理
