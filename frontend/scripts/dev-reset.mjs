#!/usr/bin/env node
// 本地开发一键复位：
//   1. 检查运行依赖是否装齐（缺了只提示安装命令，不擅自安装）
//   2. 以 src/data/seed.json 为唯一来源生成示例快照（整库覆盖语义，重复执行不追加）
//   3. 校验快照完整（样品封装等全部模块、条目数与字段）
//   4. 生成复位令牌并置位（arm.json）
//   5. 以复位模式启动 vite dev server，前端打开时凭令牌把 localStorage 覆盖回示例数据
//
// 可断点续跑：前 3 步的完成情况记在 state.json，失败后重跑只补未完成的步骤；
// 全程写 reset.log，失败的步骤都会落日志。
// 所有路径都基于本脚本位置推导，换台机器、换个克隆目录都能直接跑。
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = join(scriptDir, '..')
const seedFile = join(frontendDir, 'src', 'data', 'seed.json')
const stateDir = join(frontendDir, '.dev-reset')
const stateFile = join(stateDir, 'state.json')
const logFile = join(stateDir, 'reset.log')
const snapshotFile = join(stateDir, 'snapshot.json')
const armFile = join(stateDir, 'arm.json')

const armOnly = process.argv.includes('--arm-only')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function timestamp() {
  return new Date().toISOString()
}

function log(level, message) {
  const line = `${timestamp()} [${level}] ${message}`
  console[level === 'ERROR' ? 'error' : 'log'](line)
  try {
    mkdirSync(stateDir, { recursive: true })
    appendFileSyncSafe(logFile, `${line}\n`)
  } catch {
    // 日志写不进去也不阻断复位本身
  }
}

function appendFileSyncSafe(path, text) {
  // 用 read+write 而不是 appendFile 的同步变体，保持只用内置同步原语
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  writeFileSync(path, existing + text)
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    return { steps: {} }
  }
}

function saveState(state) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`)
}

function markDone(state, step, detail) {
  state.steps[step] = { status: 'done', at: timestamp(), detail }
  saveState(state)
  log('INFO', `${step} DONE${detail ? ` - ${detail}` : ''}`)
}

function markFailed(state, step, message) {
  state.steps[step] = { status: 'failed', at: timestamp(), detail: message }
  saveState(state)
  log('ERROR', `${step} FAILED - ${message}`)
}

function fail(message, code = 1) {
  console.error(`\n✗ ${message}`)
  process.exit(code)
}

// ---- 步骤 1：依赖检查（每次都查，很快）----
function checkDependencies() {
  const major = Number(process.versions.node.split('.')[0])
  if (Number.isNaN(major) || major < 18) {
    fail(
      `Node.js 版本过低（当前 ${process.versions.node}），Vite 5 需要 Node 18+，请先升级 Node.js 后重试。`,
      2,
    )
  }
  const npmVersion = spawnSync(npmCommand, ['--version'], { encoding: 'utf8' })
  if (npmVersion.status !== 0) {
    fail('没有找到 npm，请先安装 Node.js（自带 npm）后重试。', 2)
  }
  const viteBin = join(
    frontendDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vite.cmd' : 'vite',
  )
  if (!existsSync(viteBin)) {
    const fromCwd = relative(process.cwd(), frontendDir) || '.'
    fail(
      [
        '依赖未安装（缺少 node_modules/.bin/vite）。请先执行：',
        '',
        `  cd ${fromCwd}`,
        '  npm install',
        '',
        '安装完成后重新运行：npm run dev:reset',
      ].join('\n'),
      2,
    )
  }
}

// ---- 步骤 2：由示例数据生成整库快照 ----
function loadSeed() {
  if (!existsSync(seedFile)) {
    throw new Error(`找不到示例数据文件 ${relative(frontendDir, seedFile)}`)
  }
  return JSON.parse(readFileSync(seedFile, 'utf8'))
}

function writeSnapshot(seed) {
  const seedHash = createHash('sha256').update(JSON.stringify(seed)).digest('hex')
  // rows 整库下发：前端是整体替换 localStorage，不是按模块追加，反复装载条目数也不会变。
  const snapshot = { generatedAt: timestamp(), seedHash, rows: seed }
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`)
  return seedHash
}

// ---- 步骤 3：校验快照 ----
function validateSnapshot() {
  if (!existsSync(snapshotFile)) {
    throw new Error('快照文件不存在，需要重新生成')
  }
  const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'))
  const seed = loadSeed()
  const expectedHash = createHash('sha256').update(JSON.stringify(seed)).digest('hex')
  if (snapshot.seedHash !== expectedHash) {
    throw new Error('快照与 src/data/seed.json 不一致，需要重新生成')
  }
  const rows = snapshot.rows
  if (typeof rows !== 'object' || rows === null) {
    throw new Error('快照结构不合法：缺少 rows')
  }
  const moduleKeys = Object.keys(rows)
  if (moduleKeys.length === 0) {
    throw new Error('快照为空：一个业务模块都没有')
  }
  if (!Array.isArray(rows.packing) || rows.packing.length === 0) {
    throw new Error('快照缺少样品封装(packing)示例数据')
  }
  for (const key of moduleKeys) {
    const list = rows[key]
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`模块 ${key} 的示例数据不是非空数组`)
    }
    list.forEach((row, index) => {
      if (typeof row !== 'object' || row === null) {
        throw new Error(`模块 ${key} 第 ${index + 1} 行不是记录对象`)
      }
      if (typeof row.id !== 'number' || typeof row.status !== 'string') {
        throw new Error(`模块 ${key} 第 ${index + 1} 行缺少 id/status 基础字段`)
      }
      if (typeof row.pending !== 'boolean' || typeof row.abnormal !== 'boolean') {
        throw new Error(`模块 ${key} 第 ${index + 1} 行缺少 pending/abnormal 标记`)
      }
    })
  }
  const total = moduleKeys.reduce((sum, key) => sum + rows[key].length, 0)
  return { moduleCount: moduleKeys.length, total, packingCount: rows.packing.length }
}

// ---- 步骤 4：置位 + 新令牌（每次复位都换新令牌，强制浏览器下一次打开再覆盖一次）----
function armReset() {
  const token = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`
  const arm = { armed: true, token, createdAt: timestamp() }
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(armFile, `${JSON.stringify(arm, null, 2)}\n`)
  return token
}

// ---- 步骤 5：以复位模式启动 dev server ----
function serve() {
  const child = spawn(npmCommand, ['run', 'dev'], {
    cwd: frontendDir,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_RESET: '1', DEV_RESET_DIR: stateDir },
    shell: process.platform === 'win32',
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

function run() {
  mkdirSync(stateDir, { recursive: true })
  const state = readState()
  state.steps = state.steps ?? {}

  log('INFO', `dev-reset START${armOnly ? ' (--arm-only)' : ''} cwd=${frontendDir}`)

  // 依赖检查每次都跑（快且必须可信）。
  try {
    checkDependencies()
    markDone(state, 'check-deps', 'node/npm 与 node_modules 均就绪')
  } catch (error) {
    markFailed(state, 'check-deps', error instanceof Error ? error.message : String(error))
    throw error
  }

  // 生成快照：已完成且 seed 未变就跳过（断点续跑）；否则重做，并让校验步骤随之重做。
  const seed = loadSeed()
  const currentHash = createHash('sha256').update(JSON.stringify(seed)).digest('hex')
  let snapshotExists = false
  try {
    const existing = existsSync(snapshotFile)
      ? JSON.parse(readFileSync(snapshotFile, 'utf8'))
      : null
    snapshotExists = existing?.seedHash === currentHash
  } catch {
    snapshotExists = false
  }
  if (state.steps['prepare-snapshot']?.status === 'done' && snapshotExists) {
    log('INFO', 'prepare-snapshot SKIP - 快照已存在且与 seed 一致')
  } else {
    try {
      const hash = writeSnapshot(seed)
      delete state.steps['verify-snapshot']
      markDone(state, 'prepare-snapshot', `seedHash=${hash.slice(0, 12)}…`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      markFailed(state, 'prepare-snapshot', message)
      fail(`生成示例快照失败：${message}\n详情见日志：${relative(process.cwd(), logFile)}`)
    }
  }

  // 校验快照：只要文件在就实际重校（读取很快），不盲信上次状态；
  // 失败则清掉坏快照，下次重跑从生成步骤补起。
  if (existsSync(snapshotFile)) {
    try {
      const summary = validateSnapshot()
      markDone(
        state,
        'verify-snapshot',
        `${summary.moduleCount} 个模块 / ${summary.total} 条记录 / 封装 ${summary.packingCount} 条`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      markFailed(state, 'verify-snapshot', message)
      rmSync(snapshotFile, { force: true })
      delete state.steps['prepare-snapshot']
      fail(`示例快照校验失败：${message}\n详情见日志：${relative(process.cwd(), logFile)}`)
    }
  } else {
    log('INFO', 'verify-snapshot PENDING - 快照尚不存在，交由生成步骤重建')
  }

  let token
  try {
    token = armReset()
    markDone(state, 'arm', `token=${token}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markFailed(state, 'arm', message)
    fail(`复位置位失败：${message}\n详情见日志：${relative(process.cwd(), logFile)}`)
  }

  console.log('')
  console.log('✓ 本地复位已就绪：浏览器打开 dev server 时会把全部模块清单覆盖回示例数据')
  console.log('  （含样品封装的封装记录、存放位置；同轮 dev server 内刷新只复位一次）')
  if (armOnly) {
    console.log('  --arm-only：未启动 dev server；随后用以下命令进入复位模式：')
    console.log(`    VITE_DEV_RESET=1 DEV_RESET_DIR="${stateDir}" npm run dev`)
    return
  }
  console.log('  正在启动 dev server …\n')
  serve()
}

try {
  run()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  log('ERROR', `dev-reset FATAL - ${message}`)
  process.exit(1)
}
