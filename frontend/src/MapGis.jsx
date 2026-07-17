import { useEffect, useRef, useState, useImperativeHandle } from 'react'
import { RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { callNativeApi } from './nativeBridge'
import { useSessionsContext } from './context/GlobalContext'

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

export default function MapGis({ channelId }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const gisViewRef = useRef(null)
  const myLocationWatchIdRef = useRef(null)
  const myLocationMarkerRef = useRef(null)
  const [objects, setObjects] = useState([])
  const [selectedObjectId, setSelectedObjectId] = useState(null)
  const [actionBarPos, setActionBarPos] = useState({ x: 0, y: 0 })

  const { registerGisView, unregisterGisView } = useSessionsContext()

  // Register our own internal ref on mount, unregister on unmount
  useEffect(() => {
    registerGisView(channelId, gisViewRef)
    return () => unregisterGisView(channelId)
  }, [channelId])

  async function sendGisUpdate(objectId, name, lng, lat, course, icon) {
    await callNativeApi('sendC2Payload', {
      type: 'c2_gis_object',
      channel: channelId,
      priority: 10,
      data: {
        object_id: objectId,
        name,
        action: 'OBJECT_UPDATE',
        shape: 'SHAPE_ICON',
        points: [{ lat, lng }],
        course,
        icon
      }
    })
  }

  async function sendGisDelete(objectId, name) {
    await callNativeApi('sendC2Payload', {
      type: 'c2_gis_object',
      channel: channelId,
      priority: 10,
      data: {
        object_id: objectId,
        name,
        action: 'OBJECT_DELETE',
        shape: 'SHAPE_ICON',
        points: []
      }
    })
  }

  useImperativeHandle(gisViewRef, () => ({
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
      sendGisUpdate(newObj.id, newObj.label, newObj.lng, newObj.lat, newObj.rotation, newObj.img)
    },
    handleGisEvent(event) {
      const map = mapRef.current
      if (!map) return

      if (event.action === 'OBJECT_DELETE') {
        const marker = markersRef.current[event.object_id]
        if (marker) {
          marker.remove()
          delete markersRef.current[event.object_id]
          setObjects(prev => prev.filter(o => o.id !== event.object_id))
        }
      } else if (event.action === 'OBJECT_UPDATE' && event.object_id) {
        const existingMarker = markersRef.current[event.object_id]
        if (existingMarker) {
          existingMarker.setLngLat([event.lng, event.lat])
          const imgEl = existingMarker.getElement().querySelector('img')
          if (imgEl) imgEl.style.transform = `rotate(${event.course}deg)`
          setObjects(prev => prev.map(o =>
            o.id === event.object_id
              ? { ...o, lng: event.lng, lat: event.lat, rotation: event.course }
              : o
          ))
        } else if (event.icon) {
          const newObj = {
            id: event.object_id,
            label: event.name,
            img: event.icon,
            lng: event.lng,
            lat: event.lat,
            rotation: event.course
          }
          setObjects(prev => [...prev, newObj])
          createMarker(newObj, map)
        }
      }
    },
    showMyLocation(callsign) {
      // Clean up previous
      if (myLocationWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(myLocationWatchIdRef.current)
        myLocationWatchIdRef.current = null
      }
      if (myLocationMarkerRef.current) {
        myLocationMarkerRef.current.remove()
        myLocationMarkerRef.current = null
      }

      const map = mapRef.current
      if (!map) return

      myLocationWatchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, heading } = pos.coords
          const hasHeading = heading != null && !isNaN(heading)

          if (myLocationMarkerRef.current) {
            myLocationMarkerRef.current.setLngLat([longitude, latitude])
            const arrow = myLocationMarkerRef.current.getElement().querySelector('.my-loc-arrow')
            if (arrow) {
              arrow.style.display = 'block'
              arrow.style.transform = `translateX(-50%) rotate(${hasHeading ? heading : 0}deg)`
            }
          } else {
            // First fix — pan to location and zoom in
            map.flyTo({ center: [longitude, latitude], zoom: 14, duration: 1000 })

            const el = document.createElement('div')
            el.className = 'my-location-marker'
            el.style.cssText = 'position: relative; width: 60px; height: 70px; cursor: default; pointer-events: none;'

            const arrow = document.createElement('div')
            arrow.className = 'my-loc-arrow'
            arrow.style.cssText = `
              position: absolute; top: 0; left: 50%; z-index: 1;
              width: 0; height: 0;
              border-left: 6px solid transparent;
              border-right: 6px solid transparent;
              border-bottom: 12px solid #3b82f6;
            `
            arrow.style.display = 'block'
            arrow.style.transform = `translateX(-50%) rotate(${hasHeading ? heading : 0}deg)`
            el.appendChild(arrow)

            const circle = document.createElement('div')
            circle.style.cssText = `
              position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
              width: 48px; height: 48px; border-radius: 50%;
              background: #3b82f6; color: white;
              display: flex; align-items: center; justify-content: center;
              font-size: 10px; font-weight: bold; text-align: center;
              border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            `
            circle.textContent = callsign
            el.appendChild(circle)

            myLocationMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat([longitude, latitude])
              .addTo(map)
          }
        },
        (err) => {
          console.warn('GPS error:', err.message)
        },
        // maximumAge=1 hour: reuses cached position so Show Me works immediately even offline
        { enableHighAccuracy: false, maximumAge: 3600000 }
      )
    },
    hideMyLocation() {
      if (myLocationWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(myLocationWatchIdRef.current)
        myLocationWatchIdRef.current = null
      }
      if (myLocationMarkerRef.current) {
        myLocationMarkerRef.current.remove()
        myLocationMarkerRef.current = null
      }
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

    map.addControl(new maplibregl.NavigationControl({ showZoom: false }), 'top-right')
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
      setObjects(prev => {
        const updated = prev.map(o =>
          o.id === obj.id ? { ...o, lng: lngLat.lng, lat: lngLat.lat } : o
        )
        const current = updated.find(o => o.id === obj.id)
        if (current) {
          sendGisUpdate(current.id, current.label, current.lng, current.lat, current.rotation, current.img)
        }
        return updated
      })
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
        sendGisUpdate(o.id, o.label, o.lng, o.lat, newRotation, o.img)
        return { ...o, rotation: newRotation }
      })
    )
  }

  function handleDelete(objectId) {
    const obj = objects.find(o => o.id === objectId)
    if (obj) sendGisDelete(obj.id, obj.label)
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
}
