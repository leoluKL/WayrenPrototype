import { X, Plus } from 'lucide-react'

export default function ChannelsListWindow({
  channels,
  excludeArr,
  onAddTab,
  onClose,
  title
}) {
  const available = channels.filter(ch => !excludeArr.some(oc => oc.id === ch.id))

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-transparent z-[200] flex items-end justify-center" onClick={handleOverlayClick}>
      <div className="w-full max-h-[70vh] bg-surface rounded-t-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 pb-3 pt-4 border-b border-border shrink-0 min-h-[52px]">
          <h2 className="text-lg font-semibold text-main">{title}</h2>
          <button className="bg-transparent border-none text-dim p-2.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto py-2">
          {available.length === 0 ? (
            <p className="text-center py-8 px-4 text-dim text-sm">No channels discovered yet.</p>
          ) : (
            [...available].reverse().map(ch => (
              <div key={ch.id} className="flex items-center justify-between px-4 py-3.5 border-b border-border last:border-none min-h-[56px]">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[15px] font-medium text-main">{ch.name}</span>
                  <span className="text-xs text-dim font-mono truncate">ID: {ch.id}</span>
                </div>
                <div className="flex items-center">
                  <button className="bg-accent border-none text-white p-2.5 rounded-lg flex items-center justify-center min-w-[44px] min-h-[44px]" onClick={() => onAddTab(ch.id, ch.name)}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
