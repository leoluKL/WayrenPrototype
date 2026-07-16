import { useEffect, useRef } from 'react'
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

export default function MapGis() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

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
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full" />
    </div>
  )
}
