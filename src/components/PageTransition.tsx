import React from 'react'
import { motion } from 'framer-motion'

interface PageTransitionProps {
  children: React.ReactNode
}

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="h-full min-h-0 flex flex-col"
    >
      {children}
    </motion.div>
  )
}
