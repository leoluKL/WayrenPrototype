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

export default function MapGis({ channelId, tacticalDrawOn, tacticalDrawColor, onTacticalDrawEnd }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const objectMarkersRef = useRef({})
  const peopleMarkersRef = useRef({})
  const gisViewRef = useRef(null)
  const myLocationWatchIdRef = useRef(null)
  const [objects, setObjects] = useState([])
  const [selectedObjectId, setSelectedObjectId] = useState(null)
  const [actionBarPos, setActionBarPos] = useState({ x: 0, y: 0 })
  const [selectedDrawFeatureId, setSelectedDrawFeatureId] = useState(null)
  const [drawActionBarPos, setDrawActionBarPos] = useState({ x: 0, y: 0 })
  const tacticalDrawOnRef = useRef(tacticalDrawOn)
  useEffect(() => { tacticalDrawOnRef.current = tacticalDrawOn }, [tacticalDrawOn])
  const geoLocationTacticalDrawMenu = useRef(null)

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

  async function sendGisDelete(objectId, name, icon) {
    await callNativeApi('sendC2Payload', {
      type: 'c2_gis_object',
      channel: channelId,
      priority: 10,
      data: {
        object_id: objectId,
        name,
        icon,
        action: 'OBJECT_DELETE',
        shape: 'SHAPE_ICON',
        points: []
      }
    })
  }

  async function sendTacticalDrawC2(feature) {
    const coords = feature.geometry.coordinates // [lng, lat, dtFromPrev][]
    const flat = []
    for (const c of coords) {
      flat.push(c[0], c[1], c[2] || 0)
    }
    await callNativeApi('sendC2Payload', {
      type: 'c2_tactical_draw',
      channel: channelId,
      priority: 10,
      data: {
        draw_id: feature.properties.id,
        name: '',
        stroke_width: 2,
        stroke_color: feature.properties.strokeColor,
        points: flat
      }
    })
  }

  async function sendTacticalDrawDelete(drawId) {
    await callNativeApi('sendC2Payload', {
      type: 'c2_tactical_draw',
      channel: channelId,
      priority: 10,
      data: {
        draw_id: drawId,
        name: '',
        stroke_width: 2,
        stroke_color: '',
        remove: true,
        points: []
      }
    })
  }

  function createPeopleLocationMarker(obj, map) {
    const el = document.createElement('div')
    el.className = 'people-location-marker'
    el.style.cssText = 'position: relative; width: 60px; height: 70px; cursor: default; pointer-events: none;'

    const arrow = document.createElement('div')
    arrow.className = 'people-location-arrow'
    arrow.style.cssText = `
      position: absolute; top: 0; left: 50%; z-index: 1;
      width: 0; height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 12px solid #3b82f6;
    `
    arrow.style.display = 'block'
    arrow.style.transform = `translateX(-50%) rotate(${obj.rotation}deg)`
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
    circle.textContent = obj.label
    el.appendChild(circle)

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([obj.lng, obj.lat])
      .addTo(map)

    peopleMarkersRef.current[obj.id] = marker
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
        const ref = event.icon === 'people_location' ? peopleMarkersRef : objectMarkersRef
        const marker = ref.current[event.object_id]
        if (marker) {
          marker.remove()
          delete ref.current[event.object_id]
          if (ref === objectMarkersRef) {
            setObjects(prev => prev.filter(o => o.id !== event.object_id))
          }
        }
      } else if (event.action === 'OBJECT_UPDATE' && event.object_id) {
        const ref = event.icon === 'people_location' ? peopleMarkersRef : objectMarkersRef
        const existingMarker = ref.current[event.object_id]
        if (existingMarker) {
          existingMarker.setLngLat([event.lng, event.lat])
          if (event.icon === 'people_location') {
            const arrowEl = existingMarker.getElement().querySelector('.people-location-arrow')
            if (arrowEl) arrowEl.style.transform = `translateX(-50%) rotate(${event.course}deg)`
          } else {
            const imgEl = existingMarker.getElement().querySelector('img')
            if (imgEl) imgEl.style.transform = `rotate(${event.course}deg)`
            setObjects(prev => prev.map(o =>
              o.id === event.object_id
                ? { ...o, lng: event.lng, lat: event.lat, rotation: event.course }
                : o
            ))
          }
        } else if (event.icon === 'people_location') {
          const newObj = {
            id: event.object_id,
            label: event.name,
            lng: event.lng,
            lat: event.lat,
            rotation: event.course
          }
          createPeopleLocationMarker(newObj, map)
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

      const map = mapRef.current
      if (!map) return

      const objectId = `people_location_${callsign}`
      let firstFix = true

      myLocationWatchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, heading } = pos.coords
          const course = heading != null && !isNaN(heading) ? heading : 0

          // Send C2 so all devices see this device's location
          sendGisUpdate(objectId, callsign, longitude, latitude, course, 'people_location')

          if (firstFix) {
            firstFix = false
            map.flyTo({ center: [longitude, latitude], zoom: 14, duration: 1000 })
          }
        },
        (err) => {
          console.warn('GPS error:', err.message)
        },
        { enableHighAccuracy: false, maximumAge: 3600000 }
      )
    },
    hideMyLocation(callsign) {
      if (myLocationWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(myLocationWatchIdRef.current)
        myLocationWatchIdRef.current = null
      }
      if (callsign) {
        sendGisDelete(`people_location_${callsign}`, '', 'people_location')
      }
    },
    syncMapBoundary() {
      const map = mapRef.current
      if (!map) return
      const center = map.getCenter()
      const zoom = map.getZoom()
      callNativeApi('sendC2Payload', {
        type: 'c2_sync_map_boundary',
        channel: channelId,
        priority: 10,
        data: {
          center_lat: center.lat,
          center_lng: center.lng,
          zoom
        }
      })
    },
    handleSyncMapBoundary(data) {
      const map = mapRef.current
      if (!map) return
      map.flyTo({ center: [data.center_lng, data.center_lat], zoom: data.zoom, duration: 1000 })
    },
    handleTacticalDraw(data) {
      const flat = data.points || []
      const featureId = data.draw_id
      // remove=true → delete the feature
      if (data.remove) {
        if (!featureId) return
        const idx = drawFeaturesRef.current.findIndex(f => f.properties?.id === featureId)
        if (idx === -1) return
        drawFeaturesRef.current.splice(idx, 1)
        updateDrawSource()
        return
      }
      const strokeColor = data.stroke_color || '#FF0000'
      const feature = {
        type: 'Feature',
        properties: { id: featureId, strokeColor },
        geometry: { type: 'LineString', coordinates: [] }
      }
      drawFeaturesRef.current.push(feature)
      let idx = 0
      const n = flat.length
      const scheduleNext = () => {
        if (idx >= n) return
        const lng = flat[idx]
        const lat = flat[idx + 1]
        const dt = flat[idx + 2] || 0
        feature.geometry.coordinates.push([lng, lat, dt])
        updateDrawSource()
        idx += 3
        if (idx < n) {
          setTimeout(scheduleNext, Math.max(dt, 0))
        }
      }
      scheduleNext()
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

    // Tactical draw source + layer (added once on mount)
    map.on('load', () => {
      try {
        map.addSource('tactical-draw', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        })
        map.addLayer({
          id: 'tactical-draw-line',
          type: 'line',
          source: 'tactical-draw',
          paint: {
            'line-color': ['get', 'strokeColor'],
            'line-width': 2
          }
        })

        // Click on map → detect draw line hit (with 20px tolerance) or deselect
        // (skip when tactical draw is active — user intends to draw, not select)
        map.on('click', (e) => {
          if (tacticalDrawOnRef.current) return
          const bbox = [
            [e.point.x - 20, e.point.y - 20],
            [e.point.x + 20, e.point.y + 20]
          ]
          const features = map.queryRenderedFeatures(bbox, { layers: ['tactical-draw-line'] })
          if (features.length > 0) {
            const featureId = features[0].properties?.id
            if (!featureId) return
            geoLocationTacticalDrawMenu.current = [e.lngLat.lng, e.lngLat.lat]
            setSelectedObjectId(null)
            setSelectedDrawFeatureId(featureId)
            setDrawActionBarPos({ x: e.point.x, y: e.point.y })
          } else {
            setSelectedDrawFeatureId(null)
            geoLocationTacticalDrawMenu.current = null
          }
        })
      } catch (e) { /* already exists */ }
    })

    return () => {
      // Clean up all markers on unmount
      Object.values(objectMarkersRef.current).forEach(m => m.remove())
      objectMarkersRef.current = {}
      Object.values(peopleMarkersRef.current).forEach(m => m.remove())
      peopleMarkersRef.current = {}
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Create a MapLibre Marker for a placed object (shape icons)
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

    objectMarkersRef.current[obj.id] = marker
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

  // Update draw line action bar position when map moves
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedDrawFeatureId) return

    const updatePos = () => {
      const clickLngLat = geoLocationTacticalDrawMenu.current
      if (!clickLngLat) return
      const point = map.project(clickLngLat)
      setDrawActionBarPos({ x: point.x, y: point.y })
    }

    updatePos()
    map.on('move', updatePos)
    map.on('zoom', updatePos)
    return () => {
      map.off('move', updatePos)
      map.off('zoom', updatePos)
    }
  }, [selectedDrawFeatureId])

  // Click outside a marker or action bar to deselect
  useEffect(() => {
    if (!selectedObjectId && !selectedDrawFeatureId) return
    const handleClick = (e) => {
      if (e.target.closest('.marker-action-bar')) return
      setSelectedDrawFeatureId(null)
      if (!e.target.closest('.gis-marker')) {
        setSelectedObjectId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [selectedObjectId, selectedDrawFeatureId])

  // Clean up object markers that were removed from state
  useEffect(() => {
    const currentIds = new Set(objects.map(o => o.id))
    Object.keys(objectMarkersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        objectMarkersRef.current[id].remove()
        delete objectMarkersRef.current[id]
      }
    })
  }, [objects])

  // Persist completed draw features across draw sessions
  const drawFeaturesRef = useRef([])

  // Shared helper to push draw features to the GeoJSON source
  function updateDrawSource() {
    try {
      const map = mapRef.current
      if (!map) return
      const source = map.getSource('tactical-draw')
      if (!source) return
      source.setData({ type: 'FeatureCollection', features: drawFeaturesRef.current })
    } catch (e) { /* source not ready yet */ }
  }

  // Tactical draw interaction
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!tacticalDrawOn) {
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
      return
    }

    map.dragPan.disable()
    const container = map.getCanvasContainer()
    container.style.touchAction = 'none'
    map.getCanvas().style.cursor = 'crosshair'

    const SAMPLE_MS = 150
    let isDrawing = false

    const getLngLat = (e) => {
      const rect = container.getBoundingClientRect()
      return map.unproject([e.clientX - rect.left, e.clientY - rect.top])
    }

    let lastSample = 0
    const onPointerDown = (e) => {
      if (e.button && e.button !== 0) return
      isDrawing = true
      lastSample = performance.now()
      const pt = getLngLat(e)
      const featureId = crypto.randomUUID()
      drawFeaturesRef.current.push({
        type: 'Feature',
        properties: { id: featureId, strokeColor: tacticalDrawColor },
        geometry: { type: 'LineString', coordinates: [[pt.lng, pt.lat, 0]] }
      })
      updateDrawSource()
    }

    const onPointerMove = (e) => {
      if (!isDrawing) return
      const now = performance.now()
      if (now - lastSample < SAMPLE_MS) return
      const dt = now - lastSample
      lastSample = now
      const pt = getLngLat(e)
      const features = drawFeaturesRef.current
      const feature = features[features.length - 1]
      feature.geometry.coordinates.push([pt.lng, pt.lat, dt])
      updateDrawSource()
    }

    const onPointerUp = () => {
      if (!isDrawing) return
      isDrawing = false
      if (drawFeaturesRef.current.length > 0) {
        gisViewRef.current?.syncMapBoundary()
        const feature = drawFeaturesRef.current[drawFeaturesRef.current.length - 1]
        sendTacticalDrawC2(feature)
        onTacticalDrawEnd?.()
      }
    }

    container.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerUp)
      container.style.touchAction = ''
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
    }
  }, [tacticalDrawOn])

  function handleRotate(objectId, direction) {
    setObjects(prev =>
      prev.map(o => {
        if (o.id !== objectId) return o
        const newRotation = direction === 'left' ? o.rotation - 15 : o.rotation + 15
        const marker = objectMarkersRef.current[objectId]
        if (marker) {
          const imgEl = marker.getElement().querySelector('img')
          if (imgEl) imgEl.style.transform = `rotate(${newRotation}deg)`
        }
        sendGisUpdate(o.id, o.label, o.lng, o.lat, newRotation, o.img)
        return { ...o, rotation: newRotation }
      })
    )
  }

  function handleDeleteDrawFeature(featureId) {
    const idx = drawFeaturesRef.current.findIndex(f => f.properties?.id === featureId)
    if (idx === -1) return
    drawFeaturesRef.current.splice(idx, 1)
    updateDrawSource()
    setSelectedDrawFeatureId(null)
    sendTacticalDrawDelete(featureId)
  }

  function handleDelete(objectId) {
    const obj = objects.find(o => o.id === objectId)
    if (obj) sendGisDelete(obj.id, obj.label, obj.img)
    const marker = objectMarkersRef.current[objectId]
    if (marker) {
      marker.remove()
      delete objectMarkersRef.current[objectId]
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

      {/* Action bar for selected draw line */}
      {selectedDrawFeatureId && (
        <div
          className="marker-action-bar absolute z-[200] flex items-center gap-1.5 bg-surface border border-border rounded-lg px-3 py-1.5 shadow-lg shadow-black/40 pointer-events-auto"
          style={{
            left: drawActionBarPos.x,
            top: drawActionBarPos.y - 80,
            transform: 'translateX(-50%)'
          }}
        >
          <button
            className="flex items-center justify-center w-12 h-12 border-none rounded-lg cursor-pointer transition-colors"
            style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}
            onClick={() => handleDeleteDrawFeature(selectedDrawFeatureId)}
            title="Delete line"
          >
            <Trash2 size={22} />
          </button>
        </div>
      )}
    </div>
  )
}
