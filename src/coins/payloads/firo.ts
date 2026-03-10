import { createUtxoPayloadCatalog } from './common'

export const FIRO_PAYLOADS = createUtxoPayloadCatalog({
  networkId: 'firo',
  symbol: 'FIRO',
  coinId: 'firo',
  chain: 'main'
})
