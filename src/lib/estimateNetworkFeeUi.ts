import type { Network } from '../coins'
import { resolveRuntimeModelId } from './runtimeModel'

export function estimateNetworkFeeUi(network: Pick<Network, 'coinType' | 'feePerByte'> & Partial<Pick<Network, 'id' | 'runtimeModelId'>>): number {
  const modelId = resolveRuntimeModelId(network as Network)
  if (modelId === 'cosmos' || modelId === 'cro' || modelId === 'crocosmos') return 0.0025
  if (network.coinType === 'UTXO') {
    const rawFeePerByteCoins = Number(network.feePerByte ?? 0.0000002)
    let feePerByteSats = Math.max(1, Math.round(rawFeePerByteCoins * 1e8))
    if (feePerByteSats > 500) feePerByteSats = Math.max(1, Math.round(feePerByteSats / 1000))
    const estimatedBytes = 10 + (148 * 2) + (34 * 3)
    return (estimatedBytes * feePerByteSats) / 1e8
  }
  if (network.coinType === 'XRP') return 0.000012
  return 0.002151
}
