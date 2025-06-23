import { useEffect, useMemo, useState, useRef } from 'react'
import { Themes, AppTheme, AppColorMode } from './TvTheme'
import { Box, useColorMode } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { closeSocket, setArrowListener } from './streaming'
import { useTradingViewStore } from '@/store/useTradingViewStore'
import { getSavedResolution } from './utils'
import { useAppStore, useLaunchpadStore } from '@/store'
import { formatCurrency } from '@/utils/numberish/formatter'
import { isEmpty } from 'lodash'
import axiosInstance from '@/api/axios'
import { Subject } from 'rxjs'
import { MintInfo } from '@/features/Launchpad/type'
import { ApiV3Token } from '@raydium-io/raydium-sdk-v2'
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  TickMarkType,
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CandlestickData,
  HistogramData
} from 'lightweight-charts'
import dayjs from 'dayjs'
import { ResolutionToSeconds } from './type'

export const refreshChartSubject = new Subject<string>()

// Data adapters for lightweight-charts
interface LightweightBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

// Data fetching functions
async function fetchChartData(
  poolId: string,
  resolution: string,
  from: number,
  to: number,
  birdeye: boolean,
  mintInfo?: MintInfo,
  mintBInfo?: ApiV3Token
): Promise<LightweightBar[]> {
  const timeUnit = ResolutionToSeconds[resolution as keyof typeof ResolutionToSeconds]

  if (birdeye) {
    // Birdeye data fetching
    const frame = timeUnit >= ResolutionToSeconds['1D'] ? resolution : timeUnit <= ResolutionToSeconds['15'] ? `${resolution}m` : '15m'
    const isMarketCap = mintInfo && poolId.includes('marketcap')
    const quoteAddress = isMarketCap ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : poolId.split('_')[1]

    const { data } = await axiosInstance.get(
      `https://birdeye-proxy.raydium.io/defi/ohlcv/base_quote?base_address=${poolId.split('_')[0]}&quote_address=${quoteAddress}&type=${frame}&time_from=${from}&time_to=${to}`
    )

    if (!data?.items?.length) return []

    const bars: LightweightBar[] = []
    let currentBar: LightweightBar | undefined

    data.items.forEach((bar: any) => {
      if (bar.unixTime >= from && bar.unixTime < to) {
        const barTime = Math.floor(bar.unixTime / timeUnit) * timeUnit
        if (currentBar && barTime * 1000 > currentBar.time) {
          bars.push(currentBar)
          currentBar = undefined
        }

        const multiplier = isMarketCap ? mintInfo!.supply : 1
        if (!currentBar) {
          currentBar = {
            time: barTime * 1000,
            low: bar.l * multiplier,
            high: bar.h * multiplier,
            open: bar.o * multiplier,
            close: bar.c * multiplier,
            volume: bar.vQuote
          }
          return
        }
        currentBar = {
          ...currentBar,
          volume: (currentBar.volume || 0) + (bar.vQuote || 0),
          close: bar.c * multiplier,
          low: Math.min(bar.l * multiplier, currentBar.low),
          high: Math.max(bar.h * multiplier, currentBar.high)
        }
      }
    })
    if (currentBar) bars.push(currentBar)
    return bars
  } else {
    // Regular data fetching
    const host = useLaunchpadStore.getState().historyHost
    const frame = ResolutionToSeconds[resolution as keyof typeof ResolutionToSeconds] ? `${resolution}m` : '5m'

    const { data } = await axiosInstance.get(
      `${host}/kline?poolId=${poolId}&interval=${frame}&limit=300`
    )

    const rows = data.rows || []
    if (!rows.length) return []

    const bars: LightweightBar[] = []
    let currentBar: LightweightBar | undefined

    rows.forEach((bar: any) => {
      const barTime = Math.floor(bar.t / timeUnit) * timeUnit
      if (currentBar && barTime * 1000 < currentBar.time) {
        bars.push(currentBar)
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
    })
    if (currentBar) bars.push(currentBar)
    return bars
  }
}

export default function TVChart({
  poolId,
  height = '100%',
  id = 'tv-chart',
  birdeye,
  mintInfo,
  mintBInfo,
  curveType,
  needRefresh
}: {
  poolId?: string
  mint?: string
  height?: string
  id?: string
  birdeye?: boolean
  mintInfo?: MintInfo
  mintBInfo?: ApiV3Token
  curveType?: number
  needRefresh?: boolean
}) {
  const { colorMode } = useColorMode()
  const connection = useAppStore((s) => s.connection)
  const [reloadChartTag, setReloadChartTag] = useState(0)
  const [refreshChartMint, setRefreshChartMint] = useState('')
  const appTheme = colorMode === 'light' ? AppTheme.Light : AppTheme.Dark
  const appColorMode = AppColorMode.GreenUp
  const theme = Themes[appTheme][appColorMode]
  const { i18n } = useTranslation()
  const locale = i18n.language === 'zh-CN' ? 'zh' : i18n.language

  const updateChartConfig = useTradingViewStore((s) => (birdeye ? s.updateBirdeyeChartConfig : s.updateChartConfig))
  const savedTvChartConfig = useTradingViewStore((s) => (birdeye ? s.birdeyeChartConfig : s.chartConfig))
  const savedResolution = useMemo(() => getSavedResolution({ savedConfig: savedTvChartConfig }), [savedTvChartConfig])

  const isNeedRefreshData = needRefresh || (refreshChartMint && refreshChartMint === mintInfo?.mint)

  // Chart refs
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<{ chart?: IChartApi; candle?: ISeriesApi<'Candlestick'>; volume?: ISeriesApi<'Histogram'> }>({})
  const lastBarRef = useRef<LightweightBar | null>(null)

  useEffect(() => {
    refreshChartSubject.asObservable().subscribe((mint: string) => {
      setRefreshChartMint(mint)
    })
  }, [])

  useEffect(() => {
    if (!poolId || birdeye || !isNeedRefreshData || !connection) return

    const checkData = async () => {
      try {
        const { data } = await axiosInstance.get(`${useLaunchpadStore.getState().historyHost}/kline?poolId=${poolId}&interval=1m&limit=1`)
        return data.rows.length > 0
      } catch {
        return false
      }
    }

    let count = 0
    const interval = window.setInterval(() => {
      checkData().then((r) => {
        console.log('hasData:', r)
        if (r || count++ >= 15) {
          window.clearInterval(interval)
          setReloadChartTag(Date.now())
        }
      })
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [birdeye, isNeedRefreshData, poolId, connection])

  useEffect(() => {
    if (!connection || !poolId || !chartContainerRef.current) return

    // Clean up previous chart
    if (chartRef.current.chart) {
      chartRef.current.chart.remove()
      chartRef.current = {}
    }

    const chartTextColor = theme.textPrimary
    const axisColor = theme.layer1
    const volumeColor = colorMode === 'light' ? '#7191FF4d' : '#7081943e'
    const upColor = theme.positive
    const downColor = theme.negative
    const crosshairColor = theme.textPrimary

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        textColor: chartTextColor,
        background: { type: ColorType.Solid, color: theme.layer0 },
        fontFamily: 'Space Grotesk'
      },
      grid: {
        vertLines: { color: axisColor },
        horzLines: { color: axisColor }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: crosshairColor },
        horzLine: { color: crosshairColor }
      },
      autoSize: true,
      rightPriceScale: { borderColor: axisColor },
      timeScale: {
        borderColor: axisColor,
        tickMarkFormatter: (time: number, tickMarkType: TickMarkType) => {
          if (tickMarkType === 0)
            return dayjs(time * 1000).utc().format('YYYY/M')
          if (tickMarkType < 3)
            return dayjs(time * 1000).utc().format('M/D')
          return dayjs(time * 1000).utc().format('H:mm')
        }
      }
    })

    // Add candlestick series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
      priceLineVisible: true,
      priceFormat: {
        type: 'custom',
        formatter: (val: number) => {
          return val ? formatCurrency(val, { maximumDecimalTrailingZeroes: 5 }) : val
        },
        minMove: 10 / Math.pow(10, Number(mintInfo?.decimals) ?? 2)
      }
    })

    candlestickSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.1,
        bottom: 0.1
      }
    })

    // Add volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: volumeColor,
      priceFormat: {
        type: 'volume'
      },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false
    })

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.7,
        bottom: 0
      }
    })

    chart.timeScale().applyOptions({
      timeVisible: true
    })

    // Store refs
    chartRef.current.chart = chart
    chartRef.current.candle = candlestickSeries
    chartRef.current.volume = volumeSeries

    // Load initial data
    const loadData = async () => {
      const resolution = savedResolution || (birdeye ? '15' : '5')
      const now = Date.now()
      const from = Math.floor((now - (24 * 60 * 60 * 1000)) / 1000) // 24 hours ago, converted to seconds and floored
      const to = Math.floor(now / 1000) // Current time, converted to seconds and floored

      try {
        const bars = await fetchChartData(poolId, resolution, from, to, birdeye || false, mintInfo, mintBInfo)
        if (bars.length > 0) {
          candlestickSeries.setData(bars as any)
          volumeSeries.setData(bars.map(bar => ({ time: bar.time, value: bar.volume || 0 })) as any)
          lastBarRef.current = bars[bars.length - 1]
        }
      } catch (error) {
        console.error('Failed to load chart data:', error)
      }
    }

    loadData()

    // Set up real-time data streaming for non-birdeye charts
    if (!birdeye) {
      setArrowListener((prev: any, next: any) => {
        if (!chartRef.current.candle || !lastBarRef.current) return

        const newBar: LightweightBar = {
          time: next.time,
          open: next.open,
          high: next.high,
          low: next.low,
          close: next.close
        }

        chartRef.current.candle.update({
          ...newBar,
          time: newBar.time as any
        })
        lastBarRef.current = newBar
      })
    }

    // Save chart configuration
    const saveChartConfig = () => {
      const config = {
        resolution: savedResolution,
        theme: appTheme,
      }
      updateChartConfig(config)
    }

    // Auto-save configuration
    const autoSaveInterval = setInterval(saveChartConfig, 1000)

    return () => {
      clearInterval(autoSaveInterval)
      setArrowListener(undefined)
      if (chartRef.current.chart) {
        chartRef.current.chart.remove()
        chartRef.current = {}
      }
    }
  }, [poolId, birdeye, theme, connection, reloadChartTag, mintInfo?.mint, mintBInfo?.address, curveType, savedResolution, appTheme, updateChartConfig])

  useEffect(() => {
    if (connection) {
      return () => closeSocket(connection)
    }
  }, [connection])

  return <Box height={height} id={id} ref={chartContainerRef} />
}
