import { createUtxoPayloadCatalog } from './common'

export const DASH_PAYLOADS = createUtxoPayloadCatalog({
  networkId: 'dash',
  symbol: 'DASH',
  coinId: 'dash',
  chain: 'main'
})
