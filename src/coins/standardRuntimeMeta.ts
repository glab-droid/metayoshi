import type { CoinProtocolFamily } from './registryTypes'
import { getStandardRuntimeMetaMap } from './coinRegistry'

export type StandardRuntimeMeta = {
  symbol: string
  coinId: string
  chain?: 'main' | 'test'
  protocolFamily: CoinProtocolFamily
  chainId?: number
}

export const STANDARD_RUNTIME_META: Record<string, StandardRuntimeMeta> = getStandardRuntimeMetaMap()
