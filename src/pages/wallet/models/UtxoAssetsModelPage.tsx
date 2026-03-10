import React, { useEffect, useMemo, useState } from 'react'
import { IoCubeOutline, IoFunnelOutline, IoGitCompareOutline } from 'react-icons/io5'
import { resolveNetworkModelControls } from '../../../lib/coinFeatureModel'
import { useWalletStore } from '../../../store/walletStore'

const UtxoAssetsModelPage: React.FC = () => {
  const {
    accounts,
    activeAccountId,
    activeNetworkId,
    networkAssets,
    fetchNetworkAssets,
    networks,
    getNetworkModelPreferences,
    setNetworkModelPreferences
  } = useWalletStore()
  const [query, setQuery] = useState('')
  const activeAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0]
  const activeNetwork = networks.find((network) => network.id === activeNetworkId) || networks[0]
  const composer = getNetworkModelPreferences(activeNetworkId).utxoTransferComposer || 'single'
  const controls = activeNetwork ? resolveNetworkModelControls(activeNetwork) : []
  const assetsMap = networkAssets?.[activeNetworkId] || {}
  const assetRows = useMemo(
    () => Object.entries(assetsMap).map(([symbol, rawAmount]) => ({ symbol, amount: Number(rawAmount) })),
    [assetsMap]
  )

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assetRows
    return assetRows.filter((a) => a.symbol.toLowerCase().includes(q))
  }, [assetRows, query])

  useEffect(() => {
    void fetchNetworkAssets().catch(() => {
      // Keep UI stable when asset index is unavailable.
    })
  }, [fetchNetworkAssets, activeNetworkId])

  const address = activeAccount?.networkAddresses?.[activeNetworkId] || ''

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
      <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-dark-700/90 to-dark-900 p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">UTXO Asset Studio</p>
        <p className="text-[11px] text-gray-400 mt-2">
          Transfer Composer now feeds the Send Hub routing on {activeNetwork?.name || 'this network'}.
        </p>
      </section>

      {activeNetworkId !== 'rtm' && (
        <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-gray-300">
            <IoFunnelOutline className="w-4 h-4 text-primary" />
            Asset Filter
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter asset symbols..."
            className="w-full bg-dark-700/60 border border-dark-600 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-primary"
          />
          {filteredAssets.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {filteredAssets.map((asset) => (
                <div key={asset.symbol} className="rounded-lg border border-dark-600 bg-dark-700/40 p-2">
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <IoCubeOutline className="w-3 h-3" />
                    {asset.symbol}
                  </div>
                  <p className="text-sm font-bold text-gray-200">{String(asset.amount)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500">No live asset balances returned for this address/network.</p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase text-gray-300">
          <IoGitCompareOutline className="w-4 h-4 text-primary" />
          Transfer Composer
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['single', 'batch'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setNetworkModelPreferences({ networkId: activeNetworkId, updates: { utxoTransferComposer: mode } })}
              className={`rounded-lg border py-1.5 text-[10px] font-bold uppercase ${
                composer === mode ? 'border-primary/50 bg-primary/15 text-orange-200' : 'border-dark-600 bg-dark-700/40 text-gray-400'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">
          Single keeps direct sends. Batch prefers the consolidated multi-holder flow when Send Hub can build one.
        </p>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-300">Feature Audit</p>
          <span className="text-[9px] text-gray-500">Per network</span>
        </div>
        <div className="space-y-2">
          {controls.map((control) => (
            <div key={control.key} className="rounded-lg border border-dark-600 bg-dark-700/30 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold text-gray-200">{control.label}</p>
                <span className="text-[9px] px-2 py-0.5 rounded-full border uppercase border-green-500/40 bg-green-500/10 text-green-200">
                  {control.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-gray-400">{control.description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-lg border border-dark-600 bg-dark-800/40 p-2 text-[10px] font-mono text-gray-500 break-all">
        {address || 'No active address'}
      </div>

    </div>
  )
}

export default UtxoAssetsModelPage
