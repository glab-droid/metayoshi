import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IoAlertCircle, IoCheckmarkCircle, IoClose, IoCloseCircle, IoWarningOutline } from 'react-icons/io5'
import clsx from 'clsx'
import { Button } from '../../components/Button'
import { useWalletStore } from '../../store/walletStore'
import { compareNetworksByModelFamily } from '../../lib/coinModel'
import { resolveNetworkCapabilities } from '../../lib/networkCapabilities'
import { getEnabledNetworks, normalizeDisabledNetworkIds } from '../../lib/networkVisibility'
import { MAX_ACTIVE_REFRESH_NETWORKS } from '../../store/walletStoreStateUtils'
import { getModelIconRingClass, getModelStatus } from '../../buildConfig'

const BlockchainVisibilitySettings: React.FC = () => {
  const {
    networks,
    activity,
    activeNetworkId,
    disabledNetworkIds,
    setNetworkEnabled
  } = useWalletStore()
  const [pendingRiskNetworkId, setPendingRiskNetworkId] = useState<string | null>(null)

  const normalizedDisabled = useMemo(
    () => normalizeDisabledNetworkIds(disabledNetworkIds, networks),
    [disabledNetworkIds, networks]
  )
  const disabledSet = useMemo(() => new Set(normalizedDisabled), [normalizedDisabled])
  const enabledNetworks = useMemo(
    () => getEnabledNetworks(networks, normalizedDisabled),
    [networks, normalizedDisabled]
  )
  const enabledCount = enabledNetworks.length

  const rankedNetworks = useMemo(() => {
    const usageByNetwork = new Map<string, number>()
    for (const row of activity) {
      const networkId = String(row?.networkId || '').trim()
      if (!networkId) continue
      usageByNetwork.set(networkId, (usageByNetwork.get(networkId) || 0) + 1)
    }
    return [...networks].sort((a, b) => {
      const familyDelta = compareNetworksByModelFamily(a, b)
      if (familyDelta !== 0) return familyDelta
      const usageDelta = (usageByNetwork.get(b.id) || 0) - (usageByNetwork.get(a.id) || 0)
      if (usageDelta !== 0) return usageDelta
      return a.name.localeCompare(b.name)
    })
  }, [activity, networks])
  const pendingRiskNetwork = useMemo(
    () => networks.find((network) => network.id === pendingRiskNetworkId) || null,
    [networks, pendingRiskNetworkId]
  )

  const handleNetworkToggle = (networkId: string, enabled: boolean) => {
    if (enabled) {
      const target = networks.find((network) => network.id === networkId)
      const status = getModelStatus(String(target?.runtimeModelId || target?.id || ''))
      if (status !== 'tested') {
        setPendingRiskNetworkId(networkId)
        return
      }
    }
    setNetworkEnabled(networkId, enabled)
  }

  const closeRiskDialog = () => setPendingRiskNetworkId(null)
  const confirmRiskDialog = () => {
    if (!pendingRiskNetworkId) return
    setNetworkEnabled(pendingRiskNetworkId, true)
    setPendingRiskNetworkId(null)
  }

  return (
    <>
      <div className="flex flex-col">
        <header className="px-4 py-3 text-center border-b border-dark-600">
          <h1 className="text-sm font-black uppercase tracking-widest text-gray-200">Blockchain Visibility</h1>
        </header>

        <div className="p-4 space-y-4">
          <div className="flex gap-2.5 p-3 bg-dark-700/20 border border-dark-600/60 rounded-xl">
            <IoWarningOutline className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-gray-300 leading-relaxed">
              Keep only the chains you really use. The wallet allows at most {MAX_ACTIVE_REFRESH_NETWORKS} active blockchains for refresh, and new wallets start with only tested blockchains enabled by default.
            </p>
          </div>

          <p className="text-[10px] text-gray-500">
            {enabledCount} / {MAX_ACTIVE_REFRESH_NETWORKS} active for refresh
          </p>

          <div className="space-y-2">
            {rankedNetworks.map((network) => {
              const isEnabled = !disabledSet.has(network.id)
              const canToggle = isEnabled ? enabledCount > 1 : enabledCount < MAX_ACTIVE_REFRESH_NETWORKS
              const capabilities = resolveNetworkCapabilities(network)
              return (
                <label
                  key={network.id}
                  className={clsx(
                    'flex items-center justify-between gap-3 p-3 rounded-xl border transition-colors',
                    isEnabled
                      ? 'border-dark-600 bg-dark-700/40 hover:bg-dark-700/70'
                      : 'border-dark-600/70 bg-dark-800/60'
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {network.logo ? (
                      <div className={clsx('w-8 h-8 rounded-full overflow-hidden shrink-0', getModelIconRingClass(String(network.runtimeModelId || network.id || '')))}>
                        <img src={network.logo} alt={network.name} className="w-full h-full rounded-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-dark-600 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-gray-200 truncate">{network.name}</p>
                        {getModelStatus(String(network.runtimeModelId || network.id || '')) === 'tested' ? (
                          <IoCheckmarkCircle className="w-4 h-4 text-green-400 shrink-0" title="Tested" />
                        ) : (
                          <IoCloseCircle className="w-4 h-4 text-red-400 shrink-0" title="Not tested" />
                        )}
                        {network.id === activeNetworkId && (
                          <span className="px-1.5 py-0.5 rounded-md border border-primary/30 bg-primary/10 text-[9px] font-black tracking-widest uppercase text-primary shrink-0">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[10px] text-gray-500 uppercase font-mono">{network.symbol}</p>
                        {capabilities.features.assetLayer && (
                          <span className="px-1.5 py-0.5 rounded-md border border-dark-600 bg-dark-700/70 text-[9px] font-black tracking-widest uppercase text-gray-200">
                            Assets
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(event) => handleNetworkToggle(network.id, event.target.checked)}
                    disabled={!canToggle}
                    className="w-4 h-4 accent-primary disabled:opacity-50"
                  />
                </label>
              )
            })}
          </div>

          {enabledCount <= 1 && (
            <p className="text-[10px] text-yellow-300">
              At least one blockchain must stay enabled.
            </p>
          )}
          {enabledCount >= MAX_ACTIVE_REFRESH_NETWORKS && (
            <p className="text-[10px] text-yellow-300">
              Maximum active blockchains reached. Disable one before enabling another.
            </p>
          )}
        </div>
      </div>

      {pendingRiskNetwork && createPortal(
        <div
          className="fixed inset-0 z-[10000] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeRiskDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="untested-network-dialog-title"
            className="w-full max-w-[360px] rounded-[28px] border border-red-500/35 bg-dark-800 shadow-2xl shadow-black/50 overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative p-5 border-b border-red-500/20 bg-[linear-gradient(180deg,rgba(127,29,29,0.3),rgba(17,19,22,0.96))]">
              <button
                type="button"
                onClick={closeRiskDialog}
                className="absolute right-4 top-4 p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                aria-label="Close warning"
              >
                <IoClose className="w-4 h-4" />
              </button>
              <div className="w-12 h-12 rounded-2xl border border-red-400/35 bg-red-500/12 flex items-center justify-center shadow-[0_0_24px_rgba(239,68,68,0.2)]">
                <IoAlertCircle className="w-7 h-7 text-red-300" />
              </div>
              <div className="mt-4 space-y-2">
                <span className="inline-flex items-center rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-red-200">
                  High Risk
                </span>
                <div className="space-y-1">
                  <h2 id="untested-network-dialog-title" className="text-base font-black uppercase tracking-[0.18em] text-white">
                    Enable untested network?
                  </h2>
                  <p className="text-sm font-semibold text-red-100">
                    {pendingRiskNetwork.name} has not been fully validated inside this wallet.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4">
                <p className="text-sm font-semibold text-gray-100 leading-relaxed">
                  This connection may fail, show incorrect balances, or create transactions that you cannot safely recover.
                </p>
                <p className="mt-2 text-sm font-black uppercase tracking-wide text-red-300">
                  You could lose coins if you use it before it is fully tested.
                </p>
              </div>

              <div className="rounded-2xl border border-dark-600 bg-dark-700/40 p-4 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Before enabling</p>
                <ul className="space-y-2 text-[11px] text-gray-300 leading-relaxed">
                  <li className="flex gap-2">
                    <IoWarningOutline className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                    <span>Do not move large balances until you verify sending, receiving, and explorer data on this network.</span>
                  </li>
                  <li className="flex gap-2">
                    <IoWarningOutline className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                    <span>Test with a small amount first and confirm the destination address and chain are correct.</span>
                  </li>
                </ul>
              </div>

              <div className="flex gap-3 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={closeRiskDialog}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1 !rounded-2xl !bg-red-600 hover:!bg-red-500 active:!bg-red-700 text-white shadow-lg shadow-red-900/30"
                  onClick={confirmRiskDialog}
                >
                  Enable Anyway
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export default BlockchainVisibilitySettings
