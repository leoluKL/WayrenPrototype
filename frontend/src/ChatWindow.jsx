import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Paperclip } from 'lucide-react'
import { useSessionsContext } from './context/GlobalContext'
import { callNativeApi } from './nativeBridge'

export default function ChatWindow({ channelId }) {
  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef(null)
  const { chatMessagesByChannel } = useSessionsContext()
  const messages = chatMessagesByChannel[channelId] || []

  const sendChatText = useCallback((text) => {
    callNativeApi('sendC2Payload', {
      type: 'c2_chat',
      data: { text, from_callsign: 'Android App' },
      channel: channelId
    })
  }, [channelId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-dim text-xs italic">No messages yet.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.from === 'Android App' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${msg.from === 'Android App' ? 'bg-accent text-white rounded-br-md' : 'bg-hover text-main rounded-bl-md'}`}>
              <div className="text-[11px] opacity-70 mb-0.5">{msg.from}</div>
              <div className="break-words">{msg.text}</div>
              <div className="text-[10px] opacity-50 text-right mt-0.5">{formatTime(msg.timestamp)}</div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
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
