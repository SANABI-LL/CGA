/**
 * 零依赖静态服务器：在 http://localhost:5173 服务 Print-a-Map 原型 UI。
 *
 * 为什么是 5173：生产 Lambda 的 CORS（ALLOWED_ORIGIN）只放行这个源，
 * 原型页面里的 inject-backend.js 才能直连生产 API（方式 B）。
 *
 * 启动：pnpm dev:print   →  http://localhost:5173 (Landing page → 主 app)
 *   /                           → CampusGeo-Landing.html
 *   /CampusGeo-with-Backend.html → 主查询 app
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 5173)
const INDEX = '/CampusGeo-Landing.html'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (urlPath === '/') urlPath = INDEX

    // 防目录穿越：规范化后必须仍在 ROOT 内
    const filePath = normalize(join(ROOT, urlPath))
    if (!filePath.startsWith(normalize(ROOT))) {
      res.writeHead(403).end('Forbidden')
      return
    }

    const info = await stat(filePath).catch(() => null)
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`Not found: ${urlPath}`)
      return
    }

    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(await readFile(filePath))
  } catch (err) {
    console.error('[serve-print]', err)
    res.writeHead(500).end('Internal error')
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[serve-print] 端口 ${PORT} 被占用 —— 是不是旧的 vite (pnpm dev) 还开着？先关掉它。`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, () => {
  console.log(`[serve-print] CampusGeo → http://localhost:${PORT}`)
  console.log(`[serve-print] 后端配置读取自 backend-config.local.js（缺省回退 localhost:3001）`)
})
