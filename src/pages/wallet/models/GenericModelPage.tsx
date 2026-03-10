import React from 'react'
import { IoAlertCircleOutline, IoExtensionPuzzleOutline, IoServerOutline } from 'react-icons/io5'
import { useWalletStore } from '../../../store/walletStore'

const GenericModelPage: React.FC = () => {
  const { networks, activeNetworkId } = useWalletStore()
  const activeNetwork = networks.find((n) => n.id === activeNetworkId) || networks[0]

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
      <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-dark-700/90 to-dark-900 p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Generic Chain View</p>
        <p className="text-[11px] text-gray-400 mt-2">Fallback presentation for networks without a dedicated model implementation.</p>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <Row icon={<IoServerOutline className="w-4 h-4 text-primary" />} label="Network" value={activeNetwork.name} />
        <Row icon={<IoExtensionPuzzleOutline className="w-4 h-4 text-primary" />} label="Coin Type" value={activeNetwork.coinType} />
        <Row icon={<IoAlertCircleOutline className="w-4 h-4 text-primary" />} label="Status" value="Fallback model active" />
      </section>

    </div>
  )
}

const Row: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="rounded-lg border border-dark-600 bg-dark-700/40 px-3 py-2 flex items-center justify-between">
    <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase">
      {icon}
      {label}
    </div>
    <span className="text-xs font-bold text-gray-200">{value}</span>
  </div>
)

export default GenericModelPage
