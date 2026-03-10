import React from 'react'
import { IoFlashOutline } from 'react-icons/io5'
import { resolveNetworkModelControls } from '../../../lib/coinFeatureModel'
import { useWalletStore } from '../../../store/walletStore'

const EvmModelPage: React.FC = () => {
  const { activeNetworkId, networks, getNetworkModelPreferences, setNetworkModelPreferences } = useWalletStore()
  const activeNetwork = networks.find((network) => network.id === activeNetworkId) || networks[0]
  const modelPreferences = getNetworkModelPreferences(activeNetworkId)
  const gasLane = modelPreferences.evmGasLane || 'balanced'
  const controls = activeNetwork ? resolveNetworkModelControls(activeNetwork) : []

  const gasPalette = {
    economy: 'border-blue-500/40 bg-blue-900/10 text-blue-200',
    balanced: 'border-primary/40 bg-primary/10 text-orange-200',
    priority: 'border-red-500/40 bg-red-900/10 text-red-200'
  } as const

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
      <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-dark-700/90 to-dark-900 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Ethereum Lab</p>
          <span className="text-[9px] px-2 py-0.5 rounded-full border border-primary/40 text-orange-200 bg-primary/15">Execution-linked</span>
        </div>
        <p className="text-[11px] text-gray-400">
          Only live controls stay interactive here. Gas Orbit is applied to the next EVM send on {activeNetwork?.name || 'this network'}.
        </p>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase">
          <IoFlashOutline className="w-4 h-4 text-primary" />
          Gas Orbit
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['economy', 'balanced', 'priority'] as const).map((lane) => (
            <button
              key={lane}
              type="button"
              onClick={() => setNetworkModelPreferences({ networkId: activeNetworkId, updates: { evmGasLane: lane } })}
              className={`rounded-lg border p-2 text-[10px] font-bold uppercase transition-colors ${
                gasLane === lane ? gasPalette[lane] : 'border-dark-600 bg-dark-700/40 text-gray-400 hover:text-white'
              }`}
            >
              {lane}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">
          Current lane: <span className="font-bold uppercase text-gray-200">{gasLane}</span>.
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
                <span className={`text-[9px] px-2 py-0.5 rounded-full border uppercase ${
                  control.status === 'applied'
                    ? 'border-green-500/40 bg-green-500/10 text-green-200'
                    : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
                }`}>
                  {control.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-gray-400">{control.description}</p>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}

export default EvmModelPage
