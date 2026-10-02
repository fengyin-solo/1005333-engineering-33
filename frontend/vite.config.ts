import { fileURLToPath, URL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

// 本地复位脚本（scripts/dev-reset.mjs）把令牌和示例快照写进 .dev-reset/，
// 并以 VITE_DEV_RESET=1 起 dev server；前端启动时通过下面两个只读地址取回复位数据。
const ARM_PATH = '/__dev_reset/arm'
const SNAPSHOT_PATH = '/__dev_reset/snapshot'

function devResetPlugin(): Plugin {
  return {
    name: 'local-dev-reset',
    configureServer(server) {
      const stateDir =
        process.env.DEV_RESET_DIR ?? fileURLToPath(new URL('./.dev-reset', import.meta.url))

      const sendJson = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(body))
      }

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        const isResetPath = url.startsWith(ARM_PATH) || url.startsWith(SNAPSHOT_PATH)
        if (req.method !== 'GET' || !isResetPath) {
          next()
          return
        }
        // 只有以复位模式（npm run dev:reset）起的 dev server 才下发数据；
        // 普通 npm run dev 直接 404，前端据此跳过复位。
        if (process.env.VITE_DEV_RESET !== '1') {
          sendJson(res, 404, { armed: false })
          return
        }
        if (url.startsWith(ARM_PATH)) {
          const armFile = join(stateDir, 'arm.json')
          if (!existsSync(armFile)) {
            sendJson(res, 409, { armed: false, message: '复位未置位，请运行 npm run reset:local' })
            return
          }
          sendJson(res, 200, JSON.parse(readFileSync(armFile, 'utf8')))
          return
        }
        const snapshotFile = join(stateDir, 'snapshot.json')
        if (!existsSync(snapshotFile)) {
          sendJson(res, 404, { armed: false, message: '缺少示例快照' })
          return
        }
        sendJson(res, 200, JSON.parse(readFileSync(snapshotFile, 'utf8')))
      })
    },
  }
}

// 纯前端应用：没有后端，也就没有 /api 代理，数据全部走 src/api/local-service.ts。
export default defineConfig({
  plugins: [vue(), devResetPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 关掉自动打开页面：起服务时只打印地址，不拉起浏览器
    open: false,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
