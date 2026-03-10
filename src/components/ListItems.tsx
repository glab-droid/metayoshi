import React from 'react'
import {
  IoArrowDownOutline,
  IoArrowUpOutline,
  IoChevronForward,
  IoLayersOutline,
  IoSwapHorizontalOutline
} from 'react-icons/io5'

interface AssetRowProps {
  name: string
  balance: string
  symbol: string
  icon?: string
  onClick?: () => void
}

export const AssetRow: React.FC<AssetRowProps> = ({ name, balance, symbol, icon, onClick }) => {
  return (
    <div
      className="flex items-center justify-between p-4 hover:bg-dark-700 cursor-pointer transition-colors border-b border-dark-600/50"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center overflow-hidden">
          {icon ? <img src={icon} alt={name} className="w-full h-full object-contain" /> : <div className="w-full h-full bg-gray-200" />}
        </div>
        <span className="text-sm font-bold uppercase tracking-wide">{balance} {name || symbol}</span>
      </div>
      <IoChevronForward className="text-gray-500 w-5 h-5" />
    </div>
  )
}

interface ActivityRowProps {
  type: 'sent' | 'received' | 'swap'
  amount: string
  asset: string
  address?: string
  status: string
  timestamp?: number
  isAssetTransfer?: boolean
  onClick?: () => void
}

export const ActivityRow: React.FC<ActivityRowProps> = ({
  type,
  amount,
  asset,
  address,
  status,
  timestamp,
  isAssetTransfer = false,
  onClick
}) => {
  const typeLabel = type === 'sent' ? 'Sent' : type === 'received' ? 'Received' : 'Swapped'
  const shortAddress = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : '--'
  const actionText =
    type === 'sent'
      ? `to ${shortAddress}`
      : type === 'received'
        ? `from ${shortAddress}`
        : `via ${shortAddress}`
  const compactDate = timestamp
    ? new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
    : ''

  return (
    <div
      className="flex items-center justify-between p-3 hover:bg-dark-700 cursor-pointer transition-colors border-b border-dark-600/30"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full border border-dark-600 bg-dark-700/70 flex items-center justify-center overflow-hidden">
          {isAssetTransfer ? (
            <IoLayersOutline className="w-4.5 h-4.5 text-yellow-400" />
          ) : type === 'received' ? (
            <IoArrowDownOutline className="w-4.5 h-4.5 text-green-400" />
          ) : type === 'swap' ? (
            <IoSwapHorizontalOutline className="w-4.5 h-4.5 text-blue-400" />
          ) : (
            <IoArrowUpOutline className="w-4.5 h-4.5 text-primary" />
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold">{typeLabel} {amount} {asset} {actionText}</span>
          <div className="flex items-center gap-2">
            <span className={status === 'confirmed' ? 'text-[10px] text-green-500 capitalize' : 'text-[10px] text-yellow-500 capitalize'}>
              {status}
            </span>
            {compactDate && <span className="text-[9px] text-gray-500">{compactDate}</span>}
          </div>
        </div>
      </div>
      <IoChevronForward className="text-gray-500 w-5 h-5" />
    </div>
  )
}
