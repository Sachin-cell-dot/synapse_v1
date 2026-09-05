import type { NullableNumber, RainCategory } from '../types'

export const RAIN_CATEGORIES: RainCategory[] = [
  { label: 'Dry', color: '#526273', min: 0, max: 0 },
  { label: 'Very light', color: '#8bd3f7', min: 0.1, max: 2.4 },
  { label: 'Light', color: '#3fa7df', min: 2.5, max: 15.5 },
  { label: 'Moderate', color: '#f0cf4c', min: 15.6, max: 35.5 },
  { label: 'Rather heavy', color: '#d8ad55', min: 35.6, max: 64.4 },
  { label: 'Heavy', color: '#f49b45', min: 64.5, max: 115.5 },
  { label: 'Very Heavy', color: '#e65c4a', min: 115.6, max: 204.4 },
  { label: 'Extremely Heavy', color: '#933fa9', min: 204.5, max: null },
]

export function categoryForRainfall(value: NullableNumber): RainCategory | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null
  return RAIN_CATEGORIES.find((category) => value >= category.min && (category.max === null || value <= category.max)) ?? null
}

export function displayRainfall(value: NullableNumber): string {
  return value === null || !Number.isFinite(value) ? 'Not available yet' : `${value.toFixed(1)} mm`
}

export function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

export function categoryCounts(records: { value: NullableNumber }[]): Map<string, number> {
  const counts = new Map(RAIN_CATEGORIES.map((category) => [category.label, 0]))
  records.forEach(({ value }) => {
    const category = categoryForRainfall(value)
    if (category) counts.set(category.label, (counts.get(category.label) ?? 0) + 1)
  })
  return counts
}
