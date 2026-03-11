import type { CoinType } from '../coins/types'

export interface RuntimeModelSource {
  id?: string
  runtimeModelId?: string
  coinType?: CoinType
}

export function resolveRuntimeModelId(network?: RuntimeModelSource): string {
  return String(network?.runtimeModelId || network?.id || '').trim().toLowerCase()
}

export function isCroCosmosModelId(modelId: string): boolean {
  const normalized = String(modelId || '').trim().toLowerCase()
  return normalized === 'crocosmos' || normalized === 'cro'
}

export function isCosmosModelId(modelId: string): boolean {
  return String(modelId || '').trim().toLowerCase() === 'cosmos'
}

export function isCosmosLikeModelId(modelId: string): boolean {
  const normalized = String(modelId || '').trim().toLowerCase()
  return normalized === 'cosmos' || isCroCosmosModelId(normalized)
}

export function isCroCosmosNetwork(network?: RuntimeModelSource): boolean {
  return isCroCosmosModelId(resolveRuntimeModelId(network))
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
  if (coinType === 'EVM' || coinType === 'XRP' || coinType === 'UTXO' || coinType === 'COSMOS') return true
  if (modelId === 'ada') return true
  if (modelId === 'xmr') return true
  if (modelId === 'sol') return true
  if (modelId === 'sui') return true
  if (modelId === 'xlm') return true
  if (modelId === 'tron') return true
  if (isCosmosLikeModelId(modelId)) return true
  return false
}
