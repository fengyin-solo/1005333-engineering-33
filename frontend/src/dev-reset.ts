import { getDevResetToken, replaceAllRows, setDevResetToken } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 复位脚本把 dev server 置为「待复位」状态后，会通过这两个只读地址下发令牌和示例快照。
const ARM_URL = '/__dev_reset/arm'
const SNAPSHOT_URL = '/__dev_reset/snapshot'

type ArmPayload = { armed: true; token: string; createdAt: string }
type SnapshotPayload = { rows: Record<string, EntryRow[]> }

function isArmPayload(value: unknown): value is ArmPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const payload = value as Record<string, unknown>
  return payload.armed === true && typeof payload.token === 'string'
}

function isSnapshotPayload(value: unknown): value is SnapshotPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const rows = (value as Record<string, unknown>).rows
  return typeof rows === 'object' && rows !== null
}

// 开发模式启动钩子：待复位时把整库覆盖回示例快照，再让应用挂载。
// 同轮 dev server 只复位一次；普通 npm run dev（未置位）直接跳过，行为与过去一致。
export async function applyDevReset(): Promise<void> {
  if (import.meta.env.PROD) {
    return
  }
  try {
    const armResponse = await fetch(ARM_URL)
    if (!armResponse.ok) {
      return
    }
    const arm = await armResponse.json()
    if (!isArmPayload(arm) || getDevResetToken() === arm.token) {
      return
    }
    const snapshotResponse = await fetch(SNAPSHOT_URL)
    if (!snapshotResponse.ok) {
      console.warn('[dev-reset] 示例快照读取失败，本次跳过复位')
      return
    }
    const snapshot = await snapshotResponse.json()
    if (!isSnapshotPayload(snapshot)) {
      console.warn('[dev-reset] 示例快照格式不正确，本次跳过复位')
      return
    }
    replaceAllRows(snapshot.rows)
    setDevResetToken(arm.token)
    const moduleCount = Object.keys(snapshot.rows).length
    const rowCount = Object.values(snapshot.rows).reduce((sum, rows) => sum + rows.length, 0)
    console.info(
      `[dev-reset] 本地数据已复位为示例数据：${moduleCount} 个模块、${rowCount} 条记录`,
    )
  } catch {
    // dev server 没有挂复位中间件（或请求失败）时按普通开发模式启动，不阻断页面。
  }
}
