import { useState, useRef, useCallback, useEffect } from 'react'
import { Circle, MoreHorizontal, Hash, X, Plus } from 'lucide-react'
import { useSessionsContext } from './context/GlobalContext'
import DiscoveredChannels from './DiscoveredChannels'
import CreateChannel from './CreateChannel'

export default function Dashboard() {
  const [showMenu, setShowMenu] = useState(false)
  const [showDiscovered, setShowDiscovered] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const menuRef = useRef(null)

  const { connected, discoveredChannels, openChannels, addChannelTab, closeChannel } = useSessionsContext()

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showMenu])

  const handleAddTab = useCallback((chId) => {
    addChannelTab(chId)
  }, [addChannelTab])

  const handleChannelCreated = useCallback((chId, chName) => {
    addChannelTab(String(chId))
    setShowCreateChannel(false)
  }, [addChannelTab])

  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-x-1 bg-surface border-b border-border shrink-0 min-h-[32px] pt-1">
          <div className="relative" ref={menuRef}>
            <button
              className="flex items-center pl-1 pr-3 py-1.5 bg-green-400 rounded-md text-xs shrink-0 min-h-[36px]"
              title="Menu"
              onClick={() => setShowMenu(v => !v)}
            >
              <Circle
                className={`transition-colors duration-300 ${connected ? 'text-ok' : 'text-err'}`}
                size={6}
                fill="currentColor"
              />
              <MoreHorizontal size={16} className="text-dim" />
            </button>
            {showMenu && (
              <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg p-1 min-w-[200px] z-[100] shadow-lg shadow-black/40">
                <button
                  className="flex items-center gap-2.5 w-full px-3.5 py-3 bg-transparent border-none text-main text-sm rounded-lg text-left min-h-[44px]"
                  onClick={() => { setShowMenu(false); setShowDiscovered(true) }}
                >
                  <Hash size={16} className="text-dim" />
                  Discovered Channels
                  {discoveredChannels.length > 0 && (
                    <span className="ml-auto bg-accent text-white text-[11px] px-1.5 py-0.5 rounded-full font-semibold">
                      {discoveredChannels.length}
                    </span>
                  )}
                </button>
                <button
                  className="flex items-center gap-2.5 w-full px-3.5 py-3 bg-transparent border-none text-main text-sm rounded-lg text-left min-h-[44px]"
                  onClick={() => { setShowMenu(false); setShowCreateChannel(true) }}
                >
                  <Plus size={16} className="text-dim" />
                  Create Channel
                </button>
              </div>
            )}
          </div>
          {openChannels.map(chId => {
            const ch = discoveredChannels.find(c => c.id === chId)
            return (
              <div key={chId} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-hover rounded-md text-xs shrink-0 min-h-[36px]" title={ch?.name || `Channel ${chId}`}>
                <span className="text-main max-w-[100px] truncate">{ch?.name || `#${chId.slice(0, 8)}`}</span>
                <button className="bg-transparent border-none text-dim p-1 rounded min-w-[28px] min-h-[28px] flex items-center justify-center" onClick={() => closeChannel(chId)}>
                  <X size={12} />
                </button>
              </div>
            )
          })}
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        {openChannels.length === 0 ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold mb-2 text-main">WayrenPrototype</h1>
            <p className="text-sm text-dim leading-relaxed">No channels open yet.</p>
            <p className="mt-1 text-xs italic text-dim">Tap ⋯ → Discovered Channels or create channel</p>
          </div>
        ) : (
          <p className="text-dim text-sm">Tab content coming soon</p>
        )}
      </main>

      {showDiscovered && (
        <DiscoveredChannels
          channels={discoveredChannels}
          openChannels={openChannels}
          onAddTab={handleAddTab}
          onClose={() => setShowDiscovered(false)}
        />
      )}

      {showCreateChannel && (
        <CreateChannel
          onCreated={handleChannelCreated}
          onClose={() => setShowCreateChannel(false)}
        />
      )}
    </div>
  )
}
