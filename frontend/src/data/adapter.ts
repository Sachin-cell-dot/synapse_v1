import type { DistrictForecast, ForecastStore } from '../types'
import { numberOrNull, parseCsv } from './csv'

const DASHBOARD_URL = '/synapse_wx_dashboard_forecasts.csv'
const OPERATIONAL_URL = '/synapse_wx_latest_operational_cycle.csv'

function localValidDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function spread(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return available.length > 1 ? Math.max(...available) - Math.min(...available) : null
}

export async function loadForecastStore(): Promise<ForecastStore> {
  const [response, operationalResponse] = await Promise.all([fetch(DASHBOARD_URL), fetch(OPERATIONAL_URL, { cache: 'no-store' })])
  if (!response.ok) {
    const error = `${DASHBOARD_URL}: ${response.status} ${response.statusText}`
    return { records: [], futureGfsForecasts: [], dates: [], districts: [], status: { masterLoaded: false, errorOutputLoaded: false, geoJsonLoaded: false, geoDistrictCount: null, duplicateGeoDistrictNames: [], errors: [error] } }
  }

  const historicalRecords: DistrictForecast[] = parseCsv(await response.text()).map((row) => ({
    district: row.district, districtCode: row.district_code, division: row.division || null, date: row.date, issueTime: null,
    gfs: numberOrNull(row.gfs_forecast_mm), historicalForecast: null, historicalTrust: null,
    ifs: numberOrNull(row.ifs_hres_forecast_mm), aifs: numberOrNull(row.aifs_forecast_mm),
    predictedErrorGfs: null, predictedErrorIfs: null, predictedErrorAifs: null,
    trustGfs: numberOrNull(row.weight_gfs), trustIfs: numberOrNull(row.weight_ifs_hres), trustAifs: numberOrNull(row.weight_aifs),
    finalForecast: numberOrNull(row.synapse_wx_forecast_mm), actualRainfall: numberOrNull(row.imd_actual_mm),
    absoluteError: numberOrNull(row.absolute_error_mm), modelAgreement: numberOrNull(row.model_agreement_mm),
    confidence: row.confidence_level || null, trustExplanation: row.trust_explanation || null,
    rainfallCategory: row.rainfall_category || null, synopticContext: null,
    dataMode: 'historical_hindcast', leadDays: null, operationalStatus: null,
  }))

  const operationalRows = operationalResponse.ok ? parseCsv(await operationalResponse.text()) : []
  const operationalRecords: DistrictForecast[] = operationalRows.filter((row) => row.status === 'complete').map((row) => {
    const gfs = numberOrNull(row.source_gfs_mm)
    const ifs = numberOrNull(row.source_ifs_hres_mm)
    const aifs = numberOrNull(row.source_aifs_mm)
    const leadDays = numberOrNull(row.lead_days)
    return {
      district: row.district, districtCode: row.district_id, division: row.division || null,
      date: localValidDate(row.valid_start_utc), issueTime: row.issued_at_utc || null,
      gfs, historicalForecast: null, historicalTrust: null, ifs, aifs,
      predictedErrorGfs: null, predictedErrorIfs: null, predictedErrorAifs: null,
      trustGfs: numberOrNull(row.weight_gfs), trustIfs: numberOrNull(row.weight_ifs_hres), trustAifs: numberOrNull(row.weight_aifs),
      finalForecast: numberOrNull(row.synapse_wx_forecast_mm), actualRainfall: numberOrNull(row.verification_mm),
      absoluteError: numberOrNull(row.synapse_wx_absolute_error_mm),
      modelAgreement: spread([gfs, ifs, aifs]), confidence: null,
      trustExplanation: `Operational Day-${leadDays ?? '—'} forecast. Weighting status: ${row.fallback || 'adaptive historical skill'}.`,
      rainfallCategory: null, synopticContext: null,
      dataMode: row.mode.toLowerCase().includes('reconstruction') ? 'archived_reconstruction' : 'operational_forecast',
      leadDays, operationalStatus: row.status,
    }
  })

  const records = [...historicalRecords, ...operationalRecords].sort((a, b) => a.date.localeCompare(b.date) || a.district.localeCompare(b.district))
  return {
    records, futureGfsForecasts: [],
    dates: [...new Set(records.map((record) => record.date))].sort(),
    districts: [...new Set(records.map((record) => record.district))].sort((a, b) => a.localeCompare(b)),
    status: { masterLoaded: true, errorOutputLoaded: operationalResponse.ok, geoJsonLoaded: false, geoDistrictCount: null, duplicateGeoDistrictNames: [], errors: operationalResponse.ok ? [] : [`${OPERATIONAL_URL}: no operational cycle was loaded`] },
  }
}
