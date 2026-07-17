import { useState, useRef, useCallback, useEffect } from 'react'
import { Circle, MoreHorizontal, Hash, X, Plus, MessageSquare } from 'lucide-react'
import { useSessionsContext } from './context/GlobalContext'
import ChannelsListWindow from './ChannelsListWindow'
import CreateChannel from './CreateChannel'
import ChatWindow from './ChatWindow'
import MapGis from './MapGis'
import SwitchButton from './common/SwitchButton'

export default function Dashboard() {
  const [showMenu, setShowMenu] = useState(false)
  const [showSavedChannelsWindow, setShowSavedChannelsWindow] = useState(false)
  const [showDiscoveredChannelsWindow, setShowDiscoveredChannelsWindow] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [currentTabId, setCurrentTabId] = useState(null)
  const [meOn, setMeOn] = useState(false)
  const [showShapeMenu, setShowShapeMenu] = useState(false)
  const [tacticalDrawOn, setTacticalDrawOn] = useState(false)
  const [tacticalDrawColor, setTacticalDrawColor] = useState('#FF0000')
  const [showTacticalMenu, setShowTacticalMenu] = useState(false)
  const menuRef = useRef(null)
  const shapeRef = useRef(null)

  const { connected, savedChannels, discoveredChannelsFromMessages, openChannels, gisViews, deviceName, addChannelTab, closeChannel } = useSessionsContext()

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
      if (shapeRef.current && !shapeRef.current.contains(e.target)) {
        setShowShapeMenu(false)
      }
      if (showTacticalMenu) setShowTacticalMenu(false)
    }
    if (showMenu || showShapeMenu || showTacticalMenu) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showMenu, showShapeMenu, showTacticalMenu])

  const handleTabClick = useCallback((chId) => {
    setCurrentTabId(chId)
  }, [])

  const handleAddTab = useCallback((chId, chName) => {
    addChannelTab(chId, chName)
    setCurrentTabId(chId)
    setShowDiscoveredChannelsWindow(false)
    setShowSavedChannelsWindow(false)
  }, [addChannelTab])

  const handleCloseChannel = useCallback((chId) => {
    const idx = openChannels.findIndex(ch => ch.id === chId)
    if (currentTabId === chId) {
      if (idx > 0) setCurrentTabId(openChannels[idx - 1].id)
      else if (idx == 0 && openChannels.length > 1) setCurrentTabId(openChannels[1].id)
      else setCurrentTabId(null)
    }
    closeChannel(chId)
  }, [openChannels, currentTabId, closeChannel])

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
                {(() => {
                  const available = savedChannels.filter(ch => !openChannels.some(oc => oc.id === ch.id))
                  return available.length > 0 && (
                    <span className="ml-auto bg-accent text-white text-[11px] px-1.5 py-0.5 rounded-full font-semibold">
                      {available.length}
                    </span>
                  )
                })()}
              </button>
              <button
                className="flex items-center gap-2.5 w-full px-3.5 py-3 bg-transparent border-none text-main text-sm rounded-lg text-left min-h-[44px]"
                onClick={() => { setShowMenu(false); setShowDiscoveredChannelsWindow(true) }}
              >
                Discovered Channels
                {(() => {
                  const available = discoveredChannelsFromMessages.filter(ch => !openChannels.some(oc => oc.id === ch.id))
                  return available.length > 0 && (
                    <span className="ml-auto bg-accent text-white text-[11px] px-1.5 py-0.5 rounded-full font-semibold">
                      {available.length}
                    </span>
                  )
                })()}
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
              className={`w-full h-full flex flex-col ${ch.id === currentTabId ? '' : 'hidden'}`}
            >
              {/* Chat: upper 1/3 */}
              <div className="flex-[1_1_33.333%] min-h-0 flex relative">
                <button className="absolute top-[2px] right-[2px] bg-white border-none text-dim p-1 rounded-full flex items-center justify-center" onClick={() => handleCloseChannel(ch.id)}>
                  <X size={16} />
                </button>
                <ChatWindow channelId={ch.id} />
              </div>

              {/* Toolbar + GIS: lower 2/3 */}
              <div className="flex-[2_2_66.666%] min-h-0 flex flex-col">
                {/* Toolbar row */}
                <div className="flex items-center gap-1 px-2 py-1.5 border-y border-border bg-surface shrink-0 min-h-[44px]">
                  {/* Shape button + dropdown */}
                  <div className="relative" ref={shapeRef}>
                    <button
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg min-h-[36px] bg-hover text-dim"
                      onClick={() => setShowShapeMenu(v => !v)}
                    >
                      Shape
                    </button>
                    {showShapeMenu && (
                      <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg p-1 min-w-[140px] z-[100] shadow-lg shadow-black/40">
                        {[
                          { label: 'Tank', img: 'tank.png' },
                          { label: 'Drone', img: 'drone.png' },
                          { label: 'Red Human', img: 'redhuman.png' },
                          { label: 'Blue Human', img: 'bluehuman.png' },
                        ].map(item => (
                          <button
                            key={item.label}
                            className="flex items-center gap-2.5 w-full px-3.5 py-3 bg-transparent border-none text-main text-sm rounded-lg text-left min-h-[44px] hover:bg-hover transition-colors"
                            onClick={() => {
                              gisViews[currentTabId]?.current?.placeShape(item)
                              setShowShapeMenu(false)
                            }}
                          >
                            <img src={item.img} alt={item.label} className="max-h-8" />
                            <span>{item.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Me toggle switch */}
                  <SwitchButton
                    isOn={meOn}
                    onToggle={(newVal) => {
                      const gisView = gisViews[currentTabId]?.current
                      if (newVal) {
                        gisView?.showMyLocation(deviceName)
                      } else {
                        gisView?.hideMyLocation(deviceName)
                      }
                      setMeOn(newVal)
                    }}
                    onText="Show Me"
                    offText="Hide Me"
                    width="w-[95px]"
                  />
                  <button
                    className="flex items-center gap-1.5 bg-hover border-none text-dim text-xs px-3 py-2 rounded-lg min-h-[36px] transition-colors duration-1000"
                    onClick={(e) => {
                      const gisView = gisViews[currentTabId]?.current
                      gisView?.syncMapBoundary()
                      const el = e.currentTarget
                      el.style.backgroundColor = '#16a34a'
                      el.style.color = 'white'
                      setTimeout(() => {
                        el.style.backgroundColor = ''
                        el.style.color = ''
                      }, 1000)
                    }}
                  >
                    Sync Boundary
                  </button>
                  <div className="relative">
                    <button
                      className={`flex items-center gap-1.5 border-none text-xs px-3 py-2 rounded-lg min-h-[36px] transition-all duration-150 ${tacticalDrawOn ? 'bg-green-700 text-white shadow-[inset_0_2px_6px_rgba(0,0,0,0.35)] translate-y-[1px]' : 'bg-hover text-dim shadow-sm'}`}
                      onClick={() => {
                        if (tacticalDrawOn) {
                          setTacticalDrawOn(false)
                        } else {
                          setShowTacticalMenu(v => !v)
                        }
                      }}
                    >
                      {tacticalDrawOn && (
                        <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: tacticalDrawColor }} />
                      )}
                      Tactical Draw
                    </button>
                    {showTacticalMenu && (
                      <div className="absolute top-full mt-1 bg-surface border border-border rounded-lg p-1 min-w-[160px] z-[100] shadow-lg shadow-black/40" style={{ right: -8 }} onMouseDown={(e) => e.stopPropagation()}>
                        {[
                          { label: 'Red Line', color: '#FF0000' },
                          { label: 'Blue Line', color: '#0000FF' },
                        ].map(item => (
                          <button
                            key={item.label}
                            className="flex items-center gap-2.5 w-full px-3.5 py-3 bg-transparent border-none text-main text-sm rounded-lg text-left min-h-[44px] hover:bg-hover transition-colors"
                            onClick={() => {
                              setTacticalDrawColor(item.color)
                              setTacticalDrawOn(true)
                              setShowTacticalMenu(false)
                            }}
                          >
                            <span className="inline-block w-4 h-4 rounded-full" style={{ background: item.color }} />
                            <span>{item.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* GIS / Map */}
                <div className="flex-1 min-h-0 relative">
                  <MapGis channelId={ch.id} tacticalDrawOn={tacticalDrawOn} tacticalDrawColor={tacticalDrawColor} onTacticalDrawEnd={() => setTacticalDrawOn(false)} />
                </div>
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
          excludeArr={[...openChannels]}
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
