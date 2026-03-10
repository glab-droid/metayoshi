import React from 'react'
import { IoConstructOutline, IoOptionsOutline } from 'react-icons/io5'
import { resolveNetworkModelControls } from '../../../lib/coinFeatureModel'
import { useWalletStore } from '../../../store/walletStore'

const UtxoClassicModelPage: React.FC = () => {
  const { activeNetworkId, networks, getNetworkModelPreferences, setNetworkModelPreferences } = useWalletStore()
  const activeNetwork = networks.find((network) => network.id === activeNetworkId) || networks[0]
  const modelPreferences = getNetworkModelPreferences(activeNetworkId)
  const feePreset = modelPreferences.utxoFeePreset || 'fast'
  const inputStrategy = modelPreferences.utxoInputStrategy || 'minimize-inputs'
  const controls = activeNetwork ? resolveNetworkModelControls(activeNetwork) : []

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
      <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-dark-700/90 to-dark-900 p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Classic UTXO Console</p>
        <p className="text-[11px] text-gray-400 mt-2">
          Fee and input preferences here are applied to the next native send on {activeNetwork?.name || 'this network'}.
        </p>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase text-gray-300">
          <IoOptionsOutline className="w-4 h-4 text-primary" />
          Fee Preset
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['cheap', 'fast', 'premium'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setNetworkModelPreferences({ networkId: activeNetworkId, updates: { utxoFeePreset: preset } })}
              className={`rounded-lg border py-1.5 text-[10px] font-bold uppercase ${
                feePreset === preset ? 'border-primary/50 bg-primary/15 text-orange-200' : 'border-dark-600 bg-dark-700/40 text-gray-400'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">
          Cheap reduces sat/vbyte, fast keeps the default baseline, premium adds extra confirmation headroom.
        </p>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase text-gray-300">
          <IoConstructOutline className="w-4 h-4 text-primary" />
          Input Strategy
        </div>
        <div className="grid grid-cols-2 gap-2">
          {([
            { key: 'minimize-inputs', label: 'Minimize Inputs' },
            { key: 'consolidate-fragments', label: 'Consolidate' }
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setNetworkModelPreferences({ networkId: activeNetworkId, updates: { utxoInputStrategy: option.key } })}
              className={`rounded-lg border py-2 text-[10px] font-bold uppercase ${
                inputStrategy === option.key ? 'border-primary/50 bg-primary/15 text-orange-200' : 'border-dark-600 bg-dark-700/40 text-gray-400'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">
          Minimize Inputs spends larger UTXOs first. Consolidate prefers smaller fragments to clean up future sends.
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

    </div>
  )
}

export default UtxoClassicModelPage
