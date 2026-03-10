import React, { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { IoChevronForward, IoLayersOutline } from 'react-icons/io5'
import { isEvmNftAssetKey, resolveSolanaAssetTypeLabel } from '../../lib/assetTypes'
import { formatFiatValue, useWalletStore } from '../../store/walletStore'
import AssetListRow from './AssetListRow'
import { useAssetListModel } from './useAssetListModel'

const Assets: React.FC = () => {
  const navigate = useNavigate()
  const {
    activeAccountId,
    activeNetworkId,
    getSendableItems,
    setSendListPreferences
  } = useWalletStore()
  const {
    activeNetwork,
    caps,
    sorted,
    isEvmEcosystem,
    isSolanaEcosystem,
    canOpenAssetSend,
    assetLogos,
    fiatByAsset,
    previewByAsset,
    resolveAssetDisplayName,
    isPreviewableAssetName,
    ensurePreviewAvailability
  } = useAssetListModel()

  const previewRows = useMemo(() => sorted.slice(0, 3), [sorted])
  const previewAssetNames = useMemo(() => previewRows.map(([name]) => name), [previewRows])
  const total = sorted.length
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

  useEffect(() => ensurePreviewAvailability(previewAssetNames), [ensurePreviewAvailability, previewAssetNames])

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

  if (!caps.features.assetLayer) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center py-14 gap-3 text-center px-6 opacity-50">
          <IoLayersOutline className="w-7 h-7 text-gray-500" />
          <p className="text-sm font-medium">Assets not supported on {activeNetwork.name}</p>
        </div>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center py-14 gap-3 text-center px-6 opacity-50">
          <IoLayersOutline className="w-7 h-7 text-gray-500" />
          <p className="text-sm font-medium">No assets on this address</p>
          <p className="text-xs text-gray-500">
            Assets you hold on {activeNetwork.name} will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1">
        {previewRows.map(([name, rawAmount]) => (
          <AssetListRow
            key={name}
            variant="compact"
            name={name}
            displayName={resolveAssetDisplayName(name)}
            nft={isEvmNftAssetKey(name)}
            metaLabel={isSolanaEcosystem ? (resolveSolanaAssetTypeLabel(name) || undefined) : undefined}
            logoUrl={assetLogos[name]}
            rawAmount={rawAmount}
            fiatValue={formatFiatValue(fiatByAsset[name]?.usd)}
            onClick={() => {
              if (canOpenAssetSend) {
                navigate('/wallet/send', { state: { assetId: name } })
                return
              }
              navigate('/assets')
            }}
            onPreview={() => {
              if (!isPreviewableAssetName(name)) return
              navigate('/assets/preview', { state: { assetId: name } })
            }}
            previewAvailable={isPreviewableAssetName(name) && previewByAsset[name] === true}
            hideMetaLabels={isEvmEcosystem}
            hiddenInSendHub={hiddenSendAssetIds.has(name)}
            onToggleSendHubHidden={() => toggleSendHubHidden(name)}
          />
        ))}

        {total > 3 && (
          <button
            onClick={() => navigate('/assets')}
            className="flex items-center justify-between w-full px-4 py-3.5 hover:bg-dark-700/50 transition-colors border-b border-dark-600/50 group"
          >
            <span className="text-xs font-bold text-gray-400 group-hover:text-white transition-colors">
              View all {total} assets
            </span>
            <IoChevronForward className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
          </button>
        )}
      </div>
    </div>
  )
}

export default Assets
