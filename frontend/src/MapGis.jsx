import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Light Google Maps–style theme for OpenMapTiles schema
function buildStyle() {
  return {
    version: 8,
    name: 'Standard',
    center: [103.8198, 1.3521],
    zoom: 11,
    sources: {
      osm: {
        type: 'vector',
        tiles: ['https://appassets.androidplatform.net/tiles/{z}/{x}/{y}.pbf'],
        minzoom: 0,
        maxzoom: 14,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f8f8f8' } },
      { id: 'landuse', source: 'osm', 'source-layer': 'landuse', type: 'fill', paint: { 'fill-color': '#e8e8e0' } },
      { id: 'landcover', source: 'osm', 'source-layer': 'landcover', type: 'fill', paint: { 'fill-color': '#e4e8d8' } },
      { id: 'park', source: 'osm', 'source-layer': 'park', type: 'fill', paint: { 'fill-color': '#c8e6c9' } },
      { id: 'water', source: 'osm', 'source-layer': 'water', type: 'fill', paint: { 'fill-color': '#b3d4f7' } },
      { id: 'building', source: 'osm', 'source-layer': 'building', type: 'fill',
        paint: { 'fill-color': '#d4d4d4', 'fill-outline-color': '#b8b8b8' } },

      // Minor roads — casing (outline) and fill
      { id: 'road-street-casing', source: 'osm', 'source-layer': 'transportation', type: 'line',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'street', 'tertiary', 'secondary', 'primary']]],
        paint: { 'line-color': '#e0e0e0', 'line-width': 3 } },
      { id: 'road-street', source: 'osm', 'source-layer': 'transportation', type: 'line',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'street']]],
        paint: { 'line-color': '#ffffff', 'line-width': 1.5 } },
      { id: 'road-tertiary', source: 'osm', 'source-layer': 'transportation', type: 'line',
        filter: ['==', ['get', 'class'], 'tertiary'],
        paint: { 'line-color': '#ffffff', 'line-width': 2 } },

      // Major roads
      { id: 'road-secondary', source: 'osm', 'source-layer': 'transportation', type: 'line',
        filter: ['==', ['get', 'class'], 'secondary'],
        paint: { 'line-color': '#f5da7a', 'line-width': 2.5 } },
      { id: 'road-primary', source: 'osm', 'source-layer': 'transportation', type: 'line',
        filter: ['==', ['get', 'class'], 'primary'],
        paint: { 'line-color': '#f5da7a', 'line-width': 3 } },

      // Motorway casing + fill
      { id: 'road-motorway-casing', source: 'osm', 'source-layer': 'transportation', type: 'line',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        paint: { 'line-color': '#d49a3a', 'line-width': 5 } },
      { id: 'road-motorway', source: 'osm', 'source-layer': 'transportation', type: 'line',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        paint: { 'line-color': '#f7ba48', 'line-width': 3 } },
    ]
  }
}

const MapGis = forwardRef(function MapGis(_props, ref) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const [objects, setObjects] = useState([])
  const [selectedObjectId, setSelectedObjectId] = useState(null)
  const [actionBarPos, setActionBarPos] = useState({ x: 0, y: 0 })

  useImperativeHandle(ref, () => ({
    placeShape(shape) {
      const map = mapRef.current
      if (!map) return

      const center = map.getCenter()
      const id = crypto.randomUUID()

      const newObj = {
        id,
        label: shape.label,
        img: shape.img,
        lng: center.lng,
        lat: center.lat,
        rotation: 0
      }

      setObjects(prev => [...prev, newObj])
      createMarker(newObj, map)
    }
  }), [])

  // Create map on mount
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center: [103.8198, 1.3521],
      zoom: 11,
      attributionControl: false,
      fadeDuration: 0
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    return () => {
      Object.values(markersRef.current).forEach(m => m.remove())
      markersRef.current = {}
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Create a MapLibre Marker for a placed object
  function createMarker(obj, map) {
    const el = document.createElement('div')
    el.className = 'gis-marker'
    el.dataset.objectId = obj.id
    el.style.cssText = 'cursor: grab; padding: 10px;'

    const img = document.createElement('img')
    img.src = obj.img
    img.className = 'marker-icon'
    img.draggable = false
    img.style.cssText = 'max-width: 50px; max-height: 50px; width: auto; height: auto; cursor: grab; display: block; pointer-events: none; transition: transform 0.15s ease;'
    img.style.transform = `rotate(${obj.rotation}deg)`
    el.appendChild(img)

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([obj.lng, obj.lat])
      .setDraggable(true)
      .addTo(map)

    marker.on('dragend', () => {
      const lngLat = marker.getLngLat()
      setObjects(prev => prev.map(o =>
        o.id === obj.id ? { ...o, lng: lngLat.lng, lat: lngLat.lat } : o
      ))
    })

    el.addEventListener('click', (e) => {
      e.stopPropagation()
      setSelectedObjectId(obj.id)
    })

    markersRef.current[obj.id] = marker
  }

  // Update action bar screen position when selected object or map changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedObjectId) return

    const updatePos = () => {
      const obj = objects.find(o => o.id === selectedObjectId)
      if (!obj) return
      const point = map.project([obj.lng, obj.lat])
      setActionBarPos({ x: point.x, y: point.y })
    }

    updatePos()
    map.on('move', updatePos)
    map.on('zoom', updatePos)
    return () => {
      map.off('move', updatePos)
      map.off('zoom', updatePos)
    }
  }, [selectedObjectId, objects])

  // Click outside a marker or action bar to deselect
  useEffect(() => {
    if (!selectedObjectId) return
    const handleClick = (e) => {
      if (!e.target.closest('.gis-marker') && !e.target.closest('.marker-action-bar')) {
        setSelectedObjectId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [selectedObjectId])

  // Clean up markers for objects removed from state
  useEffect(() => {
    const currentIds = new Set(objects.map(o => o.id))
    Object.keys(markersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove()
        delete markersRef.current[id]
      }
    })
  }, [objects])

  function handleRotate(objectId, direction) {
    setObjects(prev =>
      prev.map(o => {
        if (o.id !== objectId) return o
        const newRotation = direction === 'left' ? o.rotation - 15 : o.rotation + 15
        const marker = markersRef.current[objectId]
        if (marker) {
          const imgEl = marker.getElement().querySelector('img')
          if (imgEl) imgEl.style.transform = `rotate(${newRotation}deg)`
        }
        return { ...o, rotation: newRotation }
      })
    )
  }

  function handleDelete(objectId) {
    const marker = markersRef.current[objectId]
    if (marker) {
      marker.remove()
      delete markersRef.current[objectId]
    }
    setObjects(prev => prev.filter(o => o.id !== objectId))
    setSelectedObjectId(null)
  }

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full" />

      {/* Floating action bar for selected object */}
      {selectedObjectId && (
        <div
          className="marker-action-bar absolute z-[200] flex items-center gap-1.5 bg-surface border border-border rounded-lg px-3 py-1.5 shadow-lg shadow-black/40 pointer-events-auto"
          style={{
            left: actionBarPos.x,
            top: actionBarPos.y - 70,
            transform: 'translateX(-50%)'
          }}
        >
          <button
            className="flex items-center justify-center w-12 h-12 bg-hover border-none text-main rounded-lg cursor-pointer hover:bg-accent hover:text-white transition-colors"
            onClick={() => handleRotate(selectedObjectId, 'left')}
            title="Rotate left 15\u00b0"
          >
            <RotateCcw size={22} />
          </button>
          <button
            className="flex items-center justify-center w-12 h-12 bg-hover border-none text-main rounded-lg cursor-pointer hover:bg-accent hover:text-white transition-colors"
            onClick={() => handleRotate(selectedObjectId, 'right')}
            title="Rotate right 15\u00b0"
          >
            <RotateCw size={22} />
          </button>
          <button
            className="flex items-center justify-center w-12 h-12 border-none rounded-lg cursor-pointer ml-1 transition-colors"
            style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}
            onClick={() => handleDelete(selectedObjectId)}
            title="Delete"
          >
            <Trash2 size={22} />
          </button>
        </div>
      )}
    </div>
  )
})

export default MapGis
