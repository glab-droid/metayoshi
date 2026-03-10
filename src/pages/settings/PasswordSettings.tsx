import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { useWalletStore } from '../../store/walletStore'

const PasswordSettings: React.FC = () => {
  const [currentPass, setCurrentPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  const navigate = useNavigate()
  const { changePassword } = useWalletStore()

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (newPass !== confirmPass) {
      setError('Passwords do not match')
      return
    }

    const ok = changePassword(currentPass, newPass)
    if (ok) {
      setSuccess('Password updated successfully')
      setCurrentPass('')
      setNewPass('')
      setConfirmPass('')
      setTimeout(() => navigate('/settings'), 1500)
    } else {
      setError('Invalid current password')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="p-4 bg-dark-900 border-b border-dark-600 text-center">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-200 leading-tight">Wallet Account Settings - Change wallet password</h2>
      </header>

      <form onSubmit={handleUpdate} className="flex-1 p-6 space-y-6">
        <div className="space-y-4">
          <Input 
            type="password"
            label="Type current password"
            placeholder="********"
            value={currentPass}
            onChange={(e) => setCurrentPass(e.target.value)}
            className="bg-dark-700/50 border-dark-600"
          />
          <Input 
            type="password"
            label="Type new password"
            placeholder="********"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            className="bg-dark-700/50 border-dark-600"
          />
          <Input 
            type="password"
            label="Type again new password"
            placeholder="********"
            value={confirmPass}
            onChange={(e) => setConfirmPass(e.target.value)}
            className="bg-dark-700/50 border-dark-600"
          />
        </div>

        {error && <p className="text-xs text-red-500 text-center font-bold">{error}</p>}
        {success && <p className="text-xs text-green-500 text-center font-bold">{success}</p>}

        <div className="flex justify-center mt-8">
          <Button 
            type="submit"
            className="w-full btn-primary"
          >
            Confirm
          </Button>
        </div>
      </form>
    </div>
  )
}

export default PasswordSettings
