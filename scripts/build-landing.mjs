/**
 * build-landing.mjs
 * Landing page에 backend 접선:
 *   1. backend-config.local.js  — API base + key
 *   2. inject-backend.js        — window.__cgBackend 등록 (AI query + freshness)
 *   3. inject-landing.js        — in-page overlay UI + document 이벤트 위임
 *
 * 세 스크립트 모두 외층 </head> 전에 삽입 → bundler replaceWith 이후에도 유효.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT        = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC         = join(ROOT, 'CampusGeo Landing.html')
const OUT         = join(ROOT, 'CampusGeo-Landing.html')
const INJECT_BE   = join(ROOT, 'inject-backend.js')
const INJECT_LAND = join(ROOT, 'inject-landing.js')

let html              = readFileSync(SRC, 'utf8')
const injectBackend   = readFileSync(INJECT_BE, 'utf8')
const injectLanding   = readFileSync(INJECT_LAND, 'utf8')

const HEAD_CLOSE = '</head>'
const headIdx    = html.indexOf(HEAD_CLOSE)
if (headIdx === -1) throw new Error('</head> not found')

// 순서: backend-config → inject-backend → inject-landing
const BLOCK =
  `<script src="backend-config.local.js"></script>\n` +
  `<script>\n${injectBackend}\n</script>\n` +
  `<script>\n${injectLanding}\n</script>\n`

html = html.slice(0, headIdx) + BLOCK + html.slice(headIdx)

writeFileSync(OUT, html)
console.log(`[build-landing] Done → ${OUT} (${html.length} bytes)`)
console.log(`  inject-backend.js : ${injectBackend.length} bytes`)
console.log(`  inject-landing.js : ${injectLanding.length} bytes`)
