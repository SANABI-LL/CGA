# Handoff: CampusGeo Landing + Query Results

## Overview

CampusGeo 的公开首页与查询结果界面。用户用自然语言提问校园地理问题，界面流式显示 AI 的解读过程与文字回答，右侧同步渲染对应的地图要素，并可导出为两页 PDF（地图页 + 数据表页）。

本包对应 repo `SANABI-LL/CGA` 的 `apps/web` 前端。后端契约未变，全部来自 `docs/FRONTEND_INTEGRATION.md` 与 `backend/lambdas/ai-agent/`。

## About the Design Files

本包内的 HTML 文件是**设计参考**，不是可直接上线的生产代码。它们是用单文件 HTML 写的高保真原型，用来说明最终的外观与行为。

任务是**在 `apps/web` 现有的 React + Vite 环境里重建这些设计**，沿用该 codebase 已有的组件划分、状态管理与构建方式。不要把 HTML 原样搬进去。

## Fidelity

**High-fidelity（高保真）**。颜色、字体、间距、动效、交互状态均为定稿值，应逐像素还原。所有数值在下方 Design Tokens 一节列全。

---

## Screens / Views

### 1. Landing（首页英雄区）

**Purpose**：介绍产品，接收用户的第一个查询。

**Layout**
- 根容器：`min-height: 100vh`，背景 `var(--ns-bg-grad)`，`position: relative; overflow: hidden`
- 内容居中，`max-width: 1180px`，水平内边距 32px
- 背景装饰共 4 层，全部 `pointer-events: none`，`z-index` 低于内容：
  1. **等高线**：SVG `viewBox="0 0 1440 900"`、`preserveAspectRatio="xMidYMid slice"`、`position: absolute; inset: 0`。6 条 cubic 曲线，`stroke: var(--ns-contour)`，虚线流动（见 Animations）
  2. **测绘标注**：同尺寸 SVG，5 个十字标 + 校园地名（REGENSTEIN LIBRARY / BOTANY POND / MIDWAY PLAISANCE / ROCKEFELLER CHAPEL / MAIN QUADRANGLES），`font-size: 9px`、`letter-spacing: 1.5`、`fill: var(--ns-accent)`、默认 `opacity: 0.45`、hover `0.9`（`transition: opacity 0.25s ease`，需 `pointer-events: auto`）。虚线路径 `stroke-dasharray="2 8"`，`animation: nsDash 4.5s linear infinite`
  3. **细网格**：`background-image` 双向 1px 线，`var(--ns-grid)`，48px 间距，配径向 `mask-image` 渐隐
  4. **噪点**：base64 SVG feTurbulence，`opacity: var(--ns-noise)`（深色 0.03 / 浅色 0.02）

**Components**
- **Header**：高 64px，左侧 UChicago 盾徽 SVG + "CampusGeo" 字样，右侧状态点（`var(--ns-status-dot)` + glow）与图标按钮
- **Eyebrow**：小号全大写标签，`font-size: 10px; font-weight: 500; letter-spacing: 0.32em; color: var(--ns-fg-faint)`，右侧接一段 36px 渐隐横线 `linear-gradient(90deg, var(--ns-accent-line), transparent)`
- **H1**：`font-family: 'Gotham', 'Plus Jakarta Sans', sans-serif; font-size: 62px; font-weight: 500; line-height: 1.06; letter-spacing: -0.028em; color: var(--ns-fg); margin: 0 0 24px; text-wrap: balance`
- **副标题**：`font-size: 15px; font-weight: 400; line-height: 1.75; letter-spacing: 0.005em; color: var(--ns-fg-body); max-width: 500px`
- **搜索框**：外层 `padding: 1px; border-radius: 15px; background: var(--ns-frame)`（1px 渐变描边）；内层 `background: var(--ns-input-bg); border-radius: 14px; backdrop-filter: blur(12px); box-shadow: var(--ns-input-shadow)`；输入框 `height: 44px; font-size: 14.5px; background: transparent; border: none; outline: none; color: var(--ns-fg)`
- **Ask 按钮**：`height: 44px; padding: 0 22px; border-radius: 11px; font-size: 13.5px; font-weight: 500; letter-spacing: 0.02em; color: #fff`；`background: linear-gradient(180deg, #A31212, #6E0000)`；`box-shadow: 0 8px 28px rgba(150,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.25)`；hover `filter: brightness(1.15)`；active `transform: scale(0.97)`；`transition: filter 0.15s ease, transform 0.15s ease`
- **建议 chips**：pill，`padding: 9px 16px; border-radius: 999px; font-size: 12px; background: var(--ns-chip-bg); border: 1px solid var(--ns-hair-soft); color: var(--ns-chip-fg)`；hover `border-color: var(--ns-accent-bd-h); color: var(--ns-chip-fg-h); background: var(--ns-tile-hover); transform: translateY(-1px)`；左侧 12px lucide 图标，`stroke: var(--ns-accent)`
  - 文案：`Bike racks near Regenstein Library` / `Buildings constructed before 1930` / `Trees planted near the Quad`

### 2. How it works（四阶段说明动画）

四张卡片横排，每张 `border-radius: 14px; background: var(--ns-tile); border: 1px solid var(--ns-hair-soft)`。右上角常驻序号 `01`–`04`（`position: absolute; top: 16px; right: 16px; font-size: 10px; font-weight: 500; letter-spacing: 0.12em; color: var(--ns-num)`）。

同一条 8s 循环时间轴依次点亮四张卡（`dgW1`–`dgW4` 控制描边高亮层的 opacity），卡内各有一段图示动画：

| # | 标题 | 图示动画 |
|---|---|---|
| 01 | Ask in plain language | 打字机效果（`dgType` 控制 `max-width` 0→160px）+ 闪烁光标 `dgCaret` |
| 02 | Reads the right layers | 三层 `skewX(-28deg)` 图层片，逐层抬起并亮起（`dgLayer`）+ 扫描线 `dgScan` |
| 03 | Maps the answer | 三个定位点依次弹出（`dgDotA/B/C`）+ 圆环描边推进 `dgRing` |
| 04 | Summarizes the documents | 常驻 PDF 文档卡 + 自上而下扫描光带 `dgPdfScan` + 摘要角标弹出 `dgCheck` |

底部一条进度光带 `dgProg` 与四阶段同步。

### 3. Query Results（结果区）

**Layout**：`max-width: 1180px; margin: 30px auto 0`，CSS Grid。
- 有地图时：`grid-template-columns: minmax(0, 1fr) minmax(0, 1.06fr)`
- 无地图时：`minmax(0, 1fr)`（单列）
- `gap: 16px; align-items: start`

⚠️ **此容器不得带任何 `transform` 或 `animation`（含 `fill-mode: both` 的入场动画）** —— 带 transform 的祖先会成为 `position: fixed` 的定位基准，地图全屏会跑到视口外。这是已修复的真实 bug。

**左栏 — 答案卡**
- `background: var(--ns-tile); border: 1px solid var(--ns-hair-soft); border-radius: 16px; padding: 24px 28px 26px; box-shadow: var(--ns-card-inset); min-height: 300px`
- 卡头：问题原文 + 右侧状态标签，`padding-bottom: 14px; border-bottom: 1px solid var(--ns-hair-soft); margin-bottom: 18px`
- 状态标签取值：`INTERPRETING` → `ANSWERED` / `N FEATURES MAPPED` / `FAILED`
- 加载态：脉冲圆点（`nsPulse 1s ease-in-out infinite`）+ 当前工具名，文案形如 `Reading query s3 layer…`
- 正文为流式 markdown，需自行渲染（段落、加粗、列表、表格）
- 错误文字色 `#D96060`

**表格 ↔ 地图联动**：hover 表格行时高亮地图上对应要素，行底色变 `var(--ns-tile-hover)`（`transition: background 0.15s ease`）。
- 对应关系：行数与要素数相同 → 按顺序一一对应；否则用行内文本匹配要素标题；匹配不上则不高亮（不要瞎猜）

**右栏 — 地图卡**
- `position: sticky; top: 24px`（长答案滚动时地图留在视口内）
- 卡片 `display: flex; flex-direction: column; height: 480px; border-radius: 16px; overflow: hidden`
- 顶部工具栏：高约 49px，`padding: 11px 12px 11px 16px; border-bottom: 1px solid var(--ns-hair-soft)`
  - 左：状态点 + 徽标文字（`N FEATURES` / `HYDE PARK CAMPUS`），`font-size: 9.5px; letter-spacing: 0.16em; color: var(--ns-fg-muted)`
  - 右：三个 27×27px 图标按钮 — **导出 PDF**、**全屏**、**折叠**；`border-radius: 7px; border: 1px solid var(--ns-hair-soft)`；hover `background: var(--ns-tile-hover); border-color: var(--ns-hair)`
- 折叠：地图体 `flex: 0 0 0px; height: 0`，卡片收成一条工具栏；chevron 旋转 180deg（`transition: transform 0.2s ease`）
- 全屏：卡片 `position: fixed; inset: 24px; z-index: 90`；遮罩 `position: fixed; inset: 0; z-index: 85; background: rgba(20,10,12,0.55); backdrop-filter: blur(3px)`；Esc 或点遮罩退出；全屏期间 `document.body.style.overflow = 'hidden'`
- 年份图例（仅建筑类查询且年份跨度 > 0 时显示）：左下角，`bottom: 14px; left: 16px`，132×6px 色带 `linear-gradient(90deg, #3E6478, #6E8C86, #C4903A, #A31212)`，两端标注最小/最大年份
- 加载遮罩：满铺 `var(--ns-input-bg)`，一条 90px 高的光带 `nsSweep 2.6s linear infinite` 上下扫过，中央文字 `READING CAMPUS LAYERS`（`font-size: 10px; letter-spacing: 0.24em`）

---

## Map Configuration

**库**：MapLibre GL JS 4.7.1（CDN 或 npm 均可）

```js
new maplibregl.Map({
  container,
  style: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/' + (dark ? 'dark_all' : 'light_all') + '/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap, © CARTO',
      },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  },
  center: [-87.5997, 41.7897],   // Hyde Park campus
  zoom: 14.6,
  attributionControl: false,
  preserveDrawingBuffer: true,   // 必需：PDF 导出要读取 canvas
});
```

**图层栈**（source `results`，GeoJSON）

| id | type | filter | paint |
|---|---|---|---|
| `results-fill` | fill | Polygon/MultiPolygon | `fill-color: #A31212`（有年份时改为渐变，见下）, `fill-opacity: 0.55` |
| `results-outline` | line | Polygon/MultiPolygon | `line-color: rgba(255,255,255,0.5)`（深色）/ `rgba(42,34,24,0.45)`（浅色）, `line-width: 0.8` |
| `results-line` | line | LineString/MultiLineString | `line-color: #C4903A`, `line-width: 2.4` |
| `results-point` | circle | Point/MultiPoint | `circle-radius: 6`, `circle-color: #C4903A`, `circle-stroke-width: 1.6`, `circle-stroke-color: #1E1013`（深色）/ `#FAF7F2`（浅色） |
| `results-hl-fill` | fill | `['==', ['get','_idx'], -1]` | `fill-color: #C4903A`, `fill-opacity: 0.5` |
| `results-hl-line` | line | 同上 | `line-color: #C4903A`, `line-width: 2.6` |
| `results-hl-point` | circle | 同上 | `circle-radius: 12`, `circle-color: rgba(196,144,58,0.22)`, `circle-stroke-width: 2`, `circle-stroke-color: #C4903A` |

高亮通过 `setFilter` 把 `_idx` 换成目标序号实现。

**年份配色**（建筑类查询）：在 `pushFeatures` 后计算年份范围并覆写 `results-fill` 的 `fill-color`：

```js
['case',
  ['==', ['coalesce', ['get', '_year'], -1], -1], 'rgba(140,128,112,0.5)',   // 年份缺失 → 中性灰
  ['interpolate', ['linear'], ['get', '_year'],
    lo, '#3E6478', at(0.38), '#6E8C86', at(0.72), '#C4903A', hi, '#A31212'],
]
```
`at(t) = lo + (hi - lo) * t`。年份样本少于 2 个时回退到纯 `#A31212` 并隐藏图例。

**要素预处理**：写入 source 前给每个 feature 注入 `_idx`（序号，供高亮）和 `_year`（解析后的年份）。年份解析顺序：`_yearResolved` → `Year_Completed` → `year` → 从 `Year_Opened` 的 ISO 字符串取前 4 位；仅接受 1700–2200。

**弹窗**：点击要素时按图层生成字段，不要写死建筑字段。

| 图层判定 | 标题 | 字段 |
|---|---|---|
| 有 `CommonName` 或 `TreeID` | 树种 | Tree ID / Condition / Age class / Canopy radius / Diameter / Notes |
| 有 `DISCRIPT1` / `Year_Completed` / `BD_ID` | 建筑名 | Use / Year completed / Address / Architects / Height / Building code |
| 有 `Spaces` / `Capacity` / `RackType` | Bike rack | Type / Spaces / Location / Covered |
| 其他 | `Name`/`Label`/`Description` | 自动挑选最多 5 个描述性字段 |

未知图层的字段筛选需**屏蔽内部列**：`objectid`、`shape_*`、`globalid`、`fid`、`lat`/`lon`、`fci`、`ri`、`ricost`、`f20\d\d`（成本预测列）、`berp`、`csl`、`bim` 等。附近查询额外显示 `distanceMeters`（取整 + " m"）。

---

## PDF Export

点击工具栏打印按钮 → 在隐藏 iframe 里写入一份独立打印文档 → 调用 `print()`。用户在系统对话框里选"另存为 PDF"。

**触发时机**：必须同时等待地图图片 `onload` 与 `document.fonts.ready`（Gotham 是自托管 woff2，不等会掉回系统字体），4 秒兜底强制触发。

**第 1 页 — 地图**
- `@page { size: letter; margin: 0.55in; }`
- 页头：`CampusGeo`（15pt/700）+ `UNIVERSITY OF CHICAGO`（8.5pt，字距 0.2em），右侧经纬度与时间戳（9pt）；下方 2px `#800000` 分隔线
- 标题：问题原文，19pt/500，`letter-spacing: -0.02em`
- 计数行：`N FEATURES MAPPED · <图层类型>`，9.5pt，`#9A6F28`
- 地图图片：`canvas.toDataURL('image/png')`，`max-height: 6in`，外框 `1px solid #C9BFAF` + 6pt 内边距
- 页脚：数据来源 + `SHEET 1 — MAP`；右侧年份色标图例

**第 2 页起 — 数据表**
- 表头每页重复（`thead { display: table-header-group }`），行不被切断（`tr { page-break-inside: avoid }`）
- `table-layout: fixed`，正文 10pt/1.5，表头 8.5pt 全大写字距 0.1em
- 列组按图层选择：

| 图层 | 列（含宽度） | 排序 |
|---|---|---|
| Campus buildings | Building 26% / ID 8% / Use 18% / Year 8% / Architects 20% / Address 20% | `_year` 升序 |
| Campus trees | Tree ID 13% / Species 26% / Condition 13% / Age class 15% / Canopy 12% / Notes 21% | — |
| Bike parking | Type 26% / Spaces 16% / Location 38% / Distance 20% | `distanceMeters` 升序 |
| 其他 | Feature + 自动字段 | — |

行首固定一列序号（5% 宽，`#B5ADA0`，8.5pt）。空值显示 `—`。

---

## Interactions & Behavior

**查询流程**
1. 用户在搜索框输入或点击建议 chip → 立即清空上一轮结果与地图要素
2. `POST {apiBase}/api/agent`，header `Content-Type: application/json` + `X-Api-Key`，body `{ query, sessionId }`
3. 逐行读取 SSE（`data: ` 前缀，JSON 解析）：
   - `type: 'tool_call'` → 状态行显示 `Reading <toolName 下划线转空格>…`
   - `type: 'text'` → 追加到答案文本，`loading` 置 false
   - 事件带 `mapUpdate` → features 累加（**兼容裸数组与 FeatureCollection 两种形态**），重绘并 `fitBounds`
   - 仅有 `mapUpdate.center` → `easeTo({ center, zoom: 16, duration: 700 })`
   - `type: 'error'` → 显示错误文案
4. 流结束 → 收尾状态，显示要素数

**fitBounds**：`padding: 56, maxZoom: 17, duration: 700`；单点时改用 `easeTo({ zoom: 16.5 })`。

**键盘**：搜索框 Enter 提交；Esc 退出地图全屏。

**主题**：`prefers-color-scheme` 自动切换，`[data-theme-force="dark"|"light"]` 可强制。底图与地图描边颜色随主题变化。

---

## State Management

```
query          string   输入框内容
asked          string   当前已提交的问题
loading        bool     是否在等待首段文字
answer         string   累积的 markdown 文本
error          string   错误文案
tool           string   当前工具状态行
featureCount   number   已映射要素数
yearMin/Max    number   年份范围（驱动图例与配色）
mapCollapsed   bool
mapFullscreen  bool
hoverKey       string   当前 hover 的表格行标识
```

实例变量（不进 state，避免无谓重渲染）：`features[]`（累积的 GeoJSON features）、`map`、`mapReady`、`sessionId`。

---

## Design Tokens

全部收进 CSS 变量，浅/深两套。完整定义见本包内 `tokens.css`（可直接复制进 codebase）。核心值：

**深色（默认）**
- 底：`#251215`，渐变 `linear-gradient(180deg, #2B1417 0%, #221114 55%, #1E1013 100%)`
- 文字四级：`#F5F1EA` / `#BFAFA8` / `#97867F` / `#715F5A`
- 描边两级：`rgba(245,241,234,0.10)` / `rgba(245,241,234,0.065)`
- 面料两级：`rgba(245,241,234,0.028)` / `rgba(245,241,234,0.05)`
- 琥珀：`#D2A055`

**浅色**
- 底：`#F5F0E8`，渐变 `linear-gradient(180deg, #F9F5ED 0%, #F4EEE3 100%)`
- 文字四级：`#2A2218` / `#6B5F52` / `#8C8070` / `#B5ADA0`
- 琥珀：`#9A6F28`

**规则**：全页只允许两个彩色 —— 栗红（UChicago maroon 系）与琥珀。其余层次一律用前景色的透明度分级。新增元素必须走变量，不写死颜色。

**字体**：自托管 Gotham 400/500/700 + 400 italic（`assets/fonts/`）。不使用 Google Fonts 替代品。大标题字距 -0.028em；小号全大写标签 0.12–0.32em。标题与正文都要显式写 `font-family`，防止被设计系统的 h1/p 规则覆盖。

**圆角**：按钮 11px，卡片 14–16px，小图标按钮 7px，chips 999px。

**动效**：入场 `nsUp`（`translateY(18px)` + fade，`cubic-bezier(0.16,1,0.3,1)`，0.08s 错峰）。hover 过渡 0.15–0.25s。不使用 bounce。背景等高线用三组不同缓动的 keyframes（`nsSandA/B/C`，周期 24s–52s，方向交替），使流动永不对齐成同一拍。

---

## Assets

- `assets/fonts/` — 自托管 Gotham woff2（400/500/700 + 400 italic）与 `gotham.css`
- `assets/ds-tokens.css` — 设计系统令牌本地副本（已去掉远程 `@import`，保证离线可用）
- UChicago 盾徽 — 内联 SVG，深/浅两版通过 `--ns-shield-white` / `--ns-shield-maroon` 切换 `display`
- 图标 — lucide，内联 SVG，`stroke-width: 1.5–1.9`
- 噪点纹理 — 内联 base64 SVG feTurbulence，无外部依赖

---

## Files

| 文件 | 说明 |
|---|---|
| `Landing B v2 Night Survey.dc.html` | 完整设计原型（含全部逻辑），主要参考 |
| `tokens.css` | 设计令牌，可直接复制 |
| `WORKFLOW.md` | Claude Code ↔ Claude Design 的四步协作流程 |

---

## ⚠️ 安全

原型里通过 `backend-config.local.js` 注入 `apiBase` 与 `apiKey`，**该文件不在本包内，也不得进入 git**。生产实现应走环境变量与既有的部署配置，不要把 key 打进前端产物。
