import type { CoinModule } from './types'

export type CoinProtocolFamily =
  | 'evm'
  | 'utxo'
  | 'cosmos'
  | 'cardano'
  | 'monero'
  | 'solana'
  | 'sui'
  | 'stellar'
  | 'tron'
  | 'xrp'
  | 'generic'

export interface CoinManifest {
  id: string
  runtimeModelId: string
  protocolFamily: CoinProtocolFamily
  coinId: string
  chain: 'main' | 'test'
  aliases?: string[]
  chainId?: number
  includeInEvmSet?: boolean
  isEthereumLayer2?: boolean
  testedByDefault?: boolean
  visibleByDefault?: boolean
}

export interface BundledCoinRegistryEntry {
  manifest: CoinManifest
  coin: CoinModule
}
