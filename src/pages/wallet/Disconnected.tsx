import React, { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useWalletStore } from '../../store/walletStore'

const Disconnected: React.FC = () => {
  const { setConnected } = useWalletStore()

  useEffect(() => {
    setConnected(false)
    return () => setConnected(true)
  }, [setConnected])

  return <Navigate to="/wallet/assets" />
}

export default Disconnected
