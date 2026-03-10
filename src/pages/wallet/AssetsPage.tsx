import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  IoArrowBackOutline,
  IoLayersOutline,
  IoSearchOutline,
  IoClose,
  IoRefreshOutline
} from 'react-icons/io5'
import { Input } from '../../components/Input'
import { formatFiatValue, useWalletStore } from '../../store/walletStore'
import { isEvmNftAssetKey, resolveSolanaAssetTypeLabel } from '../../lib/assetTypes'
import AssetListRow from './AssetListRow'
import { useAssetListModel } from './useAssetListModel'

const AssetsPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    serverCoinCatalog,
    activeAccountId,
    activeNetworkId,
    getSendableItems,
    setSendListPreferences
  } = useWalletStore()

  const {
    activeNetwork,
    activeModelId,
    caps,
    isEvmEcosystem,
    isSolanaEcosystem,
    canOpenAssetSend,
    sorted,
    roots,
    subs,
    assetLogos,
    assetLabels,
    fiatByAsset,
    previewByAsset,
    resolveAssetDisplayName,
    isPreviewableAssetName,
    ensurePreviewAvailability,
    fetchNetworkAssets,
    fetchNetworkFiat
  } = useAssetListModel()

  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const deepLinkHandledRef = useRef<string | null>(null)

  const catalogForModel = useMemo(
    () => serverCoinCatalog.filter((item) => String(item.runtimeModelId || '').trim().toLowerCase() === activeModelId),
    [serverCoinCatalog, activeModelId]
  )
  const catalogMainCount = catalogForModel.filter((item) => item.kind === 'main').length
  const catalogAssetRows = catalogForModel.filter((item) => item.kind === 'asset')

  const isSearching = search.trim().length > 0
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sorted
    return sorted.filter(([name]) => {
      if (name.toLowerCase().includes(query)) return true
      const label = String(assetLabels[name] || '').trim().toLowerCase()
      return Boolean(label && label.includes(query))
    })
  }, [assetLabels, search, sorted])

  const visibleAssetNames = useMemo(() => {
    const rows = (isSearching ? filtered : sorted).slice(0, 40)
    return rows.map(([name]) => name)
  }, [filtered, isSearching, sorted])
  const sendHubAccountId = activeAccountId || undefined
  const sendHubNetworkId = activeNetworkId || undefined
  const sendableItems = getSendableItems({ accountId: sendHubAccountId, networkId: sendHubNetworkId, includeHidden: true })
  const sendAssetIdByName = useMemo(() => {
    const out: Record<string, string> = {}
    for (const item of sendableItems) {
      if (item.requestType !== 'asset' || !item.assetId) continue
      out[item.assetId] = item.id
    }
    return out
  }, [sendableItems])
  const hiddenSendAssetIds = useMemo(() => {
    const out = new Set<string>()
    for (const item of sendableItems) {
      if (item.requestType !== 'asset' || !item.assetId || !item.hidden) continue
      out.add(item.assetId)
    }
    return out
  }, [sendableItems])

  const deepLinkedSendAsset = String((location.state as { sendAsset?: string } | null)?.sendAsset || '').trim()

  useEffect(() => {
    if (!canOpenAssetSend || !deepLinkedSendAsset) return
    if (deepLinkHandledRef.current === deepLinkedSendAsset) return
    if (!sorted.some(([name]) => name === deepLinkedSendAsset)) return
    navigate('/wallet/send', { state: { assetId: deepLinkedSendAsset } })
    deepLinkHandledRef.current = deepLinkedSendAsset
  }, [canOpenAssetSend, deepLinkedSendAsset, navigate, sorted])

  useEffect(() => ensurePreviewAvailability(visibleAssetNames), [ensurePreviewAvailability, visibleAssetNames])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.allSettled([
        fetchNetworkAssets({ force: true }),
        fetchNetworkFiat({ force: true })
      ])
    } finally {
      setRefreshing(false)
    }
  }

  const handleAssetRowClick = (name: string): void => {
    if (!canOpenAssetSend) return
    navigate('/wallet/send', { state: { assetId: name } })
  }

  const toggleSendHubHidden = (name: string): void => {
    const targetId = sendAssetIdByName[name]
    if (!targetId) return
    const nextHidden = new Set(
      sendableItems
        .filter((item) => item.hidden)
        .map((item) => item.id)
    )
    if (nextHidden.has(targetId)) nextHidden.delete(targetId)
    else nextHidden.add(targetId)
    setSendListPreferences({
      accountId: sendHubAccountId,
      networkId: sendHubNetworkId,
      hidden: [...nextHidden]
    })
  }

  const renderAssetRows = (
    rows: Array<[string, number]>,
    options?: { hideMetaLabels?: boolean }
  ) => rows.map(([name, rawAmount]) => (
    <AssetListRow
      key={name}
      variant="full"
      name={name}
      displayName={resolveAssetDisplayName(name)}
      nft={isEvmNftAssetKey(name)}
      metaLabel={isSolanaEcosystem ? (resolveSolanaAssetTypeLabel(name) || undefined) : undefined}
      logoUrl={assetLogos[name]}
      rawAmount={rawAmount}
      fiatValue={formatFiatValue(fiatByAsset[name]?.usd)}
      onClick={() => handleAssetRowClick(name)}
      onPreview={() => {
        if (!isPreviewableAssetName(name)) return
        navigate('/assets/preview', { state: { assetId: name } })
      }}
      previewAvailable={isPreviewableAssetName(name) && previewByAsset[name] === true}
      hideMetaLabels={options?.hideMetaLabels}
      hiddenInSendHub={hiddenSendAssetIds.has(name)}
      onToggleSendHubHidden={() => toggleSendHubHidden(name)}
    />
  ))

  return (
    <div className="bg-dark-800 w-full h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-600 shrink-0 bg-dark-900/60">
        <button
          onClick={() => navigate('/wallet/assets', { replace: true })}
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-dark-700 transition-colors shrink-0"
        >
          <IoArrowBackOutline className="w-5 h-5 text-gray-300" />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-black uppercase tracking-widest">My Assets</h1>
          <p className="text-[10px] text-gray-500">{activeNetwork.name} - {sorted.length} asset{sorted.length !== 1 ? 's' : ''}</p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-dark-700 transition-colors shrink-0"
          title="Refresh"
        >
          <IoRefreshOutline className={`w-5 h-5 text-gray-400 ${refreshing ? 'animate-spin-smooth' : ''}`} />
        </button>
      </div>

      {caps.features.assetLayer && (
        <div className="px-4 py-2.5 border-b border-dark-600/60 shrink-0">
          <div className="relative">
            <IoSearchOutline className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <Input
              placeholder="Search assets..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9 pr-8 bg-dark-700/40 border-dark-600 text-sm placeholder-gray-600 h-9"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-dark-600 transition-colors"
              >
                <IoClose className="w-3.5 h-3.5 text-gray-500 hover:text-white" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {catalogAssetRows.length > 0 && (
          <div className="px-4 pt-3 pb-2 border-b border-dark-600/40">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Server Catalog - Main {catalogMainCount} - Assets {catalogAssetRows.length}
            </p>
            <p className="text-[10px] text-gray-500 mt-1">
              Token/asset entries from server configuration are catalogued here while blockchains stay in coin selector.
            </p>
          </div>
        )}

        {catalogAssetRows.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">
                Catalogued Token/Assets ({catalogAssetRows.length})
              </p>
            </div>
            {catalogAssetRows.slice(0, 50).map((item) => (
              <div key={`catalog-${item.coinId}`} className="px-4 py-2 border-b border-dark-600/30 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-200 truncate">{item.name}</p>
                  <p className="text-[10px] text-gray-500 font-mono truncate">{item.coinId}</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/40 text-blue-300 uppercase font-bold">
                  {item.symbol || 'ASSET'}
                </span>
              </div>
            ))}
            {catalogAssetRows.length > 50 && (
              <p className="px-4 py-2 text-[10px] text-gray-500">
                Showing first 50 catalogued assets for this chain model.
              </p>
            )}
          </>
        )}

        {!caps.features.assetLayer && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6 opacity-60">
            <IoLayersOutline className="w-8 h-8 text-gray-500" />
            <p className="text-sm font-bold text-gray-400">Assets not supported</p>
            <p className="text-xs text-gray-600">{activeNetwork.name} does not support token assets.</p>
          </div>
        )}

        {caps.features.assetLayer && sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6 opacity-60">
            <IoLayersOutline className="w-8 h-8 text-gray-500" />
            <div>
              <p className="text-sm font-bold text-gray-400">No assets on this address</p>
              <p className="text-xs text-gray-600 mt-1">Assets you hold on {activeNetwork.name} will appear here.</p>
            </div>
          </div>
        )}

        {caps.features.assetLayer && sorted.length > 0 && isSearching && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center px-6">
            <IoSearchOutline className="w-7 h-7 text-gray-600" />
            <p className="text-sm font-bold text-gray-400">No results for "{search}"</p>
            <button onClick={() => setSearch('')} className="text-xs text-primary hover:underline">Clear search</button>
          </div>
        )}

        {caps.features.assetLayer && isSearching && filtered.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                {filtered.length} result{filtered.length !== 1 ? 's' : ''}
              </p>
            </div>
            {renderAssetRows(filtered, { hideMetaLabels: isEvmEcosystem })}
          </>
        )}

        {caps.features.assetLayer && !isSearching && isEvmEcosystem && sorted.length > 0 && (
          <>
            {renderAssetRows(sorted, { hideMetaLabels: true })}
          </>
        )}

        {caps.features.assetLayer && !isSearching && !isEvmEcosystem && roots.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-600">Root Assets ({roots.length})</p>
            </div>
            {renderAssetRows(roots)}
          </>
        )}

        {caps.features.assetLayer && !isSearching && !isEvmEcosystem && subs.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Sub Assets ({subs.length})</p>
            </div>
            {renderAssetRows(subs)}
          </>
        )}

        <div className="h-4" />
      </div>
    </div>
  )
}

export default AssetsPage
