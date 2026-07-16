import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Paperclip } from 'lucide-react'
import { useSessionsContext } from './context/GlobalContext'
import { callNativeApi } from './nativeBridge'

export default function ChatWindow({ channelId }) {
  const [inputText, setInputText] = useState('')
  const scrollRef = useRef(null)
  const wasNearBottomRef = useRef(true)
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

  const handleSend = () => {
    const text = inputText.trim()
    if (!text) return
    sendChatText(text)
    setInputText('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

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
              <div className="break-words text-sm">{msg.text}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5 shrink-0">
        <button className="bg-transparent border-none text-dim p-2.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0">
          <Paperclip size={18} />
        </button>
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
          disabled={!inputText.trim()}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}
