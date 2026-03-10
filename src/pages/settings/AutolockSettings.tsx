import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { useWalletStore } from '../../store/walletStore'

const AutolockSettings: React.FC = () => {
  const { autolockMinutes, setAutolock } = useWalletStore()
  const [value, setValue] = useState(autolockMinutes)
  const navigate = useNavigate()

  const handleUpdate = () => {
    setAutolock(value)
    navigate('/settings')
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 bg-dark-900 border-b border-dark-600 text-center">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-200 leading-tight">Wallet Account Settings - Change Autolock Settings</h2>
      </header>

      <div className="flex-1 p-8 space-y-12">
        <div className="text-center space-y-2">
           <h3 className="text-4xl font-black text-primary">{value}</h3>
           <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">minutes</p>
        </div>

        <div className="space-y-6">
          <input 
            type="range"
            min="0"
            max="10"
            step="1"
            value={value}
            onChange={(e) => setValue(parseInt(e.target.value))}
            className="w-full h-2 bg-dark-700 rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between px-1">
             {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => (
               <div key={v} className="flex flex-col items-center gap-1">
                 <div className="w-[1px] h-2 bg-dark-600" />
                 <span className="text-[8px] font-bold text-gray-500">{v}</span>
               </div>
             ))}
          </div>
        </div>

        <p className="text-[10px] text-gray-500 text-center leading-relaxed font-medium">
          The wallet will automatically lock after being idle for {value} minutes. To re-access your wallet, you will need to enter your password.
        </p>
      </div>

      <footer className="p-6">
        <Button 
          className="w-full btn-primary"
          onClick={handleUpdate}
        >
          Confirm
        </Button>
      </footer>
    </div>
  )
}

export default AutolockSettings
