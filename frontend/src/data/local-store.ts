import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'archaeology-field:entries'
// 开发复位：复位脚本随 dev server 下发令牌，浏览器侧令牌对不上就把整库覆盖回示例数据。
const RESET_TOKEN_KEY = 'archaeology-field:dev-reset-token'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 整库覆盖回示例数据：整体替换而不是按模块追加，反复执行条目也不会变多。
// 所有业务模块（含样品封装的封装记录、存放位置）一并回到初始状态，清单和看板随之同步。
export function replaceAllRows(rows: Record<string, EntryRow[]>): void {
  const next = clone(rows)
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 浏览器里记住的最近一次复位令牌；没有则返回 null。
export function getDevResetToken(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage.getItem(RESET_TOKEN_KEY)
}

// 复位完成后记下令牌：同一轮 dev server 再刷新不会重复复位，换轮次令牌变化才会再复位。
export function setDevResetToken(token: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(RESET_TOKEN_KEY, token)
  }
}
