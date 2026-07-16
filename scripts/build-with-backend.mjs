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
 * 注意：bundle 把页面源码存成转义过的 JS 字符串（换行是字面量 \n），
 * 所以下面所有 pattern/替换文本里的 \\n 都是"反斜杠 + n"两个字符。
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

// —— 4. 追加后端接线脚本 ——
html += '<script src="backend-config.local.js"></script>\r\n<script src="inject-backend.js"></script>\r\n'

writeFileSync(OUT, html)
console.log(`[build-with-backend] 写出 ${OUT} (${html.length} bytes)`)
