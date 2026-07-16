import { useState, useRef, useCallback, useEffect } from 'react'
import { Circle, MoreHorizontal, Hash, X, Plus } from 'lucide-react'
import { useSessionsContext } from './context/GlobalContext'
import ChannelsListWindow from './ChannelsListWindow'
import CreateChannel from './CreateChannel'

export default function Dashboard() {
  const [showMenu, setShowMenu] = useState(false)
  const [showSavedChannelsWindow, setShowSavedChannelsWindow] = useState(false)
  const [showDiscoveredChannelsWindow, setShowDiscoveredChannelsWindow] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [currentTabId, setCurrentTabId] = useState(null)
  const menuRef = useRef(null)

  const { connected, savedChannels, discoveredChannelsFromMessages, openChannels, addChannelTab, closeChannel } = useSessionsContext()

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

  const handleTabClick = useCallback((chId) => {
    setCurrentTabId(chId)
  }, [])

  const handleAddTab = useCallback((chId, chName) => {
    addChannelTab(chId, chName)
    setCurrentTabId(chId)
  }, [addChannelTab])


  return (
    <div className="w-full h-full flex flex-col">
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
                onClick={() => { setShowMenu(false); setShowSavedChannelsWindow(true) }}
              >
                Saved Channels
                {savedChannels.length > 0 && (
                  <span className="ml-auto bg-accent text-white text-[11px] px-1.5 py-0.5 rounded-full font-semibold">
                    {savedChannels.length}
                  </span>
                )}
              </button>
              <button
                className="flex items-center gap-2.5 w-full px-3.5 py-3 bg-transparent border-none text-main text-sm rounded-lg text-left min-h-[44px]"
                onClick={() => { setShowMenu(false); setShowDiscoveredChannelsWindow(true) }}
              >
                Discovered Channels
                {discoveredChannelsFromMessages.length > 0 && (
                  <span className="ml-auto bg-accent text-white text-[11px] px-1.5 py-0.5 rounded-full font-semibold">
                    {discoveredChannelsFromMessages.length}
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
        {openChannels.map(ch => (
          <div
            key={ch.id}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs shrink-0 min-h-[36px] cursor-pointer ${ch.id === currentTabId ? 'bg-accent text-white' : 'bg-hover text-main'}`}
            title={ch.name}
            onClick={() => handleTabClick(ch.id)}
          >
            <span className="max-w-[100px] truncate">{ch.name}</span>
          </div>
        ))}
      </header>

      <main className="flex-1">
        {openChannels.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h1 className="text-xl font-semibold mb-2 text-main">WayrenPrototype</h1>
              <p className="text-sm text-dim leading-relaxed">No channels open yet.</p>
              <p className="mt-1 text-xs italic text-dim">Tap ⋯ to choose channel</p>
            </div>
          </div>
        ) : (
          openChannels.map(ch => (
            <div
              key={ch.id}
              className={`w-full h-full ${ch.id === currentTabId ? '' : 'hidden'}`}
            >
              <div className="relative p-4 h-full">
                <button className="absolute top-2 right-2 bg-transparent border-none text-dim p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center" onClick={() => closeChannel(ch.id)}>
                  <X size={18} />
                </button>
                <div className="text-main text-sm">{ch.name}</div>
              </div>
            </div>
          ))
        )}
      </main>

      {showSavedChannelsWindow && (
        <ChannelsListWindow
          title="Saved Channels"
          channels={savedChannels}
          excludeArr={[...openChannels]}
          onAddTab={handleAddTab}
          onClose={() => setShowSavedChannelsWindow(false)}
        />
      )}

      {showDiscoveredChannelsWindow && (
        <ChannelsListWindow
          title="Discovered Channels"
          channels={discoveredChannelsFromMessages}
          excludeArr={[...openChannels,...savedChannels]}
          onAddTab={handleAddTab}
          onClose={() => setShowDiscoveredChannelsWindow(false)}
        />
      )}

      {showCreateChannel && (
        <CreateChannel
          onCreated={(chId, chName) => {
            addChannelTab(String(chId), chName)
            setShowCreateChannel(false)
          }}
          onClose={() => setShowCreateChannel(false)}
        />
      )}
    </div>
  )
}
