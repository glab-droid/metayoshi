import type { Network } from '../coins'
import { resolveCoinModelFamily, type CoinModelFamily } from './coinModel'

export type EvmGasLane = 'economy' | 'balanced' | 'priority'
export type EvmIntent = 'send' | 'swap' | 'approve'
export type UtxoFeePreset = 'cheap' | 'fast' | 'premium'
export type UtxoInputStrategy = 'minimize-inputs' | 'consolidate-fragments'
export type UtxoTransferComposer = 'single' | 'batch'
export type ModelControlStatus = 'applied' | 'informational' | 'unsupported'

export interface NetworkModelPreferences {
  evmGasLane?: EvmGasLane
  evmIntent?: EvmIntent
  utxoFeePreset?: UtxoFeePreset
  utxoInputStrategy?: UtxoInputStrategy
  utxoTransferComposer?: UtxoTransferComposer
}

export interface NetworkModelControlDescriptor {
  key: string
  label: string
  status: ModelControlStatus
  description: string
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function normalizeEvmGasLane(value: unknown): EvmGasLane {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'economy' || raw === 'priority') return raw
  return 'balanced'
}

function normalizeEvmIntent(value: unknown): EvmIntent {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'swap' || raw === 'approve') return raw
  return 'send'
}

function normalizeUtxoFeePreset(value: unknown): UtxoFeePreset {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'cheap' || raw === 'premium') return raw
  return 'fast'
}

function normalizeUtxoInputStrategy(value: unknown): UtxoInputStrategy {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'consolidate-fragments') return raw
  return 'minimize-inputs'
}

function normalizeUtxoTransferComposer(value: unknown): UtxoTransferComposer {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'batch') return raw
  return 'single'
}

export function resolveDefaultNetworkModelPreferences(
  network?: Pick<Network, 'id' | 'runtimeModelId' | 'coinType' | 'capabilities'>
): NetworkModelPreferences {
  const family = network ? resolveCoinModelFamily(network as Network) : 'generic'
  switch (family) {
    case 'evm':
      return {
        evmGasLane: 'balanced',
        evmIntent: 'send'
      }
    case 'utxo-classic':
      return {
        utxoFeePreset: 'fast',
        utxoInputStrategy: 'minimize-inputs'
      }
    case 'utxo-assets':
      return {
        utxoTransferComposer: 'single'
      }
    default:
      return {}
  }
}

export function normalizeNetworkModelPreferences(
  raw: unknown,
  network?: Pick<Network, 'id' | 'runtimeModelId' | 'coinType' | 'capabilities'>
): NetworkModelPreferences {
  const base = resolveDefaultNetworkModelPreferences(network)
  const source = asObject(raw)
  const next: NetworkModelPreferences = { ...base }
  if (base.evmGasLane !== undefined) {
    next.evmGasLane = normalizeEvmGasLane(source.evmGasLane ?? base.evmGasLane)
  }
  if (base.evmIntent !== undefined) {
    next.evmIntent = normalizeEvmIntent(source.evmIntent ?? base.evmIntent)
  }
  if (base.utxoFeePreset !== undefined) {
    next.utxoFeePreset = normalizeUtxoFeePreset(source.utxoFeePreset ?? base.utxoFeePreset)
  }
  if (base.utxoInputStrategy !== undefined) {
    next.utxoInputStrategy = normalizeUtxoInputStrategy(source.utxoInputStrategy ?? base.utxoInputStrategy)
  }
  if (base.utxoTransferComposer !== undefined) {
    next.utxoTransferComposer = normalizeUtxoTransferComposer(source.utxoTransferComposer ?? base.utxoTransferComposer)
  }
  return next
}

export function normalizeNetworkModelPreferencesRecord(
  raw: unknown,
  networks: Array<Pick<Network, 'id' | 'runtimeModelId' | 'coinType' | 'capabilities'>>
): Record<string, NetworkModelPreferences> {
  const source = asObject(raw)
  const byId = new Map<string, Pick<Network, 'id' | 'runtimeModelId' | 'coinType' | 'capabilities'>>(
    networks.map((network) => [String(network.id || '').trim(), network])
  )
  const out: Record<string, NetworkModelPreferences> = {}
  for (const [networkId, value] of Object.entries(source)) {
    const normalizedId = String(networkId || '').trim()
    if (!normalizedId) continue
    out[normalizedId] = normalizeNetworkModelPreferences(value, byId.get(normalizedId))
  }
  return out
}

export function resolveNetworkModelControls(network: Network): NetworkModelControlDescriptor[] {
  const family: CoinModelFamily = resolveCoinModelFamily(network)
  switch (family) {
    case 'evm':
      return [
        {
          key: 'evm-gas-orbit',
          label: 'Gas Orbit',
          status: 'applied',
          description: 'Applied to native, ERC-20, and NFT sends by adjusting gas fee selection before signing.'
        },
        {
          key: 'evm-intent',
          label: 'Intent Deck',
          status: 'informational',
          description: 'Tracked for future intent-aware flows. It does not change execution yet.'
        }
      ]
    case 'utxo-classic':
      return [
        {
          key: 'utxo-fee-preset',
          label: 'Fee Preset',
          status: 'applied',
          description: 'Applied to sat/vbyte selection for the next UTXO send.'
        },
        {
          key: 'utxo-input-strategy',
          label: 'Input Strategy',
          status: 'applied',
          description: 'Applied to UTXO selection order for the next spend.'
        }
      ]
    case 'utxo-assets':
      return [
        {
          key: 'utxo-transfer-composer',
          label: 'Transfer Composer',
          status: 'applied',
          description: 'Applied when an asset send can be routed as a consolidated multi-holder batch from Send Hub.'
        }
      ]
    default:
      return []
  }
}
