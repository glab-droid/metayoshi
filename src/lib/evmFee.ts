import { ethers } from 'ethers'
import { callBridgeMethod, type UtxoRpcConfig } from './utxoRpc'
import type { EvmGasLane } from './coinFeatureModel'

export type EvmFeeQuote = {
  gasLimit: bigint
  estimatedFeeWei: bigint
  gasPrice?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  type?: 2
}

type EstimateInput = {
  rpcConfig: UtxoRpcConfig
  from: string
  to?: string
  valueWei?: bigint
  data?: string
  fallbackGasLimitHex: string
  lane?: EvmGasLane
}

function scaleFee(value: bigint, lane: EvmGasLane | undefined): bigint {
  if (lane === 'economy') return (value * 85n) / 100n
  if (lane === 'priority') return (value * 130n) / 100n
  return value
}

function parseHexBigInt(value: unknown, fallback = 0n): bigint {
  try {
    const raw = String(value ?? '').trim()
    if (!raw) return fallback
    return BigInt(raw)
  } catch {
    return fallback
  }
}

export async function estimateEvmTxFee(input: EstimateInput): Promise<EvmFeeQuote> {
  const lane = input.lane || 'balanced'
  const valueWei = input.valueWei ?? 0n
  const txForEstimate: Record<string, string> = {
    from: input.from,
    value: ethers.toQuantity(valueWei)
  }
  const to = String(input.to || '').trim()
  if (to) txForEstimate.to = to
  const data = String(input.data || '').trim()
  if (data) txForEstimate.data = data

  let gasLimitHex = input.fallbackGasLimitHex
  try {
    gasLimitHex = await callBridgeMethod(input.rpcConfig, 'eth_estimateGas', [txForEstimate])
  } catch {
    // Keep fallback gas limit.
  }
  const gasLimit = parseHexBigInt(gasLimitHex, parseHexBigInt(input.fallbackGasLimitHex, 21_000n))

  let gasPriceWei = 1_000_000_000n
  try {
    gasPriceWei = parseHexBigInt(await callBridgeMethod(input.rpcConfig, 'eth_gasPrice', []), gasPriceWei)
  } catch {
    // Keep fallback gas price.
  }

  let baseFeeWei = 0n
  try {
    const latest = await callBridgeMethod(input.rpcConfig, 'eth_getBlockByNumber', ['latest', false])
    baseFeeWei = parseHexBigInt((latest as any)?.baseFeePerGas, 0n)
  } catch {
    // Node may not expose base fee.
  }

  if (baseFeeWei > 0n) {
    let maxPriorityFeePerGas = 1_500_000_000n
    try {
      maxPriorityFeePerGas = parseHexBigInt(
        await callBridgeMethod(input.rpcConfig, 'eth_maxPriorityFeePerGas', []),
        maxPriorityFeePerGas
      )
    } catch {
      // Keep fallback priority fee.
    }

    maxPriorityFeePerGas = scaleFee(maxPriorityFeePerGas, lane)
    if (maxPriorityFeePerGas < 1_000_000_000n) {
      maxPriorityFeePerGas = 1_000_000_000n
    }

    // Keep max fee above both (2 * base + priority) and current gasPrice.
    const candidateFromBase = (baseFeeWei * 2n) + maxPriorityFeePerGas
    const candidateFromGasPrice = gasPriceWei + maxPriorityFeePerGas
    let maxFeePerGas = candidateFromBase > candidateFromGasPrice ? candidateFromBase : candidateFromGasPrice
    maxFeePerGas = scaleFee(maxFeePerGas, lane)
    if (maxFeePerGas <= maxPriorityFeePerGas) {
      maxFeePerGas = maxPriorityFeePerGas + 1_000_000_000n
    }
    return {
      type: 2,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      estimatedFeeWei: gasLimit * maxFeePerGas
    }
  }

  gasPriceWei = scaleFee(gasPriceWei, lane)
  if (gasPriceWei <= 0n) gasPriceWei = 1_000_000_000n
  return {
    gasLimit,
    gasPrice: gasPriceWei,
    estimatedFeeWei: gasLimit * gasPriceWei
  }
}
