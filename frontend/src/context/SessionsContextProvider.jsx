import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { subscribeToNativeInternalStream, callNativeApi } from '../nativeBridge'

const SessionsContext = createContext({})

export const useSessionsContext = () => useContext(SessionsContext)

export function SessionsContextProvider({ children }) {
  const [connected, setConnected] = useState(false)
  const [discoveredChannels, setDiscoveredChannels] = useState([]) // [{ id, name }]
  const [openChannels, setOpenChannels] = useState([]) // channel IDs as strings

  // Poll connection status
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const result = await callNativeApi('getgRPCConnectionStatus')
        setConnected(result.status === 'connected')
      } catch (e) {
        setConnected(false)
      }
    }
    checkConnection()
    const interval = setInterval(checkConnection, 3000)
    return () => clearInterval(interval)
  }, [])

  // Subscribe to channel list stream
  useEffect(() => {
    const unsubscribe = subscribeToNativeInternalStream(
      'streamAllWayrenChannels',
      {},
      (data) => {
        if (data.id) {
          setDiscoveredChannels(prev => {
            if (prev.some(ch => ch.id === data.id)) return prev
            return [...prev, { id: data.id, name: data.name }]
          })
        }
      }
    )
    return () => unsubscribe()
  }, [])

  const addChannelTab = useCallback((chId) => {
    setOpenChannels(prev => prev.includes(chId) ? prev : [...prev, chId])
  }, [])

  const closeChannel = useCallback((chId) => {
    setOpenChannels(prev => prev.filter(id => id !== chId))
  }, [])

  return (
    <SessionsContext.Provider value={{
      connected,
      discoveredChannels,
      openChannels,
      addChannelTab,
      closeChannel
    }}>
      {children}
    </SessionsContext.Provider>
  )
}
