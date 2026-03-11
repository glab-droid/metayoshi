import React, { useMemo } from 'react'
import { IoEyeOffOutline, IoLocateOutline, IoShieldHalfOutline } from 'react-icons/io5'
import { resolveNetworkModelControls } from '../../../lib/coinFeatureModel'
import { useWalletStore } from '../../../store/walletStore'

const MoneroModelPage: React.FC = () => {
  const { accounts, activeAccountId, activeNetworkId, networks } = useWalletStore()
  const activeAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0]
  const activeNetwork = networks.find((network) => network.id === activeNetworkId) || networks[0]

  const xmrAddress = useMemo(
    () => activeAccount?.networkAddresses?.[activeNetworkId] || '',
    [activeAccount, activeNetworkId]
  )
  const controls = activeNetwork ? resolveNetworkModelControls(activeNetwork) : []

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
      <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-dark-700/90 to-dark-900 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Monero Native</p>
          <span className="text-[9px] px-2 py-0.5 rounded-full border border-yellow-500/40 text-yellow-200 bg-yellow-500/10">Audit mode</span>
        </div>
        <p className="text-[11px] text-gray-400">
          This page now shows only reliable runtime information. Unsupported Monero popup switches stay read-only until the signer flow can honor them.
        </p>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase">
          <IoLocateOutline className="w-4 h-4 text-primary" />
          Runtime Coverage
        </div>
        <div className="space-y-2">
          {controls.map((control) => (
            <div key={control.key} className="rounded-lg border border-dark-600 bg-dark-700/30 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold text-gray-200">{control.label}</p>
                <span className={`text-[9px] px-2 py-0.5 rounded-full border uppercase ${
                  control.status === 'unsupported'
                    ? 'border-red-500/40 bg-red-500/10 text-red-200'
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

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase">
          <IoEyeOffOutline className="w-4 h-4 text-primary" />
          Active Address
        </div>
        <div className="rounded-lg border border-dark-600 bg-dark-800/40 p-2 text-[10px] font-mono text-gray-500 break-all">
          {xmrAddress || 'No Monero address available'}
        </div>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase">
          <IoShieldHalfOutline className="w-4 h-4 text-primary" />
          Privacy Posture
        </div>
        <p className="text-[11px] text-gray-400">
          Current send flow remains non-custodial, but popup-level scan depth and subaddress routing are not yet wired into execution.
        </p>
      </section>

    </div>
  )
}

export default MoneroModelPage
