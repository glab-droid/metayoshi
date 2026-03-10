import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { useWalletStore } from '../store/walletStore'

const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'metayoshi-0.1.7'

const Unlock: React.FC = () => {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  
  const navigate = useNavigate()
  const { unlock, isInitialized } = useWalletStore()

  if (!isInitialized) {
    navigate('/register')
    return null
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    
    try {
      const success = await unlock(password)
      setIsLoading(false)
      if (success) {
        setIsTransitioning(true)
        await new Promise((resolve) => setTimeout(resolve, 900))
        navigate('/connecting')
      } else {
        setError('Incorrect password')
      }
    } catch (e: any) {
      setIsLoading(false)
      setError(String(e?.message ?? 'Unlock failed'))
    }
  }

  if (isTransitioning) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-dark-800 p-8">
        <div className="relative flex items-center justify-center w-full max-w-[280px] h-40">
          <motion.div
            className="absolute w-24 h-24 rounded-full border border-primary/30"
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          />

          <div className="z-10 w-16 h-16 rounded-full bg-primary/10 border-2 border-primary/35 flex items-center justify-center overflow-hidden shadow-[0_0_14px_rgba(245,132,31,0.2)] animate-breathe">
            <div className="w-8 h-8 rounded-full bg-primary/30" />
          </div>

          <div className="absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 w-[120px] h-[2px] bg-dark-600">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0, x: -60 }}
              animate={{
                width: ['0%', '100%', '0%'],
                x: ['-50%', '0%', '50%']
              }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          <motion.div
            className="absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-full shadow-[0_0_15px_rgba(245,132,31,0.8)]"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />

          <img
            src="/MetayoshiLogo.png"
            alt="MetaYoshi"
            className="z-10 w-20 h-20 object-contain object-center ml-auto drop-shadow-[0_0_12px_rgba(245,132,31,0.25)]"
          />
        </div>

        <p className="mt-8 text-[11px] font-black uppercase tracking-[0.28em] text-primary">METAYOSHI</p>
        <p className="mt-1.5 text-sm font-medium text-gray-400 text-center">Unlock successful, preparing wallet…</p>
        <div className="mt-2 flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary/80"
              animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12 }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-between h-full p-8 text-center bg-dark-800">
      <div className="flex flex-col items-center mt-12 gap-6">
        <p className="text-2xl font-black uppercase tracking-[0.22em] text-primary">METAYOSHI</p>
        <img
          src="/MetayoshiLogo.png"
          alt="MetaYoshi"
          className="w-32 h-32 object-contain object-center"
        />
        <div className="space-y-1">
          <h1 className="text-2xl font-black uppercase tracking-tight">Welcome Back!</h1>
        </div>
      </div>

      <form onSubmit={handleUnlock} className="w-full space-y-6">
        <Input 
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
          className="bg-dark-700/50 border-dark-600 focus:border-primary text-center h-12"
        />
        
        <div className="space-y-4">
          <Button 
            type="submit"
            className="w-full"
            isLoading={isLoading}
          >
            Unlock
          </Button>
          <button
            type="button"
            className="text-primary font-bold text-sm hover:underline"
            onClick={() => navigate('/settings/restore')}
          >
            Forgot password?
          </button>
        </div>
      </form>

      <footer className="flex flex-col items-center gap-1.5 text-gray-500 text-xs font-medium mt-auto">
        <span className="px-2.5 py-0.5 rounded-full bg-dark-700/60 border border-dark-600/60 text-[10px] font-bold tracking-widest text-gray-600 uppercase">
          v{APP_VERSION}
        </span>
      </footer>
    </div>
  )
}

export default Unlock
