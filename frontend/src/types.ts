export type NullableNumber = number | null

export interface SynopticContext {
  availableStations: NullableNumber
  maxAgeHours: NullableNumber
  latestTimestamp: string | null
}

export interface DistrictForecast {
  district: string
  districtCode: string
  division: string | null
  date: string
  issueTime: string | null
  gfs: NullableNumber
  historicalForecast: NullableNumber
  historicalTrust: NullableNumber
  ifs: NullableNumber
  aifs: NullableNumber
  predictedErrorGfs: NullableNumber
  predictedErrorIfs: NullableNumber
  predictedErrorAifs: NullableNumber
  trustGfs: NullableNumber
  trustIfs: NullableNumber
  trustAifs: NullableNumber
  finalForecast: NullableNumber
  actualRainfall: NullableNumber
  absoluteError: NullableNumber
  modelAgreement: NullableNumber
  confidence: string | null
  trustExplanation: string | null
  rainfallCategory: string | null
  synopticContext: SynopticContext | null
  dataMode: 'historical_hindcast' | 'operational_forecast' | 'archived_reconstruction'
  leadDays: NullableNumber
  operationalStatus: string | null
}

export interface DataStatus {
  masterLoaded: boolean
  errorOutputLoaded: boolean
  geoJsonLoaded: boolean
  geoDistrictCount: number | null
  duplicateGeoDistrictNames: string[]
  errors: string[]
}

export interface ForecastStore {
  records: DistrictForecast[]
  futureGfsForecasts: FutureGfsForecast[]
  dates: string[]
  districts: string[]
  status: DataStatus
}

/** A real GFS grid-context forecast that is outside the audited IMD hindcast contract. */
export interface FutureGfsForecast {
  date: string
  issueTime: string
  validTime: string
  regionalGfs: number
  gridCellCount: number
}

export interface RainCategory {
  label: string
  color: string
  min: number
  max: number | null
}
