import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { WalletFrame } from '../../components/WalletFrame'
import { formatFiatValue, useWalletStore } from '../../store/walletStore'
import {
  IoArrowUpOutline,
  IoClose,
  IoCheckmarkCircle,
  IoCopyOutline,
  IoCheckmark,
  IoLayersOutline,
  IoSearchOutline
} from 'react-icons/io5'
import { Tabs } from '../../components/Tabs'
import { PageTransition } from '../../components/PageTransition'
import { resolveNetworkCapabilities, type NetworkCapabilitiesInput } from '../../lib/networkCapabilities'
import { getAccountDisplayName } from '../../lib/accountName'
import { resolveCoinModelFamily, coinModelFamilyToRouteKey, compareNetworksByModelFamily } from '../../lib/coinModel'
import { getModelIconFrameClass, getModelIconRingClass } from '../../buildConfig'
import { getEnabledNetworks } from '../../lib/networkVisibility'

// ── helpers ──────────────────────────────────────────────────────────────────

/** Returns normalized, spec-driven capabilities for the selected network. */
function networkCapabilities(net: { supportsAssets?: boolean; coinType: string; capabilities?: NetworkCapabilitiesInput }) {
  return resolveNetworkCapabilities(net)
}

function formatBalanceDisplay(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return '0'
  const num = Number(raw)
  if (!Number.isFinite(num)) return raw
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  })
}

// ── main component ────────────────────────────────────────────────────────────

const WalletLayout: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    accounts,
    activeAccountId,
    networks,
    disabledNetworkIds,
    activeNetworkId,
    accountNetworkFiatTotals,
    accountNetworkFiatNative,
    activity,
    setActiveAccount,
    setActiveNetwork,
    refreshActiveBalance,
    fetchNetworkFiat
  } = useWalletStore()

  // ── sheet visibility ──────────────────────────────────────────────────────
  const [showAccountSheet, setShowAccountSheet] = useState(false)
  const [showNetworkSheet, setShowNetworkSheet]   = useState(false)
  const [networkSearch,    setNetworkSearch]       = useState('')

  // ── copy feedback ──────────────────────────────────────────────────────────
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyAddress = async (id: string, addr: string) => {
    try {
      await navigator.clipboard.writeText(addr)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch { /* clipboard may be unavailable */ }
  }

  const enabledNetworks = useMemo(
    () => getEnabledNetworks(networks, disabledNetworkIds),
    [networks, disabledNetworkIds]
  )
  const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0]
  const activeNetwork = enabledNetworks.find(n => n.id === activeNetworkId) || enabledNetworks[0]
  const displayBalance = formatBalanceDisplay(String(activeAccount?.balance || '0'))
  const fiatScopeKey = `${String(activeAccount?.id || '').trim().toLowerCase()}::${String(activeNetworkId || '').trim().toLowerCase()}`
  const portfolioFiatValue =
    accountNetworkFiatTotals[fiatScopeKey]?.usd
    ?? accountNetworkFiatNative[fiatScopeKey]?.usd
  const displayFiatValue = formatFiatValue(portfolioFiatValue)
  const rankedNetworks = useMemo(() => {
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
  const visibleNetworks = useMemo(() => {
    const query = networkSearch.trim().toLowerCase()
    if (!query) return rankedNetworks
    return rankedNetworks.filter((net) =>
      net.name.toLowerCase().includes(query) || net.symbol.toLowerCase().includes(query)
    )
  }, [networkSearch, rankedNetworks])
  const isSendRoute = location.pathname.startsWith('/wallet/send')
  // Balance refresh (visibility-aware to avoid bridge/RPC spam while popup is hidden)
  useEffect(() => {
    void fetchNetworkFiat()
  }, [activeAccountId, activeNetworkId, fetchNetworkFiat])

  useEffect(() => {
    if (isSendRoute) return

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      void refreshActiveBalance()
    }

    tick()
    const intervalId = window.setInterval(tick, 15_000)
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') tick()
    }
    window.addEventListener('online', tick)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('online', tick)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [refreshActiveBalance, activeAccountId, activeNetworkId, isSendRoute])

  // ── tabs — only show Assets if the network supports token assets ───────────
  const caps = networkCapabilities(activeNetwork)
  const coinModel = resolveCoinModelFamily(activeNetwork)
  const coinModelRouteKey = coinModelFamilyToRouteKey(coinModel)
  const isModelRoute = location.pathname.startsWith('/wallet/model/')
  const expectedModelPath = `/wallet/model/${coinModelRouteKey}`
  const TABS = [
    ...(caps.ui.showAssetsTab ? [{ id: 'assets', label: 'Assets' }] : []),
    ...(caps.ui.showActivityTab ? [{ id: 'activity', label: 'Activity' }] : [])
  ]

  const activeTab = isSendRoute
    ? ''
    : isModelRoute
    ? ''
    : location.pathname.includes('/activity')
    ? 'activity'
    : (caps.ui.showAssetsTab ? 'assets' : 'activity')

  const handleTabChange = (id: string) => navigate(`/wallet/${id}`)

  useEffect(() => {
    if (!isModelRoute) return
    if (location.pathname === expectedModelPath) return
    navigate(expectedModelPath, { replace: true })
  }, [isModelRoute, location.pathname, expectedModelPath, navigate])

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <WalletFrame hideHeader={isSendRoute}>
      {!isSendRoute && (
        <div className="flex flex-col items-center pt-3 pb-4 shrink-0">
        {/* Coin logo */}
        <div className={clsx(
          'w-14 h-14 rounded-full bg-primary/10 border-2 flex items-center justify-center overflow-hidden mb-3',
          getModelIconFrameClass(activeNetwork.id)
        )}>
          {activeNetwork.logo
            ? <img src={activeNetwork.logo} alt={activeNetwork.name} className="w-full h-full object-cover rounded-full" />
            : <img src="/MetayoshiLogo.png" alt="MetaYoshi" className="w-full h-full object-contain object-center scale-[1.05] translate-y-[1px]" />
          }
        </div>

        {/* Balance */}
        <div className="mb-3 w-full px-4">
          <div className="mx-auto max-w-full text-center">
            <p className="text-[clamp(1.3rem,7.1vw,1.95rem)] font-bold leading-tight tracking-tight break-words">
              {displayBalance}
            </p>
            <p className="text-base font-semibold uppercase tracking-wide text-gray-300 mt-0.5">
              {activeNetwork.symbol}
            </p>
            {displayFiatValue && (
              <p className="text-sm font-medium text-gray-400 mt-1">
                {displayFiatValue}
              </p>
            )}
          </div>
        </div>

        {/* Quick-action buttons */}
        <div className={`flex justify-center gap-6 w-full px-6 mb-3 ${(caps.ui.showAssetsAction || caps.ui.showSendAction) ? '' : 'gap-0 justify-center'}`}>
          {caps.ui.showAssetsAction && (
            <QuickAction
              icon={<IoLayersOutline className="w-5 h-5" />}
              label="Assets"
              onClick={() => navigate('/assets')}
            />
          )}
          {caps.ui.showSendAction && (
            <QuickAction
              icon={<IoArrowUpOutline className="w-5 h-5" />}
              label="Send"
              onClick={() => navigate('/wallet/send', { state: { quickSendNative: true } })}
            />
          )}
          <QuickAction
            icon={<IoSearchOutline className="w-5 h-5" />}
            label="Model"
            onClick={() => navigate(`/wallet/model/${coinModelRouteKey}`)}
          />
        </div>
        </div>
      )}

      {/* Tabs — hidden on dedicated send route */}
      {!isSendRoute && <Tabs tabs={TABS} activeTab={activeTab} onChange={handleTabChange} />}

      <div className="flex-1 min-h-0 overflow-hidden">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </div>

      {/* ══ Account bottom sheet ════════════════════════════════════════════ */}
      {showAccountSheet && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-end"
          onClick={() => setShowAccountSheet(false)}
        >
          <div
            className="w-full max-w-[380px] bg-dark-800 rounded-t-3xl border-t border-dark-600 p-6 space-y-3 animate-in slide-in-from-bottom duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Accounts</h3>
              <button onClick={() => setShowAccountSheet(false)}>
                <IoClose className="w-5 h-5 text-gray-400 hover:text-white" />
              </button>
            </div>

            {accounts.map(acc => {
              const addr = acc.networkAddresses?.[activeNetworkId]
                || (activeNetwork.coinType === 'EVM' ? acc.addresses?.EVM : '')
                || ''
              const isCopied = copiedId === acc.id

              return (
                <div
                  key={acc.id}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                    acc.id === activeAccountId
                      ? 'border-primary bg-primary/10'
                      : 'border-dark-600 bg-dark-700/50'
                  }`}
                >
                  {/* Account info — click selects */}
                  <button
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    onClick={() => { setActiveAccount(acc.id); setShowAccountSheet(false) }}
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-yellow-400 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-bold">{getAccountDisplayName(acc, activeNetworkId, acc.name)}</span>
                      <span className="text-[10px] text-gray-500 font-mono truncate max-w-[160px]">
                        {addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : '—'}
                      </span>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    {acc.id === activeAccountId && (
                      <IoCheckmarkCircle className="w-4 h-4 text-primary" />
                    )}
                    {/* Copy address — click copies full address */}
                    <button
                      onClick={() => addr && void copyAddress(acc.id, addr)}
                      className="p-1.5 rounded-lg hover:bg-dark-600 transition-colors"
                      title="Copy full address"
                    >
                      {isCopied
                        ? <IoCheckmark className="w-4 h-4 text-green-400" />
                        : <IoCopyOutline className="w-4 h-4 text-gray-400 hover:text-white" />
                      }
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>,
        document.body
      )}

      {/* ══ Network bottom sheet ════════════════════════════════════════════ */}
      {showNetworkSheet && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-end"
          onClick={() => { setShowNetworkSheet(false); setNetworkSearch('') }}
        >
          <div
            className="w-full max-w-[380px] bg-dark-800 rounded-t-3xl border-t border-dark-600 p-5 space-y-3 animate-in slide-in-from-bottom duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Select Network</h3>
              <button onClick={() => { setShowNetworkSheet(false); setNetworkSearch('') }}>
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
            <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar">
              {visibleNetworks
                .map(net => (
                  <button
                    key={net.id}
                    onClick={() => { void setActiveNetwork(net.id); setShowNetworkSheet(false); setNetworkSearch('') }}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                      net.id === activeNetworkId
                        ? 'border-primary bg-primary/10'
                        : 'border-dark-600 bg-dark-700/50 hover:bg-dark-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {net.logo
                        ? (
                          <div className={clsx('w-7 h-7 rounded-full overflow-hidden', getModelIconRingClass(String(net.runtimeModelId || net.id || '')))}>
                            <img src={net.logo} alt={net.name} className="w-full h-full object-cover rounded-full" />
                          </div>
                        )
                        : <div className="w-7 h-7 rounded-full bg-dark-600 flex items-center justify-center"><div className="w-2.5 h-2.5 rounded-full bg-yellow-500" /></div>
                      }
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{net.name}</span>
                          {networkCapabilities(net).features.assetLayer && (
                            <span
                              title="Supports assets/tokens"
                              className="px-1.5 py-0.5 rounded-md border border-dark-600 bg-dark-700/70 text-[9px] font-black tracking-widest uppercase text-gray-200"
                            >
                              Assets
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-500 uppercase font-mono">{net.symbol}</span>
                      </div>
                    </div>
                    {net.id === activeNetworkId && (
                      <IoCheckmarkCircle className="w-5 h-5 text-primary shrink-0" />
                    )}
                  </button>
                ))
              }
              {visibleNetworks.length === 0 && (
                <p className="text-xs text-gray-600 text-center py-4">No networks match "{networkSearch}"</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

    </WalletFrame>
  )
}

// ── Quick-action button ────────────────────────────────────────────────────

interface QuickActionProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}

const QuickAction: React.FC<QuickActionProps> = ({ icon, label, onClick, disabled = false }) => (
  <button
    className="flex flex-col items-center gap-1.5 group disabled:opacity-50 disabled:cursor-not-allowed"
    onClick={onClick}
    disabled={disabled}
  >
    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center transition-transform group-active:scale-90 shadow-lg shadow-primary/20">
      {icon}
    </div>
    <span className="text-xs font-bold text-gray-300 group-hover:text-white transition-colors">{label}</span>
  </button>
)

export default WalletLayout

