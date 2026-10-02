#!/usr/bin/env node
/**
 * 本地开发一键复位脚本（npm run reset:dev）。
 *
 * 步骤（每一步都会把结果写进 .dev-reset/state.json，失败重跑只补未完成的步骤）：
 *   1. check-deps  检查依赖是否装齐，缺了直接提示要跑的安装命令；
 *   2. dev-server  探测本地 dev server，没有就在后台拉起（端口被占用就换端口并解析新端口）；
 *   3. reset       打开复位页，页面把 localStorage 整体覆盖为示例数据并回传校验结果。
 *
 * 数据存在浏览器 localStorage 里，Node 无法直接写入，最后一步必须由浏览器执行；
 * 脚本会自动打开复位页并轮询结果，无浏览器时会打印手工打开的地址。
 */
import { spawn, exec } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const HERE = dirname(fileURLToPath(import.meta.url))
// 所有路径都相对脚本所在位置向上推导，换机器、换目录都不依赖本机绝对路径。
const FRONTEND_ROOT = resolve(HERE, '..')
const RUNTIME_DIR = resolve(FRONTEND_ROOT, '.dev-reset')
const STATE_FILE = resolve(RUNTIME_DIR, 'state.json')
const LOG_FILE = resolve(RUNTIME_DIR, 'reset.log')
const ROUTE_PREFIX = '/__dev_reset'
const PREFERRED_PORT = process.env.RESET_DEV_PORT || '5173'
const RESET_TIMEOUT_MS = Number(process.env.RESET_TIMEOUT_MS || 120_000)
const POLL_INTERVAL_MS = 1_000

// 依赖清单：包名 -> 需要存在的文件（相对 node_modules）。
// 用最能代表「包真的装好了」的入口/产物做探针，native 二进制由 vite 自身启动兜底。
const REQUIRED_PACKAGES = {
  vue: ['package.json', 'dist/vue.runtime.esm-browser.js'],
  'vue-router': ['package.json', 'dist/vue-router.mjs'],
  pinia: ['package.json', 'dist/pinia.mjs'],
  vite: ['package.json', 'bin/vite.js'],
  '@vitejs/plugin-vue': ['package.json', 'dist/index.cjs'],
  typescript: ['package.json', 'bin/tsc'],
  'vue-tsc': ['package.json', 'bin/vue-tsc.js'],
}

function ensureRuntimeDir() {
  mkdirSync(RUNTIME_DIR, { recursive: true })
}

function log(line) {
  ensureRuntimeDir()
  appendFileSync(LOG_FILE, `${new Date().toISOString()} [cli] ${line}\n`)
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(state) {
  ensureRuntimeDir()
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function printOk(text) {
  console.log(`\x1b[32m✓\x1b[0m ${text}`)
}

function printFail(text) {
  console.log(`\x1b[31m✗\x1b[0m ${text}`)
}

function fail(step, message, error) {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error ?? '')
  log(`步骤 ${step} 失败：${message} ${detail}`)
  printFail(message)
  console.log(`  日志：${LOG_FILE}`)
  process.exitCode = 1
}

// ---- 步骤 1：依赖检查 -------------------------------------------------------

function checkDeps() {
  const missing = Object.entries(REQUIRED_PACKAGES)
    .filter(([name, files]) =>
      files.some((file) => !existsSync(resolve(FRONTEND_ROOT, 'node_modules', name, file))))
    .map(([name]) => name)
  if (missing.length > 0) {
    const installCmd = 'npm install'
    const message =
      `依赖没有装齐（缺少：${missing.join('、')}）。\n` +
      `  请先在前端目录执行安装：\n` +
      `    ${installCmd}`
    printFail(message)
    console.log(`  前端目录：${FRONTEND_ROOT}`)
    log(`依赖检查未通过，缺少：${missing.join('、')}；请运行 ${installCmd}`)
    process.exitCode = 1
    return false
  }
  printOk('依赖检查通过（node_modules 已装齐）')
  log('依赖检查通过')
  return true
}

// ---- 步骤 2：确保 dev server 在线 -------------------------------------------

async function fetchPing(port) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_000)
  try {
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE_PREFIX}/ping`, {
      signal: controller.signal,
    })
    if (!res.ok) return false
    const body = await res.json()
    return body.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function startDevServer() {
  // vite 输出转发到当前终端，同时从输出里解析实际监听端口（首选端口被占时会换端口）。
  const child = spawn(
    process.execPath,
    [resolve(FRONTEND_ROOT, 'node_modules/vite/bin/vite.js')],
    { cwd: FRONTEND_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let port = null
  const parsePort = (chunk) => {
    const text = chunk.toString()
    const match = text.match(/https?:\/\/[^:\s]+:(\d+)\//)
    if (match) port = match[1]
    process.stdout.write(text)
  }
  child.stdout.on('data', parsePort)
  child.stderr.on('data', parsePort)
  child.on('exit', (code) => log(`dev server 子进程退出，code=${code}`))
  return { child, getPort: () => port }
}

async function ensureDevServer(state) {
  if (state.devServer && state.devServer.port && await fetchPing(state.devServer.port)) {
    printOk(`复用已在运行的 dev server：http://127.0.0.1:${state.devServer.port}/`)
    return state.devServer.port
  }
  if (await fetchPing(PREFERRED_PORT)) {
    printOk(`复用已在运行的 dev server：http://127.0.0.1:${PREFERRED_PORT}/`)
    return PREFERRED_PORT
  }

  console.log('未探测到 dev server，正在后台拉起（npm run dev）…')
  log('未探测到 dev server，开始拉起子进程')
  const { child, getPort } = startDevServer()

  const deadline = Date.now() + 60_000
  let port = getPort()
  while (Date.now() < deadline) {
    port = getPort()
    if (port && await fetchPing(port)) break
    if (child.exitCode !== null) {
      throw new Error(`dev server 启动后退出，exitCode=${child.exitCode}`)
    }
    await delay(300)
  }
  if (!(port && await fetchPing(port))) {
    throw new Error('dev server 在 60 秒内没有就绪')
  }
  // 脚本退出时不杀子进程，让工作台可以直接继续用。
  state.devServer = { port, startedByReset: true, pid: child.pid }
  saveState(state)
  printOk(`dev server 已就绪：http://127.0.0.1:${port}/`)
  log(`dev server 已就绪，端口=${port} pid=${child.pid}`)
  return port
}

// ---- 步骤 3：打开复位页并等待回传结果 ---------------------------------------

function openBrowser(url) {
  // 按平台选择打开命令；命令不存在/启动失败时回传 false，退化为提示手工打开。
  const platform = process.platform
  const command =
    platform === 'darwin'
      ? `open ${JSON.stringify(url)}`
      : platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open ${JSON.stringify(url)}`
  try {
    const child = exec(command)
    child.on('error', (error) => log(`自动打开浏览器失败：${error.message}`))
    return true
  } catch {
    return false
  }
}

async function pollStatus(port, nonce) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}${ROUTE_PREFIX}/status?nonce=${encodeURIComponent(nonce)}`,
      { signal: controller.signal },
    )
    return { status: res.status, body: await res.json() }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function runReset(port, state) {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const url = `http://127.0.0.1:${port}${ROUTE_PREFIX}/reset?nonce=${nonce}`

  console.log('正在打开复位页执行复位…')
  const autoOpened = openBrowser(url)
  if (!autoOpened) {
    console.log('没有找到可用的浏览器打开命令，请在浏览器中手工打开下面的地址完成复位：')
  }
  console.log(`  ${url}`)
  log(`等待浏览器回传复位结果，nonce=${nonce}，超时=${RESET_TIMEOUT_MS}ms`)

  const deadline = Date.now() + RESET_TIMEOUT_MS
  while (Date.now() < deadline) {
    const result = await pollStatus(port, nonce)
    if (result && result.status === 200 && result.body && typeof result.body.ok === 'boolean') {
      if (result.body.ok) {
        for (const item of result.body.modules ?? []) {
          printOk(`${item.name}：${item.count} 条，已回到示例数据`)
        }
        printOk(`复位完成：共 ${result.body.modules?.length ?? 0} 个模块、${result.body.total ?? 0} 条记录`)
        log(`复位成功，nonce=${nonce}`)
        state.lastReset = { ok: true, at: result.body.at ?? new Date().toISOString(), nonce }
        saveState(state)
        return true
      }
      fail('reset', `复位校验未通过：${result.body.error ?? '部分模块数据与示例数据不一致'}，可重跑本命令重试未完成步骤`)
      state.lastReset = { ok: false, at: new Date().toISOString(), nonce }
      saveState(state)
      return false
    }
    await delay(POLL_INTERVAL_MS)
  }
  fail(
    'reset',
    `等待浏览器复位结果超时（${Math.round(RESET_TIMEOUT_MS / 1000)} 秒）。` +
      '若浏览器未自动打开，请打开上面的地址；确认完成后重跑本命令即可。',
  )
  return false
}

// ---- 主流程 -----------------------------------------------------------------

async function main() {
  ensureRuntimeDir()
  const state = loadState()
  console.log('=== 本地开发数据一键复位 ===')

  // 依赖检查很快且必须成立，每次都重新校验，不做跳过。
  if (!checkDeps()) {
    state.steps = { ...state.steps, 'check-deps': { ok: false, at: new Date().toISOString() } }
    saveState(state)
    process.exit(1)
  }
  state.steps = { ...state.steps, 'check-deps': { ok: true, at: new Date().toISOString() } }

  let port
  try {
    port = await ensureDevServer(state)
    state.steps['dev-server'] = { ok: true, at: new Date().toISOString(), port }
    saveState(state)
  } catch (error) {
    state.steps['dev-server'] = { ok: false, at: new Date().toISOString() }
    saveState(state)
    fail('dev-server', 'dev server 未能就绪，请查看日志后重跑本命令', error)
    process.exit(1)
  }

  const ok = await runReset(port, state)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  fail('main', '复位脚本异常退出，可重跑本命令继续未完成步骤', error)
  process.exit(1)
})
