import React from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import clsx from 'clsx'
import { useWalletStore } from '../store/walletStore'
import { useApiMonitorStore } from '../store/apiMonitorStore'
import { IoChevronDown, IoClose, IoCopyOutline, IoCheckmark, IoSearchOutline, IoQrCodeOutline, IoCreateOutline, IoGlobeOutline, IoSettingsOutline, IoCheckmarkCircle, IoCloseCircle } from 'react-icons/io5'
import { Button } from './Button'
import { EVM_ETHEREUM_L2_COIN_IDS } from '../coins/coinSelection'
import { getUnifiedLogoByName } from '../coins/logos'
import { SESSION_GRADIENT } from '../lib/sessionColor'
import { getAccountDisplayName } from '../lib/accountName'
import { resolveNetworkCapabilities } from '../lib/networkCapabilities'
import { compareNetworksByModelFamily } from '../lib/coinModel'
import { getModelIconRingClass, getModelStatus } from '../buildConfig'
import { getEnabledNetworks } from '../lib/networkVisibility'
import { isCosmosLikeModelId, resolveRuntimeModelId } from '../lib/runtimeModel'

interface WalletFrameProps {
  children: React.ReactNode
  hideHeader?: boolean
}

export const WalletFrame: React.FC<WalletFrameProps> = ({ children, hideHeader = false }) => {
  const {
    isConnected,
    isSyncing,
    activeNetworkId,
    networks,
    disabledNetworkIds,
    activity,
    accounts,
    activeAccountId,
    setActiveAccount,
    setNetworkAccountName,
    setActiveNetwork,
    lock
  } = useWalletStore()

  const navigate = useNavigate()
  const {
    inFlight: apiInFlight,
  } = useApiMonitorStore()

  const [showNetworkMenu, setShowNetworkMenu] = React.useState(false)
  const [showAccountMenu, setShowAccountMenu] = React.useState(false)
  const [showReceiveQr, setShowReceiveQr] = React.useState(false)
  const [networkSearch, setNetworkSearch] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [qrCopied, setQrCopied] = React.useState(false)
  const [qrDataUrl, setQrDataUrl] = React.useState('')
  const [receiveMemo, setReceiveMemo] = React.useState('')

  const enabledNetworks = React.useMemo(
    () => getEnabledNetworks(networks, disabledNetworkIds),
    [networks, disabledNetworkIds]
  )
  const activeNetwork = enabledNetworks.find(n => n.id === activeNetworkId) || enabledNetworks[0]
  const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0]
  const rankedNetworks = React.useMemo(() => {
    const usageByNetwork = new Map<string, number>()
    for (const row of activity) {
      const networkId = String(row?.networkId || '').trim()
      if (!networkId) continue
      usageByNetwork.set(networkId, (usageByNetwork.get(networkId) || 0) + 1)
    }
    return [...enabledNetworks].sort((a, b) => {
      const familyDelta = compareNetworksByModelFamily(a, b)
      if (familyDelta !== 0) return familyDelta
      const usageDelta = (usageByNetwork.get(b.id) || 0) - (usageByNetwork.get(a.id) || 0)
      if (usageDelta !== 0) return usageDelta
      return a.name.localeCompare(b.name)
    })
  }, [activity, enabledNetworks])
  const visibleNetworks = React.useMemo(() => {
    const query = networkSearch.trim().toLowerCase()
    if (!query) return rankedNetworks
    return rankedNetworks.filter((n) =>
      n.name.toLowerCase().includes(query) || n.symbol.toLowerCase().includes(query)
    )
  }, [networkSearch, rankedNetworks])
  const showGlobalNetworkOption = React.useMemo(() => {
    const query = networkSearch.trim().toLowerCase()
    if (!query) return true
    return 'global network'.includes(query) || 'all chains'.includes(query) || 'send hub'.includes(query)
  }, [networkSearch])

  const rawAddress = activeAccount?.networkAddresses?.[activeNetworkId]
    || (activeNetwork.coinType === 'EVM' ? activeAccount?.addresses?.EVM : undefined)
    || ''
  const activeModelId = resolveRuntimeModelId(activeNetwork)
  const supportsReceiveMemo = isCosmosLikeModelId(activeModelId)
  const receiveMemoScheme = activeModelId === 'cro' || activeModelId === 'crocosmos' ? 'cro' : 'cosmos'
  const receiveMemoSymbol = activeNetwork?.symbol || 'ATOM'
  const receiveLayer1 = React.useMemo(() => {
    if (!EVM_ETHEREUM_L2_COIN_IDS.has(activeModelId)) return null
    return {
      name: 'Ethereum',
      logo: getUnifiedLogoByName('ethereum')
    }
  }, [activeModelId])
  const receivePayload = React.useMemo(() => {
    const address = String(rawAddress || '').trim()
    if (!address) return ''
    const memo = String(receiveMemo || '').trim()
    if (!supportsReceiveMemo || !memo) return address
    return `${receiveMemoScheme}:${address}?memo=${encodeURIComponent(memo)}`
  }, [rawAddress, receiveMemo, receiveMemoScheme, supportsReceiveMemo])
  const shortenedAddress = rawAddress
    ? `${rawAddress.slice(0, 4)}…${rawAddress.slice(-6)}`
    : ''

  const renderNetworkStatusIcon = React.useCallback((network: { runtimeModelId?: string; id: string }) => {
    const status = getModelStatus(String(network.runtimeModelId || network.id || ''))
    if (status === 'tested') return <IoCheckmarkCircle className="w-4 h-4 text-green-400 shrink-0" title="Tested" />
    return <IoCloseCircle className="w-4 h-4 text-red-400 shrink-0" title="Not tested" />
  }, [])

  React.useEffect(() => {
    if (!showReceiveQr || !receivePayload) {
      setQrDataUrl('')
      return
    }

    let mounted = true
    const SIZE = 240
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE

    void QRCode.toCanvas(canvas, receivePayload, {
      width: SIZE,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#111316', light: '#ffffff' },
    }).then(() => {
      if (!mounted) return
      const ctx = canvas.getContext('2d')
      if (!ctx) { setQrDataUrl(canvas.toDataURL()); return }

      const logoSrc = String(activeNetwork?.logo || '').trim()
      if (!logoSrc) {
        setQrDataUrl(canvas.toDataURL())
        return
      }

      const logo = new Image()
      logo.onload = () => {
        if (!mounted) return
        const logoR = Math.round(SIZE * 0.14) // logo radius
        const cx = SIZE / 2
        const cy = SIZE / 2
        const logoSize = logoR * 2

        // Add a rounded square badge so the center coin logo stays readable.
        const badgePadding = Math.max(6, Math.round(SIZE * 0.02))
        const badgeSize = logoSize + badgePadding * 2
        const badgeX = cx - (badgeSize / 2)
        const badgeY = cy - (badgeSize / 2)
        const badgeRadius = Math.round(badgeSize * 0.22)

        ctx.save()
        ctx.beginPath()
        ctx.moveTo(badgeX + badgeRadius, badgeY)
        ctx.lineTo(badgeX + badgeSize - badgeRadius, badgeY)
        ctx.arcTo(badgeX + badgeSize, badgeY, badgeX + badgeSize, badgeY + badgeRadius, badgeRadius)
        ctx.lineTo(badgeX + badgeSize, badgeY + badgeSize - badgeRadius)
        ctx.arcTo(badgeX + badgeSize, badgeY + badgeSize, badgeX + badgeSize - badgeRadius, badgeY + badgeSize, badgeRadius)
        ctx.lineTo(badgeX + badgeRadius, badgeY + badgeSize)
        ctx.arcTo(badgeX, badgeY + badgeSize, badgeX, badgeY + badgeSize - badgeRadius, badgeRadius)
        ctx.lineTo(badgeX, badgeY + badgeRadius)
        ctx.arcTo(badgeX, badgeY, badgeX + badgeRadius, badgeY, badgeRadius)
        ctx.closePath()
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#111316'
        ctx.stroke()
        ctx.restore()

        ctx.drawImage(logo, cx - logoR, cy - logoR, logoSize, logoSize)

        if (mounted) setQrDataUrl(canvas.toDataURL())
      }
      logo.onerror = () => {
        // Logo unavailable — use plain QR
        if (mounted) setQrDataUrl(canvas.toDataURL())
      }
      logo.src = logoSrc
    }).catch(() => {
      if (!mounted) return
      setQrDataUrl('')
    })

    return () => { mounted = false }
  }, [showReceiveQr, receivePayload, activeNetwork?.logo])

  const isApiWaiting = apiInFlight > 0
  const isWaiting = isSyncing || isApiWaiting
  const statusColor = isWaiting ? 'status-dot-yellow' : isConnected ? 'status-dot-green' : 'status-dot-red'
  const statusLabel = isWaiting
    ? 'Waiting'
    : isConnected
      ? 'Connected'
      : 'Not connected'

  const copyAddress = async () => {
    if (!rawAddress) return
    try {
      await navigator.clipboard.writeText(rawAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  const copyQrAddress = async () => {
    if (!receivePayload) return
    try {
      await navigator.clipboard.writeText(receivePayload)
      setQrCopied(true)
      setTimeout(() => setQrCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  const editAccountName = (accountId: string) => {
    const target = accounts.find((a) => a.id === accountId)
    if (!target) return
    const currentName = getAccountDisplayName(target, activeNetworkId, target.name)
    const next = window.prompt(`Rename ${activeNetwork.symbol} account`, currentName)
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === currentName) return
    const duplicate = accounts.some((a) => (
      a.id !== accountId
      && getAccountDisplayName(a, activeNetworkId, a.name).toLowerCase() === trimmed.toLowerCase()
    ))
    if (duplicate) {
      window.alert(`Another ${activeNetwork.symbol} account already uses this name.`)
      return
    }
    setNetworkAccountName(accountId, activeNetworkId, trimmed)
  }

  return (
    <div className="flex flex-col h-full bg-dark-800 relative overflow-hidden">
      {!hideHeader && (
        <>
          <header className="p-3 flex items-center justify-between border-b border-dark-600">
            <div className="w-8 h-8" aria-hidden="true" />

            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 bg-dark-700/50 rounded-full border border-dark-600 cursor-pointer hover:border-primary transition-colors"
                onClick={() => setShowNetworkMenu(!showNetworkMenu)}
              >
                {activeNetwork.logo
                  ? (
                    <div className={clsx('w-4 h-4 rounded-full overflow-hidden', getModelIconRingClass(String(activeNetwork.runtimeModelId || activeNetwork.id || '')))}>
                      <img src={activeNetwork.logo} alt={activeNetwork.name} className="w-full h-full object-cover rounded-full" />
                    </div>
                  )
                  : <div className="w-2 h-2 rounded-full bg-yellow-500" />
                }
                <span className="text-[11px] font-bold text-gray-200 uppercase tracking-tight">{activeNetwork.name}</span>
                <IoChevronDown className="text-gray-500 w-3 h-3" />
              </div>

              <button
                className="w-8 h-8 rounded-full border border-dark-600 bg-dark-700/60 flex items-center justify-center cursor-pointer hover:border-primary hover:bg-dark-700 transition-all focus:outline-none"
                onClick={() => navigate('/settings')}
                title="Settings"
              >
                <IoSettingsOutline className="w-4.5 h-4.5 text-gray-300" />
              </button>
            </div>
          </header>

          {/* Sub-header: status | account name (opens sheet) | receive qr + copy address */}
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`status-dot ${statusColor} ${(isSyncing || isApiWaiting) ? 'animate-pulse-sync' : ''}`} />
              <div className="flex flex-col leading-tight">
                <span className="text-[11px] font-medium text-gray-400">{statusLabel}</span>
              </div>
            </div>

            <div
              className="flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setShowAccountMenu(!showAccountMenu)}
            >
              <div className="flex items-center gap-1">
                <span className="text-sm font-bold">{getAccountDisplayName(activeAccount, activeNetworkId, 'Account 1')}</span>
                <IoChevronDown className="text-gray-500 w-3 h-3" />
              </div>
              <span className="text-[10px] text-gray-500 font-mono">{shortenedAddress}</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowReceiveQr(true)}
                disabled={!rawAddress}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-dark-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Receive (QR)"
              >
                <IoQrCodeOutline className="w-4.5 h-4.5 text-gray-400 hover:text-white" />
              </button>

              <button
                onClick={copyAddress}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-dark-700 transition-colors"
                title="Copy address"
              >
                {copied
                  ? <IoCheckmark className="w-4 h-4 text-green-400" />
                  : <IoCopyOutline className="w-4 h-4 text-gray-400 hover:text-white" />
                }
              </button>
            </div>
          </div>
        </>
      )}

      {/* Network bottom sheet */}
      {showNetworkMenu && (
        <div
          className="absolute inset-0 z-50 bg-black/45 backdrop-blur-sm p-3 pt-[86px] flex flex-col"
          onClick={() => { setShowNetworkMenu(false); setNetworkSearch('') }}
        >
          <div
            className="w-full h-full min-h-0 bg-dark-800 rounded-2xl border border-dark-600 p-4 space-y-3 animate-in slide-in-from-top duration-200 flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Select Network</h3>
              <button onClick={() => { setShowNetworkMenu(false); setNetworkSearch('') }}>
                <IoClose className="w-5 h-5 text-gray-400 hover:text-white" />
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <IoSearchOutline className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={networkSearch}
                onChange={e => setNetworkSearch(e.target.value)}
                placeholder="Search networks…"
                className="w-full bg-dark-700/60 border border-dark-600 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-gray-200 placeholder-gray-600 focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* List */}
            <div className="space-y-1.5 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
              {showGlobalNetworkOption && (
                <div
                  className="global-network-option p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all"
                  onClick={() => {
                    setShowNetworkMenu(false)
                    setNetworkSearch('')
                    navigate('/wallet/send', { state: { hubMode: 'global', autoScan: true } })
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="global-network-icon-wrap w-7 h-7 rounded-full border flex items-center justify-center">
                      <IoGlobeOutline className="global-network-icon w-4 h-4" />
                    </div>
                    <div className="flex flex-col leading-tight">
                      <div className="flex items-center gap-2">
                        <span className="global-network-title text-sm font-bold">Global Network</span>
                        <span
                          title="Scan all blockchains and addresses"
                          className="global-network-chip px-1.5 py-0.5 rounded-md border text-[9px] font-black tracking-widest uppercase"
                        >
                          Global
                        </span>
                      </div>
                      <span className="global-network-subtitle text-[10px] uppercase font-mono">All chains / send hub</span>
                    </div>
                  </div>
                  <div className="global-network-dot w-2 h-2 rounded-full" />
                </div>
              )}

              {visibleNetworks
                .map(n => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      activeNetworkId === n.id ? 'border-primary bg-primary/5' : 'border-dark-600 bg-dark-700/50 hover:bg-dark-700'
                    }`}
                    onClick={() => {
                      void setActiveNetwork(n.id)
                      setShowNetworkMenu(false)
                      setNetworkSearch('')
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {n.logo
                        ? (
                          <div className={clsx('w-7 h-7 rounded-full overflow-hidden', getModelIconRingClass(String(n.runtimeModelId || n.id || '')))}>
                            <img src={n.logo} alt={n.name} className="w-full h-full object-cover rounded-full" />
                          </div>
                        )
                        : <div className="w-7 h-7 rounded-full bg-dark-600 flex items-center justify-center"><div className="w-2.5 h-2.5 rounded-full bg-yellow-500" /></div>
                      }
                      <div className="flex flex-col leading-tight">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{n.name}</span>
                          {renderNetworkStatusIcon(n)}
                          {resolveNetworkCapabilities(n).features.assetLayer && (
                            <span
                              title="Supports assets/tokens"
                              className="px-1.5 py-0.5 rounded-md border border-dark-600 bg-dark-700/70 text-[9px] font-black tracking-widest uppercase text-gray-200"
                            >
                              Assets
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-500 uppercase font-mono">{n.symbol}</span>
                      </div>
                    </div>
                    {activeNetworkId === n.id && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                ))
              }
              {visibleNetworks.length === 0 && !showGlobalNetworkOption && (
                <p className="text-xs text-gray-600 text-center py-4">No networks match "{networkSearch}"</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Account bottom sheet */}
      {showAccountMenu && (
        <div
          className="absolute inset-0 z-50 bg-black/45 backdrop-blur-sm p-3 pt-[86px] flex flex-col"
          onClick={() => setShowAccountMenu(false)}
        >
          <div
            className="w-full h-full min-h-0 bg-dark-800 rounded-2xl border border-dark-600 p-4 space-y-3 animate-in slide-in-from-top duration-200 flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Accounts</h3>
              <button onClick={() => setShowAccountMenu(false)}><IoClose className="w-6 h-6" /></button>
            </div>
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
              {accounts.map(acc => {
                const addr = acc.networkAddresses?.[activeNetworkId]
                  || (activeNetwork.coinType === 'EVM' ? acc.addresses?.EVM : '')
                  || ''
                return (
                  <div
                    key={acc.id}
                    className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      activeAccountId === acc.id ? 'border-primary bg-primary/5' : 'border-dark-600 bg-dark-700/50 hover:bg-dark-700'
                    }`}
                    onClick={() => {
                      setActiveAccount(acc.id)
                      setShowAccountMenu(false)
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full shrink-0"
                        style={{ background: SESSION_GRADIENT }}
                      />
                      <div className="flex flex-col">
                        <span className="text-sm font-bold">{getAccountDisplayName(acc, activeNetworkId, acc.name)}</span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {addr ? `${addr.slice(0, 10)}…` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="p-1.5 rounded-lg hover:bg-dark-600 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation()
                          editAccountName(acc.id)
                        }}
                        title="Edit account name"
                      >
                        <IoCreateOutline className="w-4 h-4 text-gray-400 hover:text-white" />
                      </button>
                      {/* Copy address */}
                      <button
                        className="p-1.5 rounded-lg hover:bg-dark-600 transition-colors"
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (!addr) return
                          await navigator.clipboard.writeText(addr)
                        }}
                        title="Copy full address"
                      >
                        <IoCopyOutline className="w-4 h-4 text-gray-400 hover:text-white" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <Button variant="outline" className="w-full shrink-0" onClick={lock}>Lock Wallet</Button>
          </div>
        </div>
      )}

      {/* Receive QR sheet */}
      {showReceiveQr && (
        <div
          className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-end"
          onClick={() => setShowReceiveQr(false)}
        >
          <div
            className="w-full bg-dark-800 rounded-t-3xl border-t border-dark-600 p-5 space-y-4 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Receive</h3>
                <span className="px-2 py-0.5 rounded-full bg-primary/15 border border-primary/25 text-primary text-[10px] font-bold uppercase tracking-wide">
                  {activeNetwork.symbol}
                </span>
                {receiveLayer1 && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-dark-700/70 border border-dark-600 text-gray-200 text-[10px] font-bold uppercase tracking-wide">
                    <img
                      src={receiveLayer1.logo}
                      alt={`${receiveLayer1.name} layer 1`}
                      className="w-3.5 h-3.5 rounded-full object-cover"
                    />
                    L1 {receiveLayer1.name}
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowReceiveQr(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-dark-700 transition-colors"
              >
                <IoClose className="w-4 h-4 text-gray-400 hover:text-white" />
              </button>
            </div>

            {/* QR container — dark MetaYoshi-branded frame */}
            <div className="rounded-2xl border border-primary/30 bg-dark-900 p-4 flex flex-col items-center justify-center gap-3 shadow-[0_0_24px_rgba(245,132,31,0.10)]">
              <span className="text-[11px] font-black uppercase tracking-[0.28em] text-gray-300">
                MetaYoshi
              </span>
              <div className="flex items-center gap-2 flex-wrap justify-center text-center">
                <span className="text-xs font-bold text-gray-100">{activeNetwork.name}</span>
                {receiveLayer1 && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-dark-700/70 border border-dark-600 text-gray-200 text-[10px] font-bold uppercase tracking-wide">
                    <img
                      src={receiveLayer1.logo}
                      alt={`${receiveLayer1.name} layer 1`}
                      className="w-3.5 h-3.5 rounded-full object-cover"
                    />
                    L1
                  </span>
                )}
              </div>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Receive address QR"
                  className="w-[200px] h-[200px] rounded-xl"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <div className="w-[200px] h-[200px] rounded-xl bg-dark-700 flex flex-col items-center justify-center gap-2">
                  <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin-smooth" />
                  <span className="text-[10px] text-gray-500">Generating…</span>
                </div>
              )}
            </div>

            {/* Address display */}
            <div className="rounded-xl border border-dark-600 bg-dark-700/40 p-3">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Selected Address</p>
              <p className="text-[11px] font-mono break-all text-gray-200 leading-relaxed">{rawAddress || 'No address available'}</p>
            </div>

            {supportsReceiveMemo && (
              <div className="rounded-xl border border-dark-600 bg-dark-700/30 p-3 space-y-2">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Memo</p>
                  <p className="text-[10px] text-gray-500">Optional {receiveMemoSymbol} memo to share with the sender.</p>
                </div>
                <input
                  value={receiveMemo}
                  onChange={(e) => setReceiveMemo(e.target.value)}
                  placeholder={`Optional ${receiveMemoSymbol} memo`}
                  className="input-field bg-dark-700/50 border-dark-600 text-xs"
                />
                {receiveMemo.trim() && (
                  <p className="text-[10px] font-mono break-all text-gray-300">{receivePayload}</p>
                )}
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => { void copyQrAddress() }}
              disabled={!receivePayload}
            >
              {qrCopied
                ? <><IoCheckmark className="w-4 h-4" /> Copied!</>
                : <><IoCopyOutline className="w-4 h-4" /> Copy {supportsReceiveMemo && receiveMemo.trim() ? 'Address URI' : 'Address'}</>
              }
            </Button>
          </div>
        </div>
      )}

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        {children}
      </main>
    </div>
  )
}
