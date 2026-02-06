import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Binance WebSocket hook for real-time crypto price data.
 * Connects to the 24hr mini-ticker stream for a given symbol.
 * 
 * @param {string|null} symbol - Binance symbol in lowercase, e.g. "btcusdt". Null to disconnect.
 * @returns {{ price, priceChange, volume24h, high24h, low24h, connected, error }}
 */
export function useBinanceWebSocket(symbol) {
  const [price, setPrice] = useState(0)
  const [priceChange, setPriceChange] = useState(0)
  const [volume24h, setVolume24h] = useState(0)
  const [high24h, setHigh24h] = useState(0)
  const [low24h, setLow24h] = useState(0)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)

  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 5

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.onclose = null // Prevent reconnect on intentional close
      wsRef.current.close()
      wsRef.current = null
    }
    setConnected(false)
  }, [])

  useEffect(() => {
    if (!symbol) {
      cleanup()
      setPrice(0)
      return
    }

    const connect = () => {
      cleanup()

      // Use the individual mini-ticker stream for efficient single-symbol updates
      // This gives: price, 24h change, volume, high, low — updated every ~1s
      const url = `wss://stream.binance.com:9443/ws/${symbol}@miniTicker`

      try {
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          setConnected(true)
          setError(null)
          reconnectAttempts.current = 0
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            // miniTicker fields: c=close, o=open, h=high, l=low, v=volume, q=quoteVolume
            if (data.c) setPrice(parseFloat(data.c))
            if (data.o && data.c) {
              const open = parseFloat(data.o)
              const close = parseFloat(data.c)
              setPriceChange(open > 0 ? ((close - open) / open) * 100 : 0)
            }
            if (data.q) setVolume24h(parseFloat(data.q))
            if (data.h) setHigh24h(parseFloat(data.h))
            if (data.l) setLow24h(parseFloat(data.l))
          } catch (e) {
            // Ignore parse errors on individual messages
          }
        }

        ws.onerror = () => {
          setError("WebSocket connection error")
          setConnected(false)
        }

        ws.onclose = (event) => {
          setConnected(false)
          // Auto-reconnect with exponential backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
            reconnectAttempts.current++
            reconnectTimeoutRef.current = setTimeout(connect, delay)
          } else {
            setError("Max reconnection attempts reached")
          }
        }
      } catch (e) {
        setError(e.message)
      }
    }

    connect()

    return cleanup
  }, [symbol, cleanup])

  return { price, priceChange, volume24h, high24h, low24h, connected, error }
}
