import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadForecastStore } from './data/adapter'
import { KarnatakaMap } from './components/KarnatakaMap'
import { DistrictPanel } from './components/DistrictPanel'
import { SkyBackground } from './components/SkyBackground'
import type { DataStatus, DistrictForecast, ForecastStore } from './types'
import { RAIN_CATEGORIES, categoryCounts, displayRainfall, shortDate } from './utils/rainfall'
import { DISTRICT_REGION, REGIONS, districtInRegion, type KarnatakaRegion } from './utils/regions'
import { rainfallForSky, weatherSceneForRainfall } from './utils/skyState'
import { weatherIconForRainfall } from './utils/weatherIcon'

const initialStore: ForecastStore = {
  records: [],
  futureGfsForecasts: [],
  dates: [],
  districts: [],
  status: {
    masterLoaded: false,
    errorOutputLoaded: false,
    geoJsonLoaded: false,
    geoDistrictCount: null,
    duplicateGeoDistrictNames: [],
    errors: [],
  },
}

function recordFor(records: DistrictForecast[], date: string, district: string | null) {
  return records.find((record) => record.date === date && record.district === district) ?? null
}

export default function App() {
  const [store, setStore] = useState(initialStore)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'forecast' | 'historical'>('forecast')
  const [date, setDate] = useState('')
  const [district, setDistrict] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState<KarnatakaRegion | 'All'>('All')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [geoState, setGeoState] = useState<
    Pick<DataStatus, 'geoJsonLoaded' | 'geoDistrictCount' | 'duplicateGeoDistrictNames' | 'errors'>
  >({ geoJsonLoaded: false, geoDistrictCount: null, duplicateGeoDistrictNames: [], errors: [] })
  const showDeveloperStatus = new URLSearchParams(window.location.search).get('dataStatus') === 'true'

  useEffect(() => {
    loadForecastStore()
      .then((loaded) => {
        setStore(loaded)
        const today = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
          .formatToParts(new Date())
          .reduce<Record<string, string>>((parts, item) => ({ ...parts, [item.type]: item.value }), {})
        const localToday = `${today.year}-${today.month}-${today.day}`
        setDate(loaded.dates.includes(localToday) ? localToday : loaded.dates.at(-1) ?? '')
        setDistrict(loaded.districts[0] ?? null)
      })
      .finally(() => setLoading(false))
  }, [])

  const selectedRecords = useMemo(
    () => store.records.filter((record) => record.date === date),
    [store.records, date],
  )
  const regionRecords = useMemo(
    () => selectedRecords.filter((record) => districtInRegion(record.district, region)),
    [selectedRecords, region],
  )
  const record = useMemo(() => recordFor(store.records, date, district), [store.records, date, district])
  const futureGfsForecast = useMemo(
    () => store.futureGfsForecasts.find((forecast) => forecast.date === date) ?? null,
    [store.futureGfsForecasts, date],
  )
  const isOperationalForecast = selectedRecords.some((item) => item.dataMode === 'operational_forecast')
  const isArchivedReconstruction = selectedRecords.some((item) => item.dataMode === 'archived_reconstruction')
  const isForecastProduct = isOperationalForecast || isArchivedReconstruction
  const operationalLead = selectedRecords.find((item) => item.dataMode === 'operational_forecast')?.leadDays ?? null
  useEffect(() => {
    if (isOperationalForecast) setMode('forecast')
  }, [isOperationalForecast])
  const history = useMemo(
    () => store.records.filter((item) => item.district === district && item.date <= date),
    [store.records, district, date],
  )
  const visibleValue = (item: DistrictForecast) =>
    mode === 'historical' ? item.actualRainfall : item.finalForecast ?? item.gfs
  const populated = regionRecords.map((item) => ({ value: visibleValue(item) })).filter((item) => item.value !== null)
  const average = populated.length
    ? populated.reduce((sum, item) => sum + (item.value ?? 0), 0) / populated.length
    : null
  const statewideValues = selectedRecords
    .map((item) => visibleValue(item))
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const statewideAverage = statewideValues.length
    ? statewideValues.reduce((sum, value) => sum + value, 0) / statewideValues.length
    : null
  const sceneValue = district && record ? rainfallForSky(record, mode) : statewideAverage
  const weatherScene = weatherSceneForRainfall(
    sceneValue,
    district && record ? 'selected district' : statewideValues.length ? 'statewide average' : 'no weather data',
  )
  const skyState = weatherScene.state
  const counts = categoryCounts(regionRecords.map((item) => ({ value: visibleValue(item) })))
  const matches = store.districts
    .filter((name) => districtInRegion(name, region))
    .filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 6)
  const searchIcon = (name: string) => {
    const matchingRecord = recordFor(store.records, date, name)
    return weatherIconForRainfall(matchingRecord ? visibleValue(matchingRecord) : null).symbol
  }
  const unavailable = Boolean(date) && !selectedRecords.length && !futureGfsForecast
  const heavyCount =
    (counts.get('Heavy') ?? 0) + (counts.get('Very Heavy') ?? 0) + (counts.get('Extremely Heavy') ?? 0)

  const updateGeo = useCallback(
    (state: { loaded: boolean; count: number | null; duplicates: string[]; error?: string }) => {
      setGeoState({
        geoJsonLoaded: state.loaded,
        geoDistrictCount: state.count,
        duplicateGeoDistrictNames: state.duplicates,
        errors: state.error ? [state.error] : [],
      })
    },
    [],
  )

  if (loading) {
    return (
      <><SkyBackground scene={weatherSceneForRainfall(null, 'no weather data')} /><main className="loading-screen"><div className="loading-orb" /><p>Loading verified SYNAPSE-WX datasets…</p></main></>
    )
  }
  if (!store.records.length) {
    return (
      <><SkyBackground scene={weatherSceneForRainfall(null, 'no weather data')} /><main className="loading-screen"><h1>SYNAPSE-WX</h1><p>Forecast data unavailable.</p><small>{store.status.errors.join(' · ')}</small></main></>
    )
  }

  return (
    <>
      <SkyBackground scene={weatherScene} />
      <main className="app-shell" data-sky-state={skyState}>
      <header className="topbar glass-surface">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            <h1>SYNAPSE-WX</h1>
            <p>Adaptive Three-Model Rainfall Forecasting</p>
          </div>
        </div>
        <div className="header-controls">
          <label className="control date-control">
            <span>Forecast date</span>
            <select value={date} onChange={(event) => setDate(event.target.value)}>
              {store.dates.map((available) => (
                <option value={available} key={available}>
                  {shortDate(available)}
                </option>
              ))}
            </select>
          </label>
          <label className="control region-control">
            <span>Region</span>
            <select
              value={region}
              onChange={(event) => setRegion(event.target.value as KarnatakaRegion | 'All')}
              aria-label="Filter by Karnataka region"
            >
              <option value="All">All Karnataka</option>
              {REGIONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="control district-control">
            <span>District</span>
            <input
              placeholder="Search district"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => setSearch((current) => current || '')}
            />
          </label>
          {search && (
            <div className="search-results">
              {matches.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setDistrict(name)
                    setSearch('')
                  }}
                >
                  <span className="search-weather-icon" aria-hidden="true">{searchIcon(name)}</span>
                  {name}
                </button>
              ))}
              {!matches.length && <span>No matching district</span>}
            </div>
          )}
          <div className="mode-toggle" aria-label="Data mode">
            <button className={mode === 'forecast' ? 'active' : ''} onClick={() => setMode('forecast')}>
              {isForecastProduct ? 'Forecast' : 'Hindcast'}
            </button>
            <button
              className={mode === 'historical' ? 'active' : ''}
              onClick={() => setMode('historical')}
              disabled={isOperationalForecast}
              title={isOperationalForecast ? 'IMD realised rainfall is not available for an operational forecast.' : undefined}
            >
              Historical
            </button>
          </div>
          <span className="lead-badge">24H</span>
        </div>
      </header>

      <section className="date-line">
        <span className={isOperationalForecast || mode === 'forecast' ? 'forecast-pill' : 'history-pill'}>
          {isOperationalForecast ? `OPERATIONAL SYNAPSE-WX · DAY-${operationalLead ?? '—'}` : isArchivedReconstruction ? 'SYNAPSE-WX FORECAST' : mode === 'historical' ? 'IMD VERIFICATION' : 'HISTORICAL HINDCAST — NOT A LIVE FORECAST'}
        </span>
        <strong>{shortDate(date)}</strong>
        {region !== 'All' && <span className="region-pill">{region}</span>}
        <span>
          {isOperationalForecast
            ? 'Live operational cycle · district blend · IMD verification pending'
            : isArchivedReconstruction
            ? 'Three-model adaptive blend · IMD verification available'
            : mode === 'forecast'
            ? 'Saved GFS, IFS HRES, AIFS and SYNAPSE-WX · frozen model'
            : 'Observed daily IMD rainfall — not a forecast'}
        </span>
        <span className="atmosphere-pill"><i /> {weatherScene.label} atmosphere · {weatherScene.source}</span>
      </section>
      {unavailable && <div className="availability-alert">Forecast data unavailable for this date.</div>}
      {isOperationalForecast && <div className="availability-alert future-forecast-alert"><strong>Operational forecast</strong> · Valid for {shortDate(date)} · Day-{operationalLead ?? '—'} from the latest available cycle. IMD verification is not available yet.</div>}

      <section className="summary-grid">
        <article className="summary-card identity anim-card" style={{ animationDelay: '40ms' }}>
          <p className="eyebrow">{region === 'All' ? 'Karnataka administrative coverage' : region}</p>
          <strong>
            {region === 'All' ? store.districts.length : Object.keys(DISTRICT_REGION).filter((name) => store.districts.includes(name) && DISTRICT_REGION[name] === region).length}{' '}
            <small>administrative districts</small>
          </strong>
          <span>{futureGfsForecast ? `${regionRecords.length} districts with district-level forecast data` : `${regionRecords.length} with data on this date`}</span>
        </article>
        <article className="summary-card anim-card" style={{ animationDelay: '90ms' }}>
          <p className="eyebrow">{futureGfsForecast ? 'Regional GFS context' : `Average ${mode === 'historical' ? 'realised' : 'forecast'}`}</p>
          <strong>{displayRainfall(futureGfsForecast?.regionalGfs ?? average)}</strong>
          <span>{futureGfsForecast ? `${futureGfsForecast.gridCellCount} supplied GFS cells · not district-local` : `${populated.length} districts with available values`}</span>
        </article>
        <article className="summary-card anim-card" style={{ animationDelay: '140ms' }}>
          <p className="eyebrow">{futureGfsForecast ? 'District forecast coverage' : 'Districts with rain'}</p>
          <strong>{futureGfsForecast ? '—' : <>{regionRecords.filter((item) => (visibleValue(item) ?? -1) > 0).length}<small> / {region === 'All' ? store.districts.length : regionRecords.length || '—'}</small></>}</strong>
          <span>{futureGfsForecast ? 'District values are not available yet' : 'Missing values are excluded'}</span>
        </article>
        <article className="summary-card alert-card anim-card" style={{ animationDelay: '190ms' }}>
          <p className="eyebrow">{futureGfsForecast ? 'District verification' : 'Heavy rainfall districts'}</p>
          <strong>{futureGfsForecast ? '—' : heavyCount}</strong>
          <span>
            {futureGfsForecast ? 'Not available yet' : `Heavy+ on ${shortDate(date)}`}
            {region !== 'All' ? ` · ${region}` : ''}
          </span>
        </article>
      </section>

      <section className="dashboard-grid">
        <KarnatakaMap
          records={selectedRecords}
          selectedDistrict={district}
          displayHistorical={mode === 'historical'}
          futureGfsForecast={futureGfsForecast}
          regionFilter={region}
          expectedDistrictCount={store.districts.length}
          onSelect={setDistrict}
          onValidation={updateGeo}
        />
        <DistrictPanel
          record={record}
          history={history}
          historical={mode === 'historical'}
          futureGfsForecast={futureGfsForecast}
          districtName={district}
          onClose={() => setDistrict(null)}
        />
      </section>

      <section className="overview-section card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{futureGfsForecast ? 'District data status' : 'Rainfall legend & counts'}</p>
            <h2>
              {futureGfsForecast ? 'District forecast not available yet' : `${mode === 'historical' ? 'IMD realised' : 'Forecast'} distribution`}
              {region !== 'All' ? ` · ${region}` : ''}
            </h2>
          </div>
          <span>{shortDate(date)}</span>
        </div>
        <div className="rainfall-overview">
          {RAIN_CATEGORIES.map((category) => (
            <div className="category-row" key={category.label}>
              <span className="category-dot" style={{ background: category.color }} />
              <b>{category.label}</b>
              <div className="track">
                <i
                  style={{
                    width: `${((counts.get(category.label) ?? 0) / Math.max(regionRecords.length, 1)) * 100}%`,
                    background: category.color,
                  }}
                />
              </div>
              <strong>{counts.get(category.label) ?? 0}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="secondary-panel card">
        <button
          type="button"
          className="collapse-toggle"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen((open) => !open)}
        >
          <span>About SYNAPSE-WX · models &amp; context</span>
          <strong>{aboutOpen ? 'Hide' : 'Show'}</strong>
        </button>
        {aboutOpen && (
          <div className="collapse-body">
            <p>
              SYNAPSE-WX combines saved GFS, IFS HRES, and AIFS rainfall hindcasts using district-specific adaptive
              trust weights derived only from earlier IMD errors. This is a historical evaluation, not an official warning.
            </p>
            <div className="architecture">
              <span>GFS</span>
              <i>+</i>
              <span>IFS HRES</span>
              <i>+</i>
              <span>AIFS</span>
              <i>+</i>
              <span>Adaptive trust</span>
              <i>↓</i>
              <b>60-day inverse-MAE blend</b>
              <i>↓</i>
              <strong>SYNAPSE-WX 24-hour hindcast</strong>
            </div>
            <p className="overview-note">
              Weights use only prior district-date errors and sum to 100%. Heavy districts on this date: {heavyCount}.
            </p>
          </div>
        )}
      </section>

      {showDeveloperStatus && (
        <section className="developer-status card">
          <button
            type="button"
            className="collapse-toggle"
            aria-expanded={devOpen}
            onClick={() => setDevOpen((open) => !open)}
          >
            <span>Developer data status</span>
            <strong>{devOpen ? 'Hide' : 'Show'}</strong>
          </button>
          {devOpen && (
            <div className="collapse-body">
              <div>
                <span>Master CSV: {store.status.masterLoaded ? 'loaded' : 'missing'}</span>
                <span>Error-model output: {store.status.errorOutputLoaded ? 'loaded' : 'missing'}</span>
                <span>
                  GeoJSON:{' '}
                  {geoState.geoJsonLoaded ? `${geoState.geoDistrictCount} validated districts` : 'not available'}
                </span>
              </div>
              {[...store.status.errors, ...geoState.errors].map((error) => (
                <small key={error}>{error}</small>
              ))}
            </div>
          )}
        </section>
      )}

      <footer>
        <h2>Data &amp; Model Transparency</h2>
        <p>
          Forecast outputs are loaded from the frozen SYNAPSE-WX hindcast. IMD rainfall
          represents realised observations and must not be interpreted as forecasts. Model components are shown
          only when corresponding data are available. Region filters are geographic metadata only.
        </p>
        <span>{isOperationalForecast ? `Operational / Day-${operationalLead ?? '—'}` : isArchivedReconstruction ? 'Verified forecast record' : 'Prototype / Hindcast'}</span>
      </footer>
      </main>
    </>
  )
}
