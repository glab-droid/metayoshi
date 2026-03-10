import { createUtxoPayloadCatalog } from './common'

export const RTM_PAYLOADS = createUtxoPayloadCatalog({
  networkId: 'rtm',
  symbol: 'RTM',
  coinId: 'raptoreum',
  chain: 'main'
})

