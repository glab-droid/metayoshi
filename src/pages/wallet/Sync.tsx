import React, { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useWalletStore } from '../../store/walletStore'

const Sync: React.FC = () => {
  const { setSyncing } = useWalletStore()

  useEffect(() => {
    setSyncing(true)
    return () => setSyncing(false)
  }, [setSyncing])

  return <Navigate to="/wallet/assets" />
}

export default Sync
