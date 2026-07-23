/**
 * 从设计稿生成 CampusGeo-with-Backend.html：
 *
 * 1. 给 bundle 内嵌源码打"真数据补丁"——把写死的演示常量
 *    (SYNC_SOURCE / SYNC_LOG / DIGEST 等) 包成渲染时优先读
 *    window.CAMPUSGEO_LIVE 的 Proxy，取不到时回退演示值。
 *    数据由 inject-backend.js 从后端 freshness 端点拉取（S3 digest 直读）。
 * 2. 追加 backend-config.local.js + inject-backend.js 两个 script 标签。
 *
 * 设计稿源文件（CampusGeo Print-a-Map.html）保持只读，重新导出设计稿后
 * 重跑本脚本即可。任何锚点匹配数不为 1 时立即报错退出、不写文件。
 *
 * 注意：bundle 有两层结构
 * 1. __bundler/manifest（3.4MB JSON）：存 base64+gzip 压缩的文件
 * 2. __bundler/template（203KB JSON）：整个 HTML 序列化为一个 JSON 字符串
 * 3. type="text/babel" script（112KB）：明文 React JSX，patch 只能改这里
 *
 * patch() 向 text/babel 明文脚本注入代码时的关键规则：
 * - 换行用字面量 \n（两字符 反斜杠+n），不是真实换行
 * - TO 字符串里禁用双引号（"）—— template JSON 把整个 HTML 序列化为字符串，
 *   注入的 " 会破坏外层 JSON，导致 "Bundle unpack error: Bad escaped character"
 *   解决：内层字符串一律用单引号（'），正则用 new RegExp('pattern', 'i') 形式
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'CampusGeo Print-a-Map.html')
const OUT = join(ROOT, 'CampusGeo-with-Backend.html')

let html = readFileSync(SRC, 'utf8')

/** 替换且断言恰好命中一次 */
function patch(name, from, to) {
  const first = html.indexOf(from)
  if (first === -1) throw new Error(`[build-with-backend] 锚点未找到: ${name}`)
  if (html.indexOf(from, first + 1) !== -1) throw new Error(`[build-with-backend] 锚点不唯一: ${name}`)
  html = html.slice(0, first) + to + html.slice(first + from.length)
  console.log(`  ✓ ${name}`)
}

// —— 1. 演示常量改名为 *_DEMO ——
patch('SYNC_SOURCE → demo', 'const SYNC_SOURCE = {', 'const SYNC_SOURCE_DEMO = {')
patch('SYNC_LOG → demo', 'const SYNC_LOG = [', 'const SYNC_LOG_DEMO = [')
patch('DIGEST → demo', 'const DIGEST = [', 'const DIGEST_DEMO = [')

// —— 2. 注入 LIVE 帮助函数 + Proxy 定义（渲染时读真数据）——
patch(
  'LIVE helper + SYNC_SOURCE proxy',
  '};\\nconst SYNC_STATUS = {',
  '};\\n' +
    'const LIVE = () => window.CAMPUSGEO_LIVE || {};\\n' +
    'const liveArray = (getLive, demo) => new Proxy(demo, { get: (t, k) => { const l = getLive(); const s = (l && l.length) ? l : t; const v = s[k]; return typeof v === \'function\' ? v.bind(s) : v; } });\\n' +
    'const SYNC_SOURCE = new Proxy(SYNC_SOURCE_DEMO, { get: (t, k) => { const l = LIVE().syncSource; return (l && l[k] != null) ? l[k] : t[k]; } });\\n' +
    'const SYNC_STATUS = {'
)
patch(
  'SYNC_LOG proxy',
  "status: 'applied' }];\\n\\nconst SYNC_PIPELINE",
  "status: 'applied' }];\\n" +
    'const SYNC_LOG = liveArray(() => LIVE().syncLog, SYNC_LOG_DEMO);\\n' +
    '\\nconst SYNC_PIPELINE'
)
patch(
  'DIGEST proxy',
  "sub: 'Campus Buildings' }];\\n\\n\\n/* ── Intent routing",
  "sub: 'Campus Buildings' }];\\n" +
    'const DIGEST = liveArray(() => LIVE().digestItems, DIGEST_DEMO);\\n' +
    '\\n\\n/* ── Intent routing'
)

// —— 3. 渲染处的活值替换（回退演示文案）——
patch(
  'digest date in panel header',
  "{DIGEST_DATE.replace(', 2026', '')}",
  "{(LIVE().digestDate || DIGEST_DATE).replace(', 2026', '')}"
)
patch(
  'current-as-of headline',
  'Campus data is current as of today, 02:00&#8201;CT.',
  "{LIVE().currentAsOf || 'Campus data is current as of today, 02:00 CT.'}"
)
patch(
  'recent-syncs count label',
  '>last 5 of 30 runs<',
  ">{LIVE().syncLogLabel || 'last 5 of 30 runs'}<"
)
patch(
  'next-run estimate',
  '>≈ 18 h<',
  ">{LIVE().nextRunIn || '≈ 18 h'}<"
)

// —— 4. submit() 全量拦截：所有查询在 buildScenario 之前转 AI 后端 ——
// 原来：所有查询先经 buildScenario → detectKind，识别到已知 kind（buildings/
// trees/RI/FCI 等）就走本地脚本引擎，显示预设答案，从不调 AI。
// 现在：只要 __cgBackend 已注册，所有查询在 buildScenario 被调用之前就拦截，
// 直接转 AI 后端。本地引擎只在 __cgBackend 未注册（离线/调试）时才运行。
// 锚点：clearTimers() + 字面量 \n + const scenario = buildScenario(...)
// 用 Buffer.from + String.fromCharCode(92) 精确构造，避开 JS 多层转义问题。
{
  const BS = String.fromCharCode(92)  // 一个反斜杠字符
  const FROM = 'clearTimers();' + BS + 'n    const scenario = buildScenario(q, buildings);'
  const TO =
    'clearTimers();' + BS + 'n' +
    '    if (typeof window.__cgBackend === \'function\' && !(typeof window.__cgIsMapQuery === \'function\' && window.__cgIsMapQuery(q))) {' + BS + 'n' +
    '      window.__cgBackend(q, { setUnrecMsg, setSubmitted, setQuery, setPhase, setSc, setTitle, setFitCmd });' + BS + 'n' +
    '      return;' + BS + 'n' +
    '    }' + BS + 'n' +
    '    const scenario = buildScenario(q, buildings);'
  patch('submit ALL queries → AI backend', FROM, TO)
}

// —— 5 (旧4). submit() unrecognized 分支（离线降级保留，正常路径不再触达）——
// 保留原补丁作为离线降级路径：若 __cgBackend 未注册，unrec 分支继续正常工作。
patch(
  'submit unrec fallback (offline)',
  "if (!scenario || scenario.unrec) {\\n      setUnrecMsg(scenario && scenario.msg ? scenario.msg : null);\\n      setSubmitted(q);setQuery('');setPhase('unrecognized');\\n      return;\\n    }",
  "if (!scenario || scenario.unrec) {\\n      if (typeof window.__cgBackend === 'function') {\\n        window.__cgBackend(q, { setUnrecMsg, setSubmitted, setQuery, setPhase, setSc, setTitle, setFitCmd });\\n        return;\\n      }\\n      setUnrecMsg(scenario && scenario.msg ? scenario.msg : null);\\n      setSubmitted(q);setQuery('');setPhase('unrecognized');\\n      return;\\n    }"
)

// —— 5. unrecognized 面板改用 dangerouslySetInnerHTML 渲染 AI Markdown ——
// inject-backend.js 把渲染好的 HTML 字符串写入 unrecMsg，
// 但原来的 {unrecMsg} 只做文本节点渲染，标签会被 escape。
// 改为 dangerouslySetInnerHTML：AI 回答时写 HTML，fallback 写纯文本。
// 只替换内层 div（unrecMsg 渲染区），不碰外层容器和 Available layers 行。
// 锚点用 Buffer.from 精确编码，绕过 JS 字符串多层转义问题。
{
  // FROM：直接从文件偏移 3620671 ~ 3620836 提取的原始字节
  const FROM_BUF = Buffer.from(
    'lineHeight: 1.6 }}>\x5Cn                  ' +
    '{unrecMsg || (/[\x5C\x5Cu4e00-\x5C\x5Cu9fff]/.test(submitted) ? UNRECOGNIZED_MSGS[1] : UNRECOGNIZED_MSGS[0])}\x5Cn' +
    '                <\x5Cu002Fdiv>'
  )
  // TO：去掉 > 之前的空格，加 dangerouslySetInnerHTML
  const TO_BUF = Buffer.from(
    'lineHeight: 1.6 }}\x5Cn' +
    '                  dangerouslySetInnerHTML={{ __html: (unrecMsg && typeof unrecMsg === \'string\' && unrecMsg.startsWith(\'<\')) ? unrecMsg : (unrecMsg ? `<p>${unrecMsg}<\x5C/p>` : (/[\x5C\x5Cu4e00-\x5C\x5Cu9fff]/.test(submitted) ? UNRECOGNIZED_MSGS[1] : UNRECOGNIZED_MSGS[0])) }}\x5Cn' +
    '                ><\x5Cu002Fdiv>'
  )
  const htmlBuf = Buffer.from(html)
  const fromStr = FROM_BUF.toString()
  const toStr = TO_BUF.toString()
  const first = html.indexOf(fromStr)
  if (first === -1) throw new Error('[build-with-backend] 锚点未找到: unrecMsg → dangerouslySetInnerHTML')
  if (html.indexOf(fromStr, first + 1) !== -1) throw new Error('[build-with-backend] 锚点不唯一: unrecMsg → dangerouslySetInnerHTML')
  html = html.slice(0, first) + toStr + html.slice(first + fromStr.length)
  console.log('  ✓ unrecMsg → dangerouslySetInnerHTML')
}

// —— 6. followUp() 树木查询转 AI 后端（使用真实 S3 数据）——
// 原来：follow-up 中 trees 相关查询走 applyFollowUp() → genTrees() 假数据（~250 棵）
// 现在：检测到 trees 相关 follow-up 时，把"当前建筑名 + follow-up 问题"拼成完整
// 自然语言查询，交给 __cgBackend 处理（Lambda → S3 真实 5491 棵树数据）
// remove/clear 类操作仍走本地逻辑
{
  const BS = String.fromCharCode(92)
  const FROM =
    'const followUp = useCallback(() => {' + BS + 'n' +
    '    const q = followQ.trim();if (!q) return;' + BS + 'n' +
    '    setFollowState({ phase: \'thinking\', msg: \'Scanning layers · matching your refinement…\' });'

  const TO =
    'const followUp = useCallback(() => {' + BS + 'n' +
    '    const q = followQ.trim();if (!q) return;' + BS + 'n' +
    "    const _isTreeFollowUp = new RegExp('tree|sapling|plant', 'i').test(q) && !new RegExp('remove|clear|hide', 'i').test(q);" + BS + 'n' +
    '    if (_isTreeFollowUp && typeof window.__cgBackend === \'function\') {' + BS + 'n' +
    '      const _bldName = sc && sc.data && sc.data.features && sc.data.features[0] && sc.data.features[0].properties && (sc.data.features[0].properties.NAME || sc.data.features[0].properties.BLDG_NAME || \'\');' + BS + 'n' +
    '      const _fullQ = _bldName ? q + \' near \' + _bldName : q;' + BS + 'n' +
    '      window.__cgBackend(_fullQ, { setUnrecMsg, setSubmitted, setQuery, setPhase, setSc, setTitle, setFitCmd });' + BS + 'n' +
    '      return;' + BS + 'n' +
    '    }' + BS + 'n' +
    '    setFollowState({ phase: \'thinking\', msg: \'Scanning layers · matching your refinement…\' });'

  patch('followUp trees → AI backend', FROM, TO)
}

// —— 7. 去掉 "Available layers" footer 提示行 ——
{
  const BS = String.fromCharCode(92)
  const FROM =
    BS + 'n                <div style={{ marginTop: 14, fontSize: 11, color: T.inkXlt }}>Available layers: Campus Buildings (footprints, RI, FCI, CHRS) · Campus Trees (species, year_planted, condition)<' + BS + 'u002Fdiv>'
  patch('remove Available layers footer', FROM, '')
}

// —— 8. 修复 trees popup 字段名（genTrees 伪造字段 → S3 真实字段）——
// 先用 Node 打印出实际锚点字符串，再 replace_all。
{
  // 用 indexOf 直接在 html 字符串里定位，避开多层转义
  const anchor = 'p.species'
  const popupStart = html.lastIndexOf('setHTML(`', html.lastIndexOf(anchor)) // 最后一处 p.species 前的 setHTML
  // 但两处相同，用 split 替换全部
  // 从文件里直接提取 OLD 字符串：在 html 里找到模板并记录
  const firstHit = html.indexOf('setHTML(`<div class=\\"pop-title\\">${p.species}')
  if (firstHit === -1) throw new Error('[build-with-backend] 锚点未找到: trees popup 字段修复')
  const popupEnd = html.indexOf('.addTo(map)', firstHit) + '.addTo(map)'.length
  const OLD = html.slice(firstHit, popupEnd)

  // NEW：用相同的字符串结构，替换3个字段
  // 注意：在 html 字符串里单引号/反引号都安全，只有双引号需要 \\"（已和 OLD 一致）
  const NEW = OLD
    .replace('${p.species}', "${p.CommonName || p.Common_Nam || 'Unknown'}")
    .replace('Planted ${p.year_planted} \xb7 ${p.dbh_in}\\" DBH \xb7 ${p.condition}',
             "${p.Condition || p.conditionC || '—'} \xb7 canopy ${p.CanRadius ? p.CanRadius + 'ft radius' : '—'}")

  const count = (html.split(OLD)).length - 1
  if (NEW === OLD) throw new Error('[build-with-backend] trees popup NEW 与 OLD 相同，替换无效')
  html = html.split(OLD).join(NEW)
  console.log(`  ✓ trees popup 字段修复 (${count} 处)`)
}

// —— 9. trees 地图路径插入建筑背景层 ——
// inject-backend.js 把 cachedBuildings 存入 sc.ctxBuildings。
// 设计稿 trees 路径没有 buildings 背景层；这里在 trees-old source 之前
// 插入 bldg-ctx（fill + line），让建筑轮廓作为背景显示。
{
  const BS = String.fromCharCode(92)
  const FROM =
    "map.addSource('trees-old', { type: 'geojson', data: sc.allData });" + BS + 'n' +
    "        map.addLayer({ id: 'trees-old', type: 'circle', source: 'trees-old',"
  const TO =
    "if (sc.ctxBuildings && sc.ctxBuildings.features && sc.ctxBuildings.features.length) {" + BS + 'n' +
    "          if (!map.getSource('bldg-ctx')) {" + BS + 'n' +
    "            map.addSource('bldg-ctx', { type: 'geojson', data: sc.ctxBuildings });" + BS + 'n' +
    "            map.addLayer({ id: 'bldg-ctx-fill', type: 'fill', source: 'bldg-ctx', paint: { 'fill-color': '#C9BCA6', 'fill-opacity': 0.45 } });" + BS + 'n' +
    "            map.addLayer({ id: 'bldg-ctx-line', type: 'line', source: 'bldg-ctx', paint: { 'line-color': '#A89B86', 'line-width': 0.6 } });" + BS + 'n' +
    "          } else { map.getSource('bldg-ctx').setData(sc.ctxBuildings); }" + BS + 'n' +
    "        }" + BS + 'n' +
    "        map.addSource('trees-old', { type: 'geojson', data: sc.allData });" + BS + 'n' +
    "        map.addLayer({ id: 'trees-old', type: 'circle', source: 'trees-old',"
  patch('trees map: 插入建筑背景层 bldg-ctx', FROM, TO)
}

// —— 10. 追加后端接线脚本 ——
html += '<script src="backend-config.local.js"></script>\r\n<script src="inject-backend.js"></script>\r\n'
// (patch 序号已更新为 10)

writeFileSync(OUT, html)
console.log(`[build-with-backend] 写出 ${OUT} (${html.length} bytes)`)
