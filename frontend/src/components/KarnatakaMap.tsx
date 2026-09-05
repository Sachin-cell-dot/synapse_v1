import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, ZoomControl, useMap } from 'react-leaflet'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { geoJSON as leafletGeoJSON, type Layer } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { DistrictForecast, FutureGfsForecast, RainCategory } from '../types'
import { RAIN_CATEGORIES, categoryForRainfall, displayRainfall, shortDate } from '../utils/rainfall'
import { weatherIconForRainfall } from '../utils/weatherIcon'
import { districtInRegion, type KarnatakaRegion } from '../utils/regions'
import geoJsonUrl from '../../karnataka_districts.geojson?url'
import indiaGeoJsonUrl from '../../indian.geojson?url'

interface Props {
  records: DistrictForecast[]
  futureGfsForecast: FutureGfsForecast | null
  selectedDistrict: string | null
  displayHistorical: boolean
  regionFilter: KarnatakaRegion | 'All'
  expectedDistrictCount: number
  onSelect: (district: string) => void
  onValidation: (state: { loaded: boolean; count: number | null; duplicates: string[]; error?: string }) => void
}

const NO_DATA_COLOR = '#526273'
const MIN_ZOOM = 4
const MAX_ZOOM = 11

function featureDistrict(feature: Feature<Geometry>): string | null {
  const props = (feature.properties ?? {}) as Record<string, unknown>
  const value = props.district_name ?? props.DISTRICT ?? props.district ?? props.District ?? props.NAME_2 ?? props.NAME
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function districtKey(value: string): string {
  const aliases: Record<string, string> = { bagalkot: 'bagalkote', davanagere: 'davangere' }
  const normalized = value.trim().toLowerCase()
  return aliases[normalized] ?? normalized
}

function rainfallFor(record: DistrictForecast | undefined, displayHistorical: boolean): number | null {
  return displayHistorical ? record?.actualRainfall ?? null : record?.finalForecast ?? record?.gfs ?? null
}

function categoryRange(category: RainCategory): string {
  if (category.min === category.max) return '0 mm'
  if (category.max === null) return `≥${category.min} mm`
  return `${category.min}–${category.max} mm`
}

/** Fit once to the GeoJSON bounds. Single clicks never zoom. */
function MapViewport({ data }: { data: FeatureCollection }) {
  const map = useMap()

  useEffect(() => {
    const bounds = leafletGeoJSON(data).getBounds()
    if (!bounds.isValid()) return
    map.setMaxBounds(bounds.pad(0.18))
    map.setMinZoom(MIN_ZOOM)
    map.setMaxZoom(MAX_ZOOM)
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 8, animate: true, duration: 0.45 })
  }, [data, map])

  return null
}

function RainfallLegend() {
  return (
    <div className="map-legend" aria-label="Rainfall category legend">
      <strong>Rainfall (24 h)</strong>
      {RAIN_CATEGORIES.map((category) => (
        <div key={category.label}>
          <i style={{ background: category.color }} />
          <span>{category.label}</span>
          <small>{categoryRange(category)}</small>
        </div>
      ))}
      <div>
        <i style={{ background: NO_DATA_COLOR }} />
        <span>No data</span>
        <small>Unavailable</small>
      </div>
    </div>
  )
}

export function KarnatakaMap({
  records,
  futureGfsForecast,
  selectedDistrict,
  displayHistorical,
  regionFilter,
  expectedDistrictCount,
  onSelect,
  onValidation,
}: Props) {
  const [geoJson, setGeoJson] = useState<FeatureCollection | null>(null)
  const [indiaGeoJson, setIndiaGeoJson] = useState<FeatureCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recordByName = useMemo(
    () => new Map(records.map((record) => [districtKey(record.district), record])),
    [records],
  )
  const mapCenter = useMemo(
    () => (geoJson ? leafletGeoJSON(geoJson).getBounds().getCenter() : undefined),
    [geoJson],
  )

  useEffect(() => {
    fetch(geoJsonUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Supplied GeoJSON was not found (${response.status}).`)
        return response.json() as Promise<FeatureCollection>
      })
      .then((data) => {
        const names = data.features.map(featureDistrict).filter((name): name is string => Boolean(name))
        const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
        if (!data.features.length) throw new Error('GeoJSON has no district features.')
        if (duplicates.length) {
          throw new Error(`GeoJSON has duplicate district names: ${[...new Set(duplicates)].join(', ')}`)
        }
        const coverageError =
          data.features.length === expectedDistrictCount
            ? undefined
            : `Boundary coverage differs from the loaded dataset: ${data.features.length} map boundaries for ${expectedDistrictCount} districts.`
        setGeoJson(data)
        onValidation({ loaded: true, count: data.features.length, duplicates: [], error: coverageError })
      })
      .catch((loadError: unknown) => {
        const message = loadError instanceof Error ? loadError.message : String(loadError)
        setError(message)
        onValidation({ loaded: false, count: null, duplicates: [], error: message })
      })
  }, [expectedDistrictCount, onValidation])

  useEffect(() => {
    fetch(indiaGeoJsonUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`India geographic context was not found (${response.status}).`)
        return response.json() as Promise<FeatureCollection>
      })
      .then((data) => setIndiaGeoJson(data))
      // District data remains usable if this optional geographic context cannot load.
      .catch(() => setIndiaGeoJson(null))
  }, [])

  const style = (feature?: Feature<Geometry>) => {
    const district = feature ? featureDistrict(feature) : null
    const record = district ? recordByName.get(districtKey(district)) : undefined
    const category = categoryForRainfall(rainfallFor(record, displayHistorical))
    const selected = district ? districtKey(district) === districtKey(selectedDistrict ?? '') : false
    const inRegion = district ? districtInRegion(record?.district ?? district, regionFilter) : true
    const fillOpacity = !inRegion ? 0.18 : selected ? 0.94 : category ? 0.8 : 0.46
    return {
      color: selected ? '#f8fbff' : inRegion ? '#d3e3ef' : '#7a8d9c55',
      weight: selected ? 2.8 : inRegion ? 0.9 : 0.5,
      fillColor: category?.color ?? NO_DATA_COLOR,
      fillOpacity,
      className: 'district-polygon',
    }
  }

  const onEachFeature = (feature: Feature<Geometry>, layer: Layer) => {
    const district = featureDistrict(feature)
    const record = district ? recordByName.get(districtKey(district)) : undefined
    const rainfall = rainfallFor(record, displayHistorical)
    const category = categoryForRainfall(rainfall)
    const weatherIcon = weatherIconForRainfall(rainfall)
    const label = record?.district ?? district
    layer.on({
      click: (event) => {
        // Prevent Leaflet from treating selection as a zoom gesture.
        event.originalEvent?.stopPropagation?.()
        if (district) onSelect(label ?? district)
      },
      mouseover: (event) => {
        if (!district) return
        const inRegion = districtInRegion(record?.district ?? district, regionFilter)
        event.target.setStyle({
          weight: 2.4,
          fillOpacity: inRegion ? 0.97 : 0.28,
        })
        event.target.bringToFront()
      },
      mouseout: (event) => event.target.setStyle(style(feature)),
    })
    if (district) {
      layer.bindTooltip(
        `<strong>${weatherIcon.symbol} ${label}</strong><br/>Rainfall: ${displayRainfall(rainfall)}${
          rainfall === null
            ? ''
            : `<br/>Category: ${category?.label ?? 'No data'}<br/>${displayHistorical ? 'IMD realised' : 'Forecast'} date: ${
                record ? shortDate(record.date) : 'Not available'
              }`
        }`,
        { sticky: true, className: 'district-tooltip', direction: 'top', opacity: 0.96 },
      )
    }
  }

  const title = futureGfsForecast
    ? 'Karnataka map · GFS regional context available'
    : regionFilter === 'All'
      ? `Karnataka map · ${displayHistorical ? 'IMD realised rainfall' : 'rainfall forecast'}`
      : `Karnataka map · ${regionFilter} ${displayHistorical ? 'IMD verification' : 'hindcast'}`

  return (
    <section className="map-card card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Karnataka rainfall</p>
          <h2>{title}</h2>
        </div>
        <span className="map-status">{geoJson ? `${geoJson.features.length} boundaries` : 'Map validation'}</span>
      </div>
      <div className="map-shell">
        <MapContainer
          center={mapCenter}
          zoom={7}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          zoomSnap={1}
          zoomDelta={1}
          wheelPxPerZoomLevel={120}
          maxBoundsViscosity={0.85}
          scrollWheelZoom
          doubleClickZoom={false}
          boxZoom={false}
          touchZoom
          dragging
          zoomAnimation
          fadeAnimation
          zoomControl={false}
          className="leaflet-map"
        >
          <ZoomControl position="bottomright" />
          {geoJson && (
            <>
              <MapViewport data={geoJson} />
              {indiaGeoJson && (
                <GeoJSON
                  data={indiaGeoJson}
                  interactive={false}
                  style={{ color: '#b8d3e0', weight: 0.72, opacity: 0.72, fillColor: '#27475a', fillOpacity: 0.1 }}
                />
              )}
              <GeoJSON
                key={`geo-${regionFilter}-${displayHistorical ? 'h' : 'f'}-${selectedDistrict ?? 'none'}`}
                data={geoJson}
                style={style}
                onEachFeature={onEachFeature}
              />
              <RainfallLegend />
            </>
          )}
        </MapContainer>
        {!geoJson && (
          <div className="map-unavailable">
            <span>Map data unavailable</span>
            <p>{error ?? 'Loading Karnataka district GeoJSON…'}</p>
            <small>No district polygons are drawn or approximated.</small>
          </div>
        )}
      </div>
      {geoJson && geoJson.features.length !== expectedDistrictCount && (
        <p className="map-coverage-note">
          {futureGfsForecast
            ? `The real GFS value is regional context from ${futureGfsForecast.gridCellCount} cells, not a district-local map value; district polygons remain uncoloured until district forecasts are supplied.`
            : `India state boundaries provide geographic context. Rainfall values are supplied only for Karnataka districts; other states are intentionally not coloured. ${expectedDistrictCount - geoJson.features.length} loaded district boundary is unavailable in the supplied map file.`}
        </p>
      )}
    </section>
  )
}
