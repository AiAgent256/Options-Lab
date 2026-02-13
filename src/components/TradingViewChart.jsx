import React, { useEffect, useRef, memo } from 'react'

/**
 * TradingView Advanced Chart Widget.
 * Embeds the full interactive chart with indicators, drawing tools, and real-time data.
 * Uses the free TradingView widget — no API key required.
 * 
 * @param {string} symbol - TradingView symbol string, e.g. "BINANCE:BTCUSDT" or "NASDAQ:MSTR"
 */
function TradingViewChart({ symbol = "BINANCE:BTCUSDT" }) {
  const containerRef = useRef(null)
  const scriptRef = useRef(null)

  useEffect(() => {
    // Clean up previous widget
    if (containerRef.current) {
      containerRef.current.innerHTML = ""
    }

    // Create the widget container div that TradingView expects
    const widgetContainer = document.createElement("div")
    widgetContainer.className = "tradingview-widget-container__widget"
    widgetContainer.style.height = "100%"
    widgetContainer.style.width = "100%"
    containerRef.current.appendChild(widgetContainer)

    // Load the TradingView embed script
    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    script.type = "text/javascript"
    script.async = true
    containerRef.current.appendChild(script)

    // Configuration goes in a separate application/json script tag
    const configScript = document.createElement("script")
    configScript.type = "application/json"
    configScript.textContent = JSON.stringify({
      symbol: symbol,
      autosize: true,
      theme: "dark",
      style: "1",
      backgroundColor: "rgba(10, 12, 16, 1)",
      gridColor: "rgba(26, 29, 40, 0.6)",
      timezone: "Etc/UTC",
      interval: "60",
      range: "3M",
      allow_symbol_change: true,
      save_image: true,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      hide_legend: false,
      studies: [
        "STD;Bollinger_Bands",
        "STD;Volume",
      ],
      withdateranges: true,
      details: true,
      hotlist: false,
      calendar: false,
      show_popup_button: true,
      popup_width: "1000",
      popup_height: "650",
    })
    containerRef.current.appendChild(configScript)

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = ""
      }
    }
  }, [symbol])

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{
        height: "100%",
        width: "100%",
        overflow: "hidden",
        background: "#0a0c10",
      }}
    />
  )
}

// Memo to prevent re-renders when parent state changes (only re-render on symbol change)
export default memo(TradingViewChart)
