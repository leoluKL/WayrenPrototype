import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { subscribeToNativeInternalStream, callNativeApi } from '../nativeBridge'

const SessionsContext = createContext({})

export const useSessionsContext = () => useContext(SessionsContext)

export function SessionsContextProvider({ children }) {
  const [connected, setConnected] = useState(false)
  const [savedChannels, setSavedChannels] = useState([]) // [{ id, name }] — from StreamAllChannels
  const [discoveredChannelsFromMessages, setDiscoveredChannelsFromMessages] = useState([]) // [{ id, name }] — from incoming C2 msgs
  const [openChannels, setOpenChannels] = useState([]) // [{ id, name }]
  const [chatMessagesByChannel, setChatMessagesByChannel] = useState({}) // { [channelId]: [{ from, text, timestamp, type }] }
  const [deviceName, setDeviceName] = useState('Android App')
  const savedChannelsRef = useRef(savedChannels)
  savedChannelsRef.current = savedChannels

  // Fetch device name on mount
  useEffect(() => {
    callNativeApi('getDeviceName').then(r => {
      if (r.name) setDeviceName(r.name)
    }).catch(() => {})
  }, [])

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

  // Subscribe to channel list stream (Saved Channels)
  useEffect(() => {
    const unsubscribe = subscribeToNativeInternalStream(
      'streamAllWayrenChannels',
      {},
      (data) => {
        if (data.id) {
          setSavedChannels(prev => {
            if (prev.some(ch => ch.id === data.id)) return prev
            return [...prev, { id: data.id, name: data.name }]
          })
        }
      }
    )
    return () => unsubscribe()
  }, [])

  // When savedChannels updates, backfill names in discovered channels
  useEffect(() => {
    if (savedChannels.length === 0) return
    setDiscoveredChannelsFromMessages(prev => {
      let changed = false
      const next = prev.map(ch => {
        const saved = savedChannels.find(s => s.id === ch.id)
        if (saved && ch.name !== saved.name) {
          changed = true
          return { ...ch, name: saved.name }
        }
        return ch
      })
      return changed ? next : prev
    })
  }, [savedChannels])

  /** Add a channel discovered from an incoming C2 message. */
  const extractChannelFromMsg = useCallback((chId) => {
    setDiscoveredChannelsFromMessages(prev => {
      if (prev.some(ch => ch.id === chId)) return prev
      const saved = savedChannelsRef.current.find(ch => ch.id === chId)
      const name = saved ? saved.name : `${chId.slice(0, 2)}..${chId.slice(-2)}`
      return [...prev, { id: chId, name }]
    })
  }, [])

  // Subscribe to C2 message stream — discover channels + store messages
  useEffect(() => {
    const unsubscribe = subscribeToNativeInternalStream(
      'streamAllWayrenNewMessages',
      {},
      (data) => {
        const chId = data.channel
        if (!chId) return
        extractChannelFromMsg(chId)
        // Store message if it's a chat type
        if (data.type === 'c2_chat' && data.text) {
          setChatMessagesByChannel(prev => ({
            ...prev,
            [chId]: [...(prev[chId] || []), {
              type: 'c2_chat',
              from: data.from,
              text: data.text,
              timestamp: Date.now()
            }]
          }))
        }
        // Store image messages
        if (data.type === 'c2_image' && data.data) {
          setChatMessagesByChannel(prev => ({
            ...prev,
            [chId]: [...(prev[chId] || []), {
              type: 'c2_image',
              from: data.from,
              image_id: data.image_id,
              mime: data.mime,
              data: data.data,
              timestamp: Date.now()
            }]
          }))
        }
      }
    )
    return () => unsubscribe()
  }, [extractChannelFromMsg])

  const addChannelTab = useCallback((chId, chName) => {
    setOpenChannels(prev => prev.some(ch => ch.id === chId) ? prev : [...prev, { id: chId, name:chName }])
  }, [])

  const closeChannel = useCallback((chId) => {
    setOpenChannels(prev => prev.filter(ch => ch.id !== chId))
  }, [])

  return (
    <SessionsContext.Provider value={{
      connected,
      savedChannels,
      discoveredChannelsFromMessages,
      openChannels,
      chatMessagesByChannel,
      deviceName,
      addChannelTab,
      closeChannel,
      extractChannelFromMsg
    }}>
      {children}
    </SessionsContext.Provider>
  )
}
