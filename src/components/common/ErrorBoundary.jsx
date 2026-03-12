import React from "react";
import { COLORS, FONTS } from "../../utils/constants";

/**
 * Error boundary that catches rendering errors in child components
 * and shows a fallback UI instead of a white screen.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (process.env.NODE_ENV === "development") {
      console.error("[ErrorBoundary]", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      const label = this.props.label || "Component";
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100%", minHeight: 200, padding: 32,
          background: COLORS.bg.primary, color: COLORS.text.muted,
          fontFamily: FONTS.mono, fontSize: 12,
        }}>
          <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.4 }}>⚠</div>
          <div style={{ marginBottom: 8, color: COLORS.negative.text }}>{label} encountered an error</div>
          <div style={{ fontSize: 10, color: COLORS.text.dim, maxWidth: 400, textAlign: "center", wordBreak: "break-word" }}>
            {this.state.error?.message || "Unknown error"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 16, padding: "6px 16px", fontSize: 11,
              fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 4,
              border: `1px solid ${COLORS.border.secondary}`,
              background: COLORS.bg.elevated, color: COLORS.text.secondary,
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
