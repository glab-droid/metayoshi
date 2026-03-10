import React, { useState } from 'react'
import { Button } from './Button'
import { Input } from './Input'
import { useWalletStore } from '../store/walletStore'

interface PasswordGateProps {
  children: React.ReactNode
  onSuccess?: () => void
  title?: string
  description?: string
}

export const PasswordGate: React.FC<PasswordGateProps> = ({ 
  children, 
  onSuccess,
  title = "Authentication Required",
  description = "Please enter your wallet password to continue"
}) => {
  const [password, setPassword] = useState('')
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [error, setError] = useState('')
  const { unlock } = useWalletStore()

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const ok = await unlock(password)
    if (!ok) {
      setError('Incorrect password')
      return
    }

    setIsUnlocked(true)
    onSuccess?.()
  }

  if (isUnlocked) return <>{children}</>

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-dark-800">
      <div className="flex flex-col items-center gap-6 mb-8">
        <div className="w-20 h-20 flex items-center justify-center border-2 border-primary bg-gradient-to-b from-primary/35 to-primary/10 shadow-[0_0_22px_rgba(245,132,31,0.22)]">
           <img src="/MetayoshiLogo.png" alt="MetaYoshi" className="w-full h-full object-contain object-center scale-[1.12] translate-y-[2px]" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-xs text-gray-400 font-medium px-4">{description}</p>
        </div>
      </div>

      <form onSubmit={handleUnlock} className="w-full space-y-6">
        <Input 
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
          className="bg-dark-700/50 text-center"
        />
        
        <Button 
          type="submit"
          className="w-full"
        >
          Verify Password
        </Button>
      </form>
    </div>
  )
}
