import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { useWalletStore } from '../../store/walletStore'
import { IoArrowBack, IoSwapHorizontal } from 'react-icons/io5'
import { getEnabledNetworks } from '../../lib/networkVisibility'

const Swap: React.FC = () => {
  const navigate = useNavigate()
  const { accounts, activeAccountId, networks, disabledNetworkIds, activeNetworkId } = useWalletStore()
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [fromToken, setFromToken] = useState(activeNetworkId)
  const [toToken, setToToken] = useState('')

  const enabledNetworks = getEnabledNetworks(networks, disabledNetworkIds)
  const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0]
  const activeNetwork = enabledNetworks.find(n => n.id === activeNetworkId) || enabledNetworks[0]

  const handleSwap = () => {
    // Mock swap functionality
    // In a real implementation, this would interact with a DEX or swap service
    navigate('/wallet/assets')
  }

  const swapTokens = () => {
    const temp = fromToken
    setFromToken(toToken || activeNetworkId)
    setToToken(temp)
    const tempAmount = fromAmount
    setFromAmount(toAmount)
    setToAmount(tempAmount)
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 border-b border-dark-600 flex items-center gap-3">
        <button 
          onClick={() => navigate('/wallet/assets')}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <IoArrowBack className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest text-gray-200">Swap Tokens</h1>
      </header>

      <div className="flex-1 flex flex-col p-6 space-y-6 overflow-y-auto custom-scrollbar">
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-dark-600 bg-dark-700/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-400 uppercase">From</span>
              <span className="text-[10px] text-gray-500">Balance: {activeAccount?.balance || 0}</span>
            </div>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                placeholder="0.0"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
                className="flex-1 bg-dark-800 border-dark-600"
              />
              <select
                value={fromToken}
                onChange={(e) => setFromToken(e.target.value)}
                className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-xs font-bold text-gray-200"
              >
                {enabledNetworks.map((net) => (
                  <option key={net.id} value={net.id}>{net.symbol}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-center -my-2">
            <button
              onClick={swapTokens}
              className="p-2 bg-dark-700 border border-dark-600 rounded-full hover:bg-dark-600 transition-colors"
            >
              <IoSwapHorizontal className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="p-4 rounded-xl border border-dark-600 bg-dark-700/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-400 uppercase">To</span>
            </div>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                placeholder="0.0"
                value={toAmount}
                onChange={(e) => setToAmount(e.target.value)}
                className="flex-1 bg-dark-800 border-dark-600"
                readOnly
              />
              <select
                value={toToken}
                onChange={(e) => setToToken(e.target.value)}
                className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-xs font-bold text-gray-200"
              >
                <option value="">Select token</option>
                {enabledNetworks.filter(n => n.id !== fromToken).map((net) => (
                  <option key={net.id} value={net.id}>{net.symbol}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="p-4 bg-dark-900/50 rounded-xl border border-dark-600 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Exchange Rate</span>
            <span className="text-gray-300 font-bold">1 {enabledNetworks.find(n => n.id === fromToken)?.symbol} = 1.0 {enabledNetworks.find(n => n.id === toToken)?.symbol}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Estimated Gas</span>
            <span className="text-gray-300 font-bold">~0.001 {activeNetwork.symbol}</span>
          </div>
        </div>

        <div className="mt-auto pt-4">
          <Button 
            className="w-full btn-primary"
            onClick={handleSwap}
            disabled={!fromAmount || !toToken || parseFloat(fromAmount) <= 0}
          >
            Swap
          </Button>
        </div>
      </div>
    </div>
  )
}

export default Swap
