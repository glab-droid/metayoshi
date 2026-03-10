import React, { useEffect, useMemo, useState } from 'react'
import { IoArrowUpOutline, IoChevronForward, IoEyeOffOutline, IoEyeOutline, IoLayersOutline } from 'react-icons/io5'
import { findBundledTokenLogoForAsset, getTokenLogoForAsset } from '../../coins/tokenlogos'
import { formatAssetAmount, parseAssetName } from './useAssetListModel'

interface AssetListRowProps {
  name: string
  displayName?: string
  nft?: boolean
  metaLabel?: string
  logoUrl?: string
  rawAmount: number
  fiatValue?: string
  onClick: () => void
  onPreview: () => void
  previewAvailable?: boolean
  hideMetaLabels?: boolean
  hiddenInSendHub?: boolean
  onToggleSendHubHidden?: () => void
  variant?: 'compact' | 'full'
}

const AssetListRow: React.FC<AssetListRowProps> = ({
  name,
  displayName,
  nft = false,
  metaLabel,
  logoUrl,
  rawAmount,
  fiatValue,
  onClick,
  onPreview,
  previewAvailable = false,
  hideMetaLabels = false,
  hiddenInSendHub = false,
  onToggleSendHubHidden,
  variant = 'full'
}) => {
  const effectiveName = displayName || name
  const { root, sub } = parseAssetName(effectiveName)
  const isRootAsset = !sub
  const bundledLogo = useMemo(() => findBundledTokenLogoForAsset(effectiveName), [effectiveName])
  const fallbackLogo = useMemo(() => getTokenLogoForAsset(effectiveName), [effectiveName])
  const remoteLogo = String(logoUrl || '').trim()
  const [logoSrc, setLogoSrc] = useState(bundledLogo || fallbackLogo)
  const compact = variant === 'compact'

  useEffect(() => {
    if (bundledLogo) {
      setLogoSrc(bundledLogo)
      return
    }

    if (!remoteLogo) {
      setLogoSrc(fallbackLogo)
      return
    }

    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) setLogoSrc(remoteLogo)
    }
    probe.onerror = () => {
      if (!cancelled) setLogoSrc(fallbackLogo)
    }
    probe.src = remoteLogo

    return () => {
      cancelled = true
      probe.onload = null
      probe.onerror = null
    }
  }, [bundledLogo, remoteLogo, fallbackLogo])

  return (
    <div className={`w-full flex items-center gap-2 px-2 py-1.5 border-b border-dark-600/50 transition-colors ${
      compact ? 'hover:bg-dark-700' : 'hover:bg-dark-700/40'
    }`}>
      <button
        onClick={onClick}
        className={compact
          ? 'flex-1 min-w-0 flex items-center justify-between p-2 text-left'
          : 'flex-1 min-w-0 flex items-center gap-3 px-2 py-2 text-left group'}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`${compact ? 'w-9 h-9' : 'w-10 h-10'} rounded-full flex items-center justify-center shrink-0 ${
            isRootAsset ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-blue-500/10 border border-blue-500/30'
          }`}>
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={`${name} logo`}
                className="w-full h-full rounded-full object-cover"
                onError={() => setLogoSrc(fallbackLogo)}
              />
            ) : (
              <IoLayersOutline className={`${compact ? 'w-4.5 h-4.5' : 'w-5 h-5'} ${isRootAsset ? 'text-yellow-400' : 'text-blue-400'}`} />
            )}
          </div>

          <div className={compact ? 'flex flex-col gap-0.5 min-w-0' : 'flex-1 min-w-0'}>
            <div className={compact ? 'flex items-center gap-1.5 min-w-0' : 'flex items-center gap-1 flex-wrap'}>
              {sub ? (
                <span className={compact ? 'text-sm font-bold text-blue-300 leading-none truncate' : 'text-sm font-bold text-blue-300'}>
                  {sub}
                </span>
              ) : (
                <span className={compact ? 'text-sm font-bold leading-none truncate' : 'text-sm font-bold truncate'}>
                  {root}
                </span>
              )}
            </div>
            {(nft || !hideMetaLabels) && (
              <span className={`text-[9px] font-bold uppercase ${isRootAsset ? 'text-yellow-600' : 'text-blue-500'}`}>
                {metaLabel || (nft ? 'EVM NFT' : (isRootAsset ? 'Root Asset' : `Sub of ${root}`))}
              </span>
            )}
            {!hideMetaLabels && previewAvailable && (
              <span className="text-[9px] font-bold uppercase text-primary">Preview</span>
            )}
          </div>
        </div>

        {compact ? (
          <div className="flex items-center gap-2 shrink-0 pl-2">
            <div className="flex flex-col items-end shrink-0">
              <span className="text-sm font-bold font-mono">{formatAssetAmount(rawAmount)}</span>
              {fiatValue && (
                <span className="text-[10px] text-gray-400">{fiatValue}</span>
              )}
            </div>
            {hiddenInSendHub && (
              <span className="text-[9px] font-bold uppercase text-gray-500">Hidden</span>
            )}
            <IoChevronForward className="text-gray-500 w-4 h-4" />
          </div>
        ) : (
          <div className="flex flex-col items-end shrink-0">
            <span className="text-sm font-bold font-mono">{formatAssetAmount(rawAmount)}</span>
            {fiatValue && (
              <span className="text-[10px] text-gray-400 mt-0.5">{fiatValue}</span>
            )}
            {hiddenInSendHub && (
              <span className="text-[9px] font-bold uppercase text-gray-500 mt-0.5">Hidden in send</span>
            )}
            <IoArrowUpOutline className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors mt-0.5" />
          </div>
        )}
      </button>

      {onToggleSendHubHidden && (
        <button
          onClick={onToggleSendHubHidden}
          className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
            hiddenInSendHub
              ? 'border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20'
              : 'border-dark-600 bg-dark-700/40 hover:bg-dark-700'
          }`}
          title={hiddenInSendHub ? 'Show in send hub' : 'Hide in send hub'}
        >
          <IoEyeOffOutline className={`w-4.5 h-4.5 ${hiddenInSendHub ? 'text-yellow-300' : 'text-gray-300'}`} />
        </button>
      )}

      <button
        onClick={onPreview}
        disabled={!previewAvailable}
        className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
          previewAvailable
            ? 'border-primary/40 bg-primary/10 hover:bg-primary/20'
            : 'border-dark-600 bg-dark-700/40 opacity-40 cursor-not-allowed'
        }`}
        title={
          previewAvailable
            ? (hideMetaLabels ? 'View asset file' : 'Preview asset file')
            : (hideMetaLabels ? 'No file available' : 'No preview available')
        }
      >
        <IoEyeOutline className={`w-4.5 h-4.5 ${previewAvailable ? 'text-primary' : 'text-gray-300'}`} />
      </button>
    </div>
  )
}

export default AssetListRow
