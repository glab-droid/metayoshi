import React, { useState, useEffect, createContext, useContext } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { IoCheckmarkCircle, IoInformationCircle, IoAlertCircle } from 'react-icons/io5'

interface Toast {
  id: string
  message: string
  type: 'success' | 'info' | 'error'
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'info' | 'error') => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export const useToast = () => {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within ToastProvider')
  return context
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9)
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-[320px] px-4 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={`p-3 rounded-xl border flex items-center gap-3 shadow-lg ${
                toast.type === 'success' ? 'bg-green-900/80 border-green-500/50 text-green-100' :
                toast.type === 'error' ? 'bg-red-900/80 border-red-500/50 text-red-100' :
                'bg-dark-700/90 border-dark-600 text-gray-100'
              }`}
            >
              {toast.type === 'success' && <IoCheckmarkCircle className="text-green-400 w-5 h-5 flex-shrink-0" />}
              {toast.type === 'error' && <IoAlertCircle className="text-red-400 w-5 h-5 flex-shrink-0" />}
              {toast.type === 'info' && <IoInformationCircle className="text-blue-400 w-5 h-5 flex-shrink-0" />}
              <span className="text-xs font-bold leading-tight">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
