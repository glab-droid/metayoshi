import type { Network } from '../coins'

function normalizeNetworkIdValue(value: unknown): string {
  return String(value || '').trim()
}

export function normalizeDisabledNetworkIds(
  disabledNetworkIds: unknown,
  networks: Network[]
): string[] {
  if (!Array.isArray(disabledNetworkIds)) return []
  const knownIds = new Set(networks.map((network) => normalizeNetworkIdValue(network.id)).filter(Boolean))
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of disabledNetworkIds) {
    const networkId = normalizeNetworkIdValue(value)
    if (!networkId || !knownIds.has(networkId) || seen.has(networkId)) continue
    seen.add(networkId)
    out.push(networkId)
  }
  return out
}

export function getEnabledNetworks(networks: Network[], disabledNetworkIds: unknown): Network[] {
  const normalizedDisabled = new Set(normalizeDisabledNetworkIds(disabledNetworkIds, networks))
  const filtered = networks.filter((network) => !normalizedDisabled.has(normalizeNetworkIdValue(network.id)))
  return filtered.length > 0 ? filtered : networks
}

export function isNetworkEnabled(networkId: string, disabledNetworkIds: unknown): boolean {
  if (!Array.isArray(disabledNetworkIds)) return true
  const target = normalizeNetworkIdValue(networkId)
  return !disabledNetworkIds.some((value) => normalizeNetworkIdValue(value) === target)
}
