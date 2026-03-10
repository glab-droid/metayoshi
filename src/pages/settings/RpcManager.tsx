import React, { useState } from 'react'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { useWalletStore, Network, CoinType } from '../../store/walletStore'
import { IoAdd, IoCheckmarkCircle, IoTrashOutline } from 'react-icons/io5'
import { useToast } from '../../components/Toast'

const RpcManager: React.FC = () => {
  const { networks, activeNetworkId, setActiveNetwork, addNetwork, removeNetwork } = useWalletStore()
  const [showAdd, setShowAdd] = useState(false)
  const [networkName, setNetworkName] = useState('')
  const [rpcUrl, setRpcUrl] = useState('')
  const [chainId, setChainId] = useState('')
  const [symbol, setSymbol] = useState('')
  const [coinType, setCoinType] = useState<CoinType>('EVM')
  const [error, setError] = useState('')
  const { showToast } = useToast()

  const handleSave = () => {
    setError('')
    
    if (!networkName.trim()) {
      setError('Network name is required')
      return
    }
    if (!rpcUrl.trim()) {
      setError('RPC URL is required')
      return
    }
    if (!symbol.trim()) {
      setError('Symbol is required')
      return
    }
    if (coinType === 'EVM' && !chainId.trim()) {
      setError('Chain ID is required for EVM networks')
      return
    }

    // Check if network name already exists
    if (networks.some(n => n.name.toLowerCase() === networkName.toLowerCase())) {
      setError('Network with this name already exists')
      return
    }

    const newNetwork: Network = {
      id: `custom-${Date.now()}`,
      name: networkName.trim(),
      symbol: symbol.trim().toUpperCase(),
      coinType,
      rpcUrl: rpcUrl.trim(),
      chainId: coinType === 'EVM' ? parseInt(chainId) : undefined,
    }

    addNetwork(newNetwork)
    showToast('Custom RPC network added successfully', 'success')
    
    // Reset form
    setNetworkName('')
    setRpcUrl('')
    setChainId('')
    setSymbol('')
    setCoinType('EVM')
    setShowAdd(false)
  }

  const handleRemove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // Don't allow removing default networks
    if (id.startsWith('rtm-mainnet') || id.startsWith('eth-mainnet') || 
        id.startsWith('btc-mainnet') || id.startsWith('sol-mainnet')) {
      showToast('Cannot remove default networks', 'error')
      return
    }
    removeNetwork(id)
    showToast('Network removed', 'success')
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 bg-dark-900 border-b border-dark-600 text-center flex items-center justify-between">
        <div className="w-8" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-200">RPC Manager</h2>
        <button 
          onClick={() => {
            setShowAdd(!showAdd)
            setError('')
          }}
          className="w-8 h-8 flex items-center justify-center text-primary hover:bg-dark-700 rounded-full transition-colors"
        >
          <IoAdd className="w-6 h-6" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {showAdd ? (
          <div className="p-6 space-y-6">
            <h3 className="text-sm font-bold text-gray-200">Add custom RPC</h3>
            <div className="space-y-4">
               <Input 
                 label="Network Name" 
                 placeholder="My custom network" 
                 value={networkName}
                 onChange={(e) => setNetworkName(e.target.value)}
               />
               <div>
                 <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Coin Type</label>
                 <select
                   value={coinType}
                   onChange={(e) => setCoinType(e.target.value as CoinType)}
                   className="input-field w-full"
                 >
                   <option value="EVM">EVM</option>
                   <option value="BTC">Bitcoin</option>
                   <option value="SOL">Solana</option>
                   <option value="SUI">Sui</option>
                 </select>
               </div>
               <Input 
                 label="RPC URL" 
                 placeholder="https://..." 
                 value={rpcUrl} 
                 onChange={(e) => setRpcUrl(e.target.value)} 
               />
               {coinType === 'EVM' && (
                 <Input 
                   label="Chain ID" 
                   placeholder="123" 
                   type="number"
                   value={chainId}
                   onChange={(e) => setChainId(e.target.value)}
                 />
               )}
               <Input 
                 label="Symbol" 
                 placeholder="COIN" 
                 value={symbol}
                 onChange={(e) => setSymbol(e.target.value)}
               />
            </div>
            {error && <p className="text-xs text-red-500 font-bold text-center">{error}</p>}
            <div className="flex gap-4 pt-4">
               <Button 
                 variant="outline" 
                 className="flex-1" 
                 onClick={() => {
                   setShowAdd(false)
                   setError('')
                 }}
               >
                 Cancel
               </Button>
               <Button className="flex-1" onClick={handleSave}>Save</Button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-dark-600">
            {networks.map((network) => {
              const isDefault = network.id.startsWith('rtm-mainnet') || 
                               network.id.startsWith('eth-mainnet') || 
                               network.id.startsWith('btc-mainnet') || 
                               network.id.startsWith('sol-mainnet')
              return (
                <div 
                  key={network.id} 
                  className={`flex items-center justify-between p-4 cursor-pointer hover:bg-dark-700 transition-colors ${
                    activeNetworkId === network.id ? 'bg-primary/5' : ''
                  }`}
                  onClick={() => void setActiveNetwork(network.id)}
                >
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                     <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-200">{network.name}</span>
                        {activeNetworkId === network.id && <IoCheckmarkCircle className="text-primary w-4 h-4" />}
                     </div>
                     <span className="text-[10px] text-gray-500 font-mono truncate">{network.rpcUrl}</span>
                  </div>
                  {!isDefault && (
                    <button
                      onClick={(e) => handleRemove(network.id, e)}
                      className="p-2 text-gray-500 hover:text-red-500 transition-colors ml-2"
                    >
                      <IoTrashOutline className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default RpcManager
