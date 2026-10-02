import type { EntryRow } from './types'
import seed from './seed.json'

// 示例数据的唯一来源是 seed.json：首次打开播种、本地复位时覆盖，重置都会回到这份。
export const SEED_ROWS = seed as Record<string, EntryRow[]>
