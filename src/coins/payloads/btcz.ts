import { createUtxoPayloadCatalog } from './common'

export const BTCZ_PAYLOADS = createUtxoPayloadCatalog({
  networkId: 'btcz',
  symbol: 'BTCZ',
  coinId: 'bitcoinz',
  chain: 'main'
})

