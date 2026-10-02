import { mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { MODULES } from '../src/data/modules'
import { SEED_ROWS } from '../src/data/seed'
// storageKey() 只返回常量，不在顶层触碰 window，Node 侧可直接复用，避免键名两处维护。
import { storageKey } from '../src/data/local-store'

// 仅在本地开发服务器里挂载：apply: 'serve' 保证生产构建不带这些路由。
const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RUNTIME_DIR = resolve(FRONTEND_ROOT, '.dev-reset')
const LOG_FILE = resolve(RUNTIME_DIR, 'reset.log')
const ROUTE_PREFIX = '/__dev_reset'

function ensureRuntimeDir(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true })
}

function log(line: string): void {
  ensureRuntimeDir()
  appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)
}

function isSafeNonce(nonce: string): boolean {
  // nonce 会拼进状态文件名，只允许安全字符，杜绝路径穿越。
  return /^[a-z0-9-]+$/i.test(nonce)
}

function statusFile(nonce: string): string {
  return resolve(RUNTIME_DIR, `status-${nonce}.json`)
}

function renderResetPage(storageKeyValue: string): string {
  // 示例数据与模块名都在服务端注入，页面不引入任何打包资源，直接打开即可执行。
  const labels = Object.fromEntries(MODULES.map((item) => [item.key, item.name]))
  const payload = JSON.stringify({
    storageKey: storageKeyValue,
    seed: SEED_ROWS,
    labels,
  }).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>本地开发数据复位</title>
    <style>
      body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; background: #f5f6f8; color: #1f2430; }
      main { max-width: 720px; margin: 48px auto; background: #fff; border-radius: 10px; padding: 28px 32px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
      h1 { font-size: 20px; margin: 0 0 12px; }
      #stage { font-weight: 600; }
      ul { line-height: 1.9; padding-left: 20px; }
      .ok { color: #1a7f37; }
      .fail { color: #c0392b; }
      .hint { color: #6b7280; font-size: 13px; margin-top: 18px; }
    </style>
  </head>
  <body>
    <main>
      <h1>本地开发数据复位</h1>
      <p id="stage">正在把本地存储恢复为示例数据…</p>
      <ul id="report"></ul>
      <p class="hint">复位完成后将自动返回工作台首页；也可<a href="/">点这里立即返回</a>。</p>
    </main>
    <script>
      const PAYLOAD = ${payload};

      function deepEqual(a, b) {
        if (a === b) return true
        if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
        const ka = Object.keys(a)
        const kb = Object.keys(b)
        if (ka.length !== kb.length) return false
        return ka.every((key) => deepEqual(a[key], b[key]))
      }

      function report(text, ok) {
        const item = document.createElement('li')
        item.textContent = text
        if (ok !== undefined) item.className = ok ? 'ok' : 'fail'
        document.getElementById('report').appendChild(item)
      }

      async function reportStatus(nonce, body) {
        try {
          await fetch('${ROUTE_PREFIX}/status?nonce=' + encodeURIComponent(nonce), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        } catch (error) {
          report('复位结果回传失败：' + error, false)
        }
      }

      async function main() {
        const nonce =
          new URLSearchParams(location.search).get('nonce') || 'manual-' + Date.now()
        const { storageKey, seed, labels } = PAYLOAD

        // 整体覆盖而不是合并：多跑几遍也是同一份示例数据，条目不会累积。
        localStorage.setItem(storageKey, JSON.stringify(seed))

        const actual = JSON.parse(localStorage.getItem(storageKey) || '{}')
        const keys = Object.keys(seed)
        const extraKeys = Object.keys(actual).filter((key) => !keys.includes(key))
        const mismatches = keys.filter((key) => !deepEqual(actual[key], seed[key]))
        const modules = keys.map((key) => ({
          key,
          name: labels[key] || key,
          count: seed[key].length,
        }))
        const total = modules.reduce((sum, item) => sum + item.count, 0)
        const ok = extraKeys.length === 0 && mismatches.length === 0

        modules.forEach((item) => report(item.name + '：' + item.count + ' 条（已回到示例数据）', true))
        if (extraKeys.length) report('存在示例数据之外的模块键：' + extraKeys.join('、'), false)
        if (mismatches.length) report('校验未通过的模块：' + mismatches.join('、'), false)

        const stage = document.getElementById('stage')
        if (ok) {
          stage.textContent = '复位完成：共 ' + modules.length + ' 个模块、' + total + ' 条记录，即将返回首页…'
          stage.className = 'ok'
        } else {
          stage.textContent = '复位后校验未通过，请查看日志后重试'
          stage.className = 'fail'
        }

        await reportStatus(nonce, { ok, total, modules, extraKeys, mismatches })
        if (ok) setTimeout(() => { location.href = '/' }, 2500)
      }

      main().catch(async (error) => {
        const nonce =
          new URLSearchParams(location.search).get('nonce') || 'manual-' + Date.now()
        document.getElementById('stage').textContent = '复位执行失败'
        document.getElementById('stage').className = 'fail'
        report(String(error && error.message ? error.message : error), false)
        await reportStatus(nonce, { ok: false, error: String(error) })
      })
    </script>
  </body>
</html>
`
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectBody)
  })
}

// 本地开发专用：给一键复位脚本提供「探测 / 复位页 / 结果回传 / 结果查询」四个路由。
export function devResetPlugin(): Plugin {
  return {
    name: 'archaeology-field-dev-reset',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith(ROUTE_PREFIX)) {
          next()
          return
        }

        try {
          const parsed = new URL(url, 'http://local')
          const pathname = parsed.pathname

          if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/ping`) {
            sendJson(res, 200, { ok: true })
            return
          }

          if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/reset`) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(renderResetPage(storageKey()))
            return
          }

          const nonce = parsed.searchParams.get('nonce') ?? ''
          if (!isSafeNonce(nonce)) {
            sendJson(res, 400, { ok: false, message: '非法的 nonce' })
            return
          }

          if (req.method === 'POST' && pathname === `${ROUTE_PREFIX}/status`) {
            const body = JSON.parse((await readBody(req)) || '{}') as {
              ok?: boolean
              total?: number
              error?: string
              modules?: { name: string; count: number }[]
            }
            ensureRuntimeDir()
            writeFileSync(
              statusFile(nonce),
              JSON.stringify({ ...body, at: new Date().toISOString() }, null, 2),
            )
            if (body.ok) {
              log(
                `复位成功 nonce=${nonce} 模块数=${body.modules?.length ?? 0} 记录总数=${body.total ?? 0}`,
              )
            } else {
              log(`复位失败 nonce=${nonce} 原因=${body.error ?? '模块数据与示例数据不一致'} `
                + `模块=${(body.modules ?? []).map((item) => item.name).join(',')}`)
            }
            sendJson(res, 200, { ok: true })
            return
          }

          if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/status`) {
            const file = statusFile(nonce)
            try {
              sendJson(res, 200, JSON.parse(readFileSync(file, 'utf8')))
            } catch {
              // 浏览器还没回传结果：保持 pending，由 CLI 继续轮询。
              sendJson(res, 404, { pending: true })
            }
            return
          }

          sendJson(res, 404, { ok: false, message: '未知的复位路由' })
        } catch (error) {
          log(`复位中间件异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
          sendJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      })
    },
  }
}
