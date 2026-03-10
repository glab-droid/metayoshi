import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { useWalletStore } from '../../store/walletStore'

const MIN_DONATION_PERCENT = 0.5
const MAX_DONATION_PERCENT = 5

function clampDonationPercent(value: number): number {
  if (!Number.isFinite(value)) return MIN_DONATION_PERCENT
  return Math.max(MIN_DONATION_PERCENT, Math.min(MAX_DONATION_PERCENT, Number(value.toFixed(1))))
}

const DonationSettings: React.FC = () => {
  const { donationPercent, setDonationPercent } = useWalletStore()
  const [value, setValue] = useState(clampDonationPercent(donationPercent))
  const navigate = useNavigate()

  const handleUpdate = () => {
    setDonationPercent(value)
    navigate('/settings')
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 bg-dark-900 border-b border-dark-600 text-center">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-200 leading-tight">
          Wallet Account Settings - Donation Percentage
        </h2>
      </header>

      <div className="flex-1 p-8 space-y-12">
        <div className="text-center space-y-2">
          <h3 className="text-4xl font-black text-primary">{value.toFixed(1)}%</h3>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">send donation</p>
        </div>

        <div className="space-y-6">
          <input
            type="range"
            min={MIN_DONATION_PERCENT}
            max={MAX_DONATION_PERCENT}
            step="0.1"
            value={value}
            onChange={(e) => setValue(clampDonationPercent(Number(e.target.value)))}
            className="w-full h-2 bg-dark-700 rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between px-1 text-[9px] font-bold text-gray-500">
            <span>{MIN_DONATION_PERCENT.toFixed(1)}%</span>
            <span>{MAX_DONATION_PERCENT.toFixed(1)}%</span>
          </div>
        </div>

        <p className="text-[10px] text-gray-500 text-center leading-relaxed font-medium">
          This percentage is applied to supported coin donations when donation is optional.
          Server-enforced donation policy still takes priority.
        </p>
      </div>

      <footer className="p-6">
        <Button className="w-full btn-primary" onClick={handleUpdate}>
          Confirm
        </Button>
      </footer>
    </div>
  )
}

export default DonationSettings
