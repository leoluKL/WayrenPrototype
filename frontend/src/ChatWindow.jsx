import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Paperclip, Image, Camera } from 'lucide-react'
import { useSessionsContext } from './context/GlobalContext'
import { callNativeApi } from './nativeBridge'
import { resizeImage } from './resizeImage'

export default function ChatWindow({ channelId }) {
  const [inputText, setInputText] = useState('')
  const [showAttach, setShowAttach] = useState(false)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)
  const wasNearBottomRef = useRef(true)
  const attachRef = useRef(null)
  const { chatMessagesByChannel, deviceName } = useSessionsContext()
  const messages = chatMessagesByChannel[channelId] || []

  const sendChatText = useCallback((text) => {
    callNativeApi('sendC2Payload', {
      type: 'c2_chat',
      data: { text, from_callsign: deviceName },
      channel: channelId
    })
  }, [channelId, deviceName])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 20
  }, [])

  // Scroll on new messages only if user was near bottom before the new content
  useEffect(() => {
    if (wasNearBottomRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      })
    }
  }, [messages.length])

  // Close attach popup on click outside
  useEffect(() => {
    if (!showAttach) return
    const handleClick = (e) => {
      if (attachRef.current && !attachRef.current.contains(e.target)) {
        setShowAttach(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showAttach])

  const handleSend = () => {
    const text = inputText.trim()
    if (!text) return
    sendChatText(text)
    setInputText('')
    wasNearBottomRef.current = true
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleImagePicked = useCallback(async (file) => {
    if (!file) return
    setShowAttach(false)
    setSending(true)
    try {
      const resized = await resizeImage({ file, maxSizeKB: 50, maxH: 1024, maxW: 1024 })
      const uuid = crypto.randomUUID()

      // First send a loading placeholder text so the other side sees something immediately
      callNativeApi('sendC2Payload', {
        type: 'c2_chat',
        data: { text: 'Loading image...', uuid, from_callsign: deviceName },
        channel: channelId,
        priority: 10
      })

      // Then resize and send the actual image at low priority
      const reader = new FileReader()
      reader.readAsDataURL(resized)
      reader.onloadend = () => {
        const b64 = reader.result.split(',')[1]
        callNativeApi('sendC2Payload', {
          type: 'c2_image',
          data: {
            uuid,
            image_id: `${Date.now()}`,
            mime_type: resized.type || 'image/png',
            data: b64,
            from_callsign: deviceName
          },
          channel: channelId,
          priority: 1
        })
        setSending(false)
        wasNearBottomRef.current = true
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
        })
      }
    } catch (e) {
      console.error('Image resize failed:', e)
      setSending(false)
    }
  }, [channelId, deviceName])

  const formatTime = (ts) => {
    const d = new Date(ts)
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }

  return (
    <div className="flex flex-col size-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto pl-3 pr-4 py-1 space-y-1" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-dim text-xs italic">No messages yet.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col w-full ${msg.from === deviceName ? 'items-end' : 'items-start'}`}>
            <div className={`flex flex-col ${msg.from === deviceName ? 'bg-accent text-white rounded-br-md' : 'bg-hover text-main rounded-bl-md'} w-fit max-w-[80%] rounded-xl px-3 py-1`}>
              <div className='flex text-[10px] opacity-70 mb-0.5 justify-between'>
                <div>{msg.from}</div>
                <div className="ml-2">{formatTime(msg.timestamp)}</div>
              </div>
              {msg.type === 'c2_image' ? (
                <img
                  src={`data:${msg.mime};base64,${msg.data}`}
                  alt=""
                  className="max-w-full rounded-lg max-h-48 object-contain cursor-pointer"
                  onClick={() => window.open(`data:${msg.mime};base64,${msg.data}`, '_blank')}
                />
              ) : msg.type === 'c2_chat' && msg.uuid ? (
                <div className="break-words text-sm text-dim/60 animate-pulse">{msg.text}</div>
              ) : msg.type === 'c2_chat' ? (
                <div className="break-words text-sm">{msg.text}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5 shrink-0">
        <div className="relative" ref={attachRef}>
          <button
            className="bg-transparent border-none text-dim p-2.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
            onClick={() => setShowAttach(v => !v)}
            disabled={sending}
          >
            {sending ? (
              <span className="w-[18px] h-[18px] border-2 border-dim border-t-transparent rounded-full animate-spin" />
            ) : (
              <Paperclip size={18} />
            )}
          </button>
          {showAttach && (
            <div className="absolute bottom-full left-0 mb-1 bg-surface border border-border rounded-lg p-1 min-w-[160px] shadow-lg shadow-black/40 z-50">
              <div className="relative flex items-center gap-2.5 w-full px-3.5 py-3 text-main text-sm rounded-lg min-h-[44px]">
                <input
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImagePicked(file)
                    e.target.value = ''
                  }}
                />
                <Image size={16} className="text-dim shrink-0" />
                Photo Gallery
              </div>
              <div className="relative flex items-center gap-2.5 w-full px-3.5 py-3 text-main text-sm rounded-lg min-h-[44px]">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImagePicked(file)
                    e.target.value = ''
                  }}
                />
                <Camera size={16} className="text-dim shrink-0" />
                Camera
              </div>
            </div>
          )}
        </div>

        <input
          className="flex-1 bg-hover border-none text-main text-sm rounded-lg px-3 py-2.5 min-h-[40px] outline-none placeholder:text-dim/50"
          placeholder="Type a message..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="bg-accent border-none text-white p-2.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 disabled:opacity-40"
          onClick={handleSend}
          disabled={!inputText.trim() || sending}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}
