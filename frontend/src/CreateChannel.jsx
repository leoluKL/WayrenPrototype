import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { callNativeApi } from './nativeBridge'

export default function CreateChannel({
  onCreated,
  onClose
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    try {
      const result = await callNativeApi('createWayrenChannel', { name: trimmed })
      if (result.status === 'ok') {
        onCreated(result.id, result.name)
      } else {
        setError(result.message || 'Failed to create channel')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !loading) {
      handleCreate()
    }
  }

  return (
    <div className="fixed inset-0 bg-transparent z-[200] flex items-end justify-center" onClick={handleOverlayClick}>
      <div className="w-full max-h-[70vh] bg-surface rounded-t-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 pb-3 pt-4 border-b border-border shrink-0 min-h-[52px]">
          <h2 className="text-lg font-semibold text-main">Create Channel</h2>
          <button className="bg-transparent border-none text-dim p-2.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <label className="block text-xs text-dim mb-2">Channel Name</label>
          <input
            className="w-full px-3.5 py-3 bg-base border border-border rounded-lg text-main text-base outline-none focus:border-accent disabled:opacity-50 min-h-[44px]"
            type="text"
            placeholder="e.g. OP-ALPHA"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            disabled={loading}
          />
          {error && <p className="mt-2.5 text-xs text-err">{error}</p>}
          <button
            className="flex items-center justify-center gap-2 w-full mt-4 p-3 bg-accent border-none text-white text-sm font-medium rounded-lg disabled:opacity-40 min-h-[44px]"
            onClick={handleCreate}
            disabled={loading || !name.trim()}
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
