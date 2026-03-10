import React from 'react'
import { Button } from '../../components/Button'

interface DappApprovalStatusProps {
  loading: boolean
  onBack: () => void
}

const DappApprovalStatus: React.FC<DappApprovalStatusProps> = ({ loading, onBack }) => {
  if (loading) {
    return (
      <div className="flex flex-col h-full bg-dark-800 items-center justify-center text-xs text-gray-400">
        Loading approval request...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-gray-400">
        No pending dapp approval request.
      </div>
      <footer className="p-4 border-t border-dark-600">
        <Button className="w-full btn-primary" onClick={onBack}>
          Back to wallet
        </Button>
      </footer>
    </div>
  )
}

export default DappApprovalStatus

