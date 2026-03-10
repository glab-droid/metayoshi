import type { CoinType } from '../coins/types'

export interface RuntimeModelSource {
  id?: string
  runtimeModelId?: string
  coinType?: CoinType
}

export function resolveRuntimeModelId(network?: RuntimeModelSource): string {
  return String(network?.runtimeModelId || network?.id || '').trim().toLowerCase()
}

export function isCosmosModelId(modelId: string): boolean {
  return String(modelId || '').trim().toLowerCase() === 'cosmos'
}

export function isCosmosLikeModelId(modelId: string): boolean {
  return isCosmosModelId(modelId)
}

export function isCosmosNetwork(network?: RuntimeModelSource): boolean {
  return isCosmosModelId(resolveRuntimeModelId(network))
}

export function isCosmosLikeNetwork(network?: RuntimeModelSource): boolean {
  return isCosmosLikeModelId(resolveRuntimeModelId(network))
}

export function requiresMnemonicForNetwork(network?: RuntimeModelSource): boolean {
  const modelId = resolveRuntimeModelId(network)
  const coinType = String(network?.coinType || '').trim().toUpperCase()
  if (coinType === 'EVM' || coinType === 'UTXO' || coinType === 'COSMOS') return true
  if (modelId === 'ada') return true
  if (modelId === 'sol') return true
  if (modelId === 'sui') return true
  if (modelId === 'xlm') return true
  if (modelId === 'tron') return true
  if (isCosmosModelId(modelId)) return true
  return false
}
