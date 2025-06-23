export interface SymbolInfo {
  poolId: string
  description: string
  type: string
  session: string
  exchange: string
  minmov: number
  pricescale: number
  has_intraday: boolean
  has_no_volume: boolean
  has_weekly_and_monthly: boolean
  volume_precision: number
  mintA: string
  mintB: string
  decimals: number
  // Additional properties for lightweight-charts compatibility
  ticker: string
  name: string
  full_name: string
  timezone: string
  listed_exchange: string
  currency_code: string
  original_currency_code: string
  unit_id: string
  original_unit_id: string
  unit_conversion_types: string[]
  has_dwm: boolean
  force_session_rebuild: boolean
  has_seconds: boolean
  seconds_multipliers: string[]
  has_daily: boolean
  intraday_multipliers: string[]
  supported_resolution: string[]
  has_seconds_multipliers: boolean
  has_intraday_multipliers: boolean
  has_daily_multipliers: boolean
  has_weekly_and_monthly_multipliers: boolean
  has_empty_bars: boolean
  visible_plots_set: string
  data_status: string
  format: string
  fractional: boolean
  minmove2: number
  supported_resolutions: string[]
}

export const ResolutionToSeconds = {
  1: 60,
  5: 5 * 60,
  15: 15 * 60,
  60: 60 * 60,
  240: 60 * 60 * 4,
  '1D': 60 * 60 * 24,
  '1W': 60 * 60 * 24 * 7,
  '1M': 60 * 60 * 24 * 30
}
