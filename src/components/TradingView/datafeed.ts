import { useLaunchpadStore } from '@/store'
import { closeSocket, startSocket, subscribeOnStream, unsubscribeFromStream } from './streaming'
import axios from '@/api/axios'
import { Connection } from '@solana/web3.js'
import { ResolutionToSeconds, SymbolInfo } from './type'
import { NATIVE_MINT } from '@solana/spl-token'
import { initPoolPriceDecimal } from './utils'
import { MintInfo } from '@/features/Launchpad/type'
import { ApiV3Token } from '@raydium-io/raydium-sdk-v2'
import { wSolToSolString } from '@/utils/token'
import { CandlestickData } from 'lightweight-charts'

interface TradeData {
  c: number
  h: number
  l: number
  o: number
  poolId: string
  t: number
  vA: number
  vB: number
  vU: number
}

const lastBarsCache = new Map()
let nextPageKey: string | undefined

// Lightweight charts compatible types
export type ResolutionString = '1' | '5' | '15' | '60' | '240' | '1D' | '1W' | '1M'

export interface LightweightBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

// DatafeedConfiguration implementation
export default class DataFeed {
  private _connection: Connection
  private _mintInfo?: MintInfo
  private _mintBInfo?: ApiV3Token
  private _curveType?: number

  static configurationData = {
    // Represents the resolutions for bars supported by your datafeed
    supported_resolutions: ['1', '5', '15'] as ResolutionString[],
    // The `exchanges` arguments are used for the `searchSymbols` method if a user selects the exchange
    exchanges: [],
    // The `symbols_types` arguments are used for the `searchSymbols` method if a user selects this symbol type
    symbols_types: [],
    supports_group_request: true,
    supports_marks: false,
    supports_search: false,
    supports_timescale_marks: false
  }

  constructor(props: { connection: Connection; mintInfo?: MintInfo; mintBInfo?: ApiV3Token; curveType?: number }) {
    this._connection = props.connection
    this._mintInfo = props.mintInfo
    this._mintBInfo = props.mintInfo?.mintB ?? props.mintBInfo
    this._curveType = props.curveType
  }

  public onReady(callback: (data: any) => void) {
    console.log('[onReady]: Method call', this._connection)
    setTimeout(() => callback(DataFeed.configurationData))
  }

  public async searchSymbols(_userInput: string, _exchange: string, _symbolType: string, onResultReadyCallback: (data: any[]) => void) {
    console.log('[searchSymbols]: Method call')
    onResultReadyCallback([])
  }

  public async resolveSymbol(
    symbolName: string,
    onSymbolResolvedCallback: (symbol: SymbolInfo) => void,
    onResolveErrorCallback: any,
    _extension: any
  ) {
    if (!this._mintInfo) {
      console.log('[resolveSymbol]: cannot resolve symbol', symbolName)
      onResolveErrorCallback('cannot resolve symbol')
      return
    }
    const mintDecimal = Number(this._mintInfo.decimals)
    const decimals = 9 + Math.floor(mintDecimal / 2)
    const symbolB = wSolToSolString(this._mintBInfo?.symbol ?? 'SOL')
    const symbolInfo: SymbolInfo = {
      poolId: symbolName,
      mintA: this._mintInfo?.mint ?? 'mintA',
      mintB: this._mintBInfo?.address || NATIVE_MINT.toBase58(),
      ticker: `${this._mintInfo.symbol}-${symbolB}`,
      name: `${this._mintInfo.symbol}-${symbolB}`,
      full_name: `${this._mintInfo.symbol}-${symbolB}`,
      description: `${this._mintInfo.symbol}-${symbolB} pool`,
      type: 'Raydium Lauchpad pool',
      session: '24x7',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      exchange: 'Raydium',
      minmov: 1,
      minmove2: 0,
      pricescale: 10 ** decimals,
      fractional: false,
      has_intraday: true,
      has_no_volume: true,
      has_weekly_and_monthly: false,
      has_empty_bars: false,
      supported_resolutions: DataFeed.configurationData.supported_resolutions,
      volume_precision: 0,
      listed_exchange: 'Raydium',
      currency_code: 'USD',
      original_currency_code: 'USD',
      unit_id: 'USD',
      original_unit_id: 'USD',
      unit_conversion_types: [],
      has_dwm: false,
      force_session_rebuild: false,
      has_seconds: false,
      seconds_multipliers: [],
      has_daily: true,
      intraday_multipliers: ['1', '5', '15'],
      supported_resolution: DataFeed.configurationData.supported_resolutions,
      has_seconds_multipliers: false,
      has_intraday_multipliers: true,
      has_daily_multipliers: false,
      has_weekly_and_monthly_multipliers: false,
      visible_plots_set: 'ohlc',
      data_status: 'endofday',
      decimals,
      format: 'price'
    }

    closeSocket(this._connection)
    startSocket({ connection: this._connection, poolId: symbolName })

    console.log('[resolveSymbol]: Symbol resolved', symbolInfo)
    onSymbolResolvedCallback(symbolInfo)
  }

  public async getBars(
    symbolInfo: SymbolInfo,
    resolution: string,
    periodParams: { from: number; to: number; firstDataRequest: boolean },
    onHistoryCallback: (d: LightweightBar[], params?: any) => any,
    onErrorCallback: (error: any) => any
  ) {
    const { from, to, firstDataRequest } = periodParams
    console.log('[getBars]: Method call', symbolInfo, resolution, from, to, firstDataRequest)
    const timeUnit = ResolutionToSeconds[resolution as keyof typeof ResolutionToSeconds]
    try {
      const host = useLaunchpadStore.getState().historyHost
      nextPageKey = firstDataRequest ? undefined : nextPageKey
      if (!firstDataRequest && !nextPageKey) {
        onHistoryCallback([], {
          noData: true
        })
        return
      }

      const frame = DataFeed.configurationData.supported_resolutions.includes(resolution as any) ? `${resolution}m` : '5m'
      const { data } = await axios.get(
        `${host}/kline?poolId=${symbolInfo.poolId}&interval=${frame}&limit=300${nextPageKey ? `&nextPageKey=${nextPageKey}` : ''}`
      )
      const rows: TradeData[] = data.rows || []
      nextPageKey = data.nextPageKey
      if (!rows.length) {
        onHistoryCallback([], {
          noData: true
        })
        return
      }

      const bars: LightweightBar[] = []
      let currentBar: LightweightBar | undefined
      rows.forEach((bar) => {
        // if (bar.t >= from && bar.t < to) {
        const barTime = Math.floor(bar.t / timeUnit) * timeUnit
        if (currentBar && barTime * 1000 < currentBar.time) {
          // const diff = (currentBar.time - barTime * 1000) / 1000 / timeUnit
          bars.push(currentBar)
          // means no data between 2 bars, manually filled in
          // if (diff > 1) {
          //   for (let i = 1; i < diff; i++) {
          //     bars.push({
          //       time: currentBar.time - i * timeUnit * 1000,
          //       low: bar.c,
          //       high: bar.c,
          //       open: bar.c,
          //       close: bar.c
          //     })
          //   }
          // }
          currentBar = undefined
        }

        if (!currentBar) {
          currentBar = {
            time: barTime * 1000,
            low: Math.min(bar.o, bar.l, bar.h, bar.c),
            high: Math.max(bar.o, bar.l, bar.h, bar.c),
            open: bar.o,
            close: bar.c
          }
          return
        }
        currentBar = {
          ...currentBar,
          close: bar.c,
          low: Math.min(bar.l, currentBar.low),
          high: Math.max(bar.h, currentBar.high)
        }
        // }
      })
      if (currentBar) bars.push(currentBar)
      if (bars.length === 1) {
        bars[0].open = Math.min(initPoolPriceDecimal, bars[0].open)
        bars[0].low = Math.min(initPoolPriceDecimal, bars[0].low)
      }

      if (firstDataRequest) {
        lastBarsCache.set(symbolInfo.poolId, {
          ...bars[0]
        })
      }
      console.log(
        `[getBars]: returned ${bars.length} bar(s)`,
        bars.map((b) => ({ ...b, time: new Date(b.time) }))
      )
      onHistoryCallback([...bars].reverse(), {
        noData: false
      })
    } catch (error) {
      console.log('[getBars]: Get error', error)
      onErrorCallback(error)
    }
  }

  public subscribeBars(
    symbolInfo: SymbolInfo,
    resolution: string,
    onRealtimeCallback: any,
    subscriberUID: string,
    onResetCacheNeededCallback: any
  ) {
    if (symbolInfo.exchange === 'birdeye') {
      console.log('[subscribeBars]: birdeye pool, not subscribe')
      return
    }
    console.log('[subscribeBars]: Method call with subscriberUID:', subscriberUID)
    subscribeOnStream({
      symbolInfo,
      resolution,
      onRealtimeCallback,
      subscriberUID,
      onResetCacheNeededCallback,
      curveType: this._curveType ?? 0,
      mintBDecimals: this._mintBInfo?.decimals,
      lastDailyBar: lastBarsCache.get(symbolInfo.poolId)
    })
  }

  public unsubscribeBars(subscriberUID: string) {
    console.log('[unsubscribeBars]: Method call with subscriberUID:', subscriberUID)
    unsubscribeFromStream(subscriberUID)
  }
}
