import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveNetworkCapabilities } from '../../lib/networkCapabilities'
import { parseSolanaAssetType } from '../../lib/assetTypes'
import { useWalletStore } from '../../store/walletStore'

export function formatAssetAmount(raw: number): string {
  return (raw / 1e8).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 })
}

export function parseAssetName(name: string): { root: string; sub: string | null } {
  const pipeIdx = name.indexOf('|')
  if (pipeIdx >= 0) return { root: name.slice(0, pipeIdx).trim(), sub: name.slice(pipeIdx + 1).trim() || null }
  const slashIdx = name.indexOf('/')
  if (slashIdx >= 0) return { root: name.slice(0, slashIdx).trim(), sub: name.slice(slashIdx + 1).trim() || null }
  return { root: name.trim(), sub: null }
}

export function isRootAssetName(name: string): boolean {
  return !parseAssetName(name).sub
}

export function useAssetListModel() {
  const {
    activeAccountId,
    networks,
    activeNetworkId,
    networkAssets,
    networkAssetLogos,
    networkAssetLabels,
    evmNftAssets,
    accountNetworkAssets,
    accountNetworkAssetLogos,
    accountNetworkAssetLabels,
    accountNetworkEvmNftAssets,
    accountNetworkFiatAssets,
    fetchNetworkAssets,
    fetchNetworkFiat,
    fetchAssetDetails,
    activity
  } = useWalletStore()

  const [previewByAsset, setPreviewByAsset] = useState<Record<string, boolean>>({})
  const checkingRef = useRef<Set<string>>(new Set())
  const previewByAssetRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    previewByAssetRef.current = previewByAsset
  }, [previewByAsset])

  const activeNetwork = networks.find((network) => network.id === activeNetworkId) || networks[0]
  const caps = resolveNetworkCapabilities(activeNetwork)
  const activeModelId = String(activeNetwork?.runtimeModelId || activeNetwork?.id || '').trim().toLowerCase()
  const isEvmEcosystem = activeNetwork?.coinType === 'EVM'
  const isSolanaEcosystem = activeNetwork?.coinType === 'SOL' || activeModelId === 'sol'
  const supportsPreview =
    activeNetwork?.coinType === 'UTXO'
    || activeNetwork?.coinType === 'EVM'
    || activeModelId === 'sol'
    || activeModelId === 'ada'
    || activeModelId === 'tron'
  const canOpenAssetSend = caps.features.assetSend

  const fiatScopeKey = `${String(activeAccountId || '').trim().toLowerCase()}::${String(activeNetworkId || '').trim().toLowerCase()}`
  const rawAssets = accountNetworkAssets[fiatScopeKey] ?? networkAssets[activeNetworkId] ?? {}
  const assetLogos = accountNetworkAssetLogos[fiatScopeKey] ?? networkAssetLogos[activeNetworkId] ?? {}
  const assetLabels = accountNetworkAssetLabels[fiatScopeKey] ?? networkAssetLabels[activeNetworkId] ?? {}
  const nftLookup = accountNetworkEvmNftAssets[fiatScopeKey] ?? evmNftAssets[activeNetworkId] ?? {}
  const fiatByAsset = accountNetworkFiatAssets[fiatScopeKey] ?? {}
  const allEntries = useMemo(() => Object.entries(rawAssets), [rawAssets])

  const assetUsage = useMemo(() => {
    const out = new Map<string, number>()
    for (const row of activity) {
      if (String(row?.networkId || '').trim() !== activeNetworkId) continue
      const name = String(row?.asset || '').trim().toLowerCase()
      if (!name) continue
      out.set(name, (out.get(name) || 0) + 1)
    }
    return out
  }, [activity, activeNetworkId])

  const byUsageThenName = useCallback((a: string, b: string): number => {
    const delta = (assetUsage.get(b.toLowerCase()) || 0) - (assetUsage.get(a.toLowerCase()) || 0)
    if (delta !== 0) return delta
    return a.localeCompare(b)
  }, [assetUsage])

  const roots = useMemo(
    () => allEntries.filter(([name]) => isRootAssetName(name)).sort(([a], [b]) => byUsageThenName(a, b)),
    [allEntries, byUsageThenName]
  )
  const subs = useMemo(
    () => allEntries.filter(([name]) => !isRootAssetName(name)).sort(([a], [b]) => byUsageThenName(a, b)),
    [allEntries, byUsageThenName]
  )
  const sorted = useMemo(() => [...roots, ...subs], [roots, subs])
  const assetSignature = useMemo(() => sorted.map(([name]) => name).join('|'), [sorted])

  const isPreviewableAssetName = useCallback((name: string): boolean => {
    if (!supportsPreview) return false
    if (isSolanaEcosystem) return parseSolanaAssetType(name) !== 'spl-token'
    return true
  }, [isSolanaEcosystem, supportsPreview])

  const resolveAssetDisplayName = useCallback((name: string): string => (
    nftLookup[name]?.label || assetLabels[name] || name
  ), [assetLabels, nftLookup])

  useEffect(() => {
    if (caps.features.assetLayer) void fetchNetworkAssets()
    void fetchNetworkFiat()
  }, [activeNetworkId, activeAccountId, caps.features.assetLayer, assetSignature, fetchNetworkAssets, fetchNetworkFiat])

  const setPreviewState = useCallback((assetName: string, hasPreview: boolean) => {
    setPreviewByAsset((previous) => {
      if (previous[assetName] === hasPreview) return previous
      const next = { ...previous, [assetName]: hasPreview }
      previewByAssetRef.current = next
      return next
    })
  }, [])

  const ensurePreviewAvailability = useCallback((assetNames: string[]) => {
    const uniqueAssetNames = [...new Set(
      assetNames
        .map((name) => String(name || '').trim())
        .filter(Boolean)
    )]
    if (!supportsPreview || uniqueAssetNames.length === 0) return

    let cancelled = false
    const checkPreviewability = async () => {
      for (const assetName of uniqueAssetNames) {
        if (!isPreviewableAssetName(assetName)) {
          if (!cancelled) setPreviewState(assetName, false)
          continue
        }
        if (previewByAssetRef.current[assetName] !== undefined) continue
        if (checkingRef.current.has(assetName)) continue
        checkingRef.current.add(assetName)
        try {
          const details = await fetchAssetDetails(assetName)
          const hasPreview = Boolean(String(details?.preview_url || details?.ipfs_hash || details?.metadata_url || '').trim())
          if (!cancelled) setPreviewState(assetName, hasPreview)
        } catch {
          if (!cancelled) setPreviewState(assetName, false)
        } finally {
          checkingRef.current.delete(assetName)
        }
      }
    }

    void checkPreviewability()
    return () => { cancelled = true }
  }, [fetchAssetDetails, isPreviewableAssetName, setPreviewState, supportsPreview])

  return {
    activeNetworkId,
    activeNetwork,
    activeModelId,
    caps,
    isEvmEcosystem,
    isSolanaEcosystem,
    supportsPreview,
    canOpenAssetSend,
    sorted,
    roots,
    subs,
    assetLogos,
    assetLabels,
    fiatByAsset,
    nftLookup,
    previewByAsset,
    resolveAssetDisplayName,
    isPreviewableAssetName,
    ensurePreviewAvailability,
    fetchNetworkAssets,
    fetchNetworkFiat
  }
}

