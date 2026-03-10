import type { CoinPayloadCatalog } from './types'
import { DASH_PAYLOADS } from './dash'

export const SERVER_SCAFFOLD_PAYLOADS_BY_NETWORK_ID: Record<string, CoinPayloadCatalog> = {
  dash: DASH_PAYLOADS
}
