/**
 * Shared UI styles — extracted from Portfolio and PokemonMarket.
 * Import as `import { S, pnlColor, blurStyle } from "../utils/styles"`.
 */
import { COLORS, FONTS } from "./constants";

export const S = {
  container: { padding: 24, maxWidth: 1400, margin: "0 auto", fontFamily: FONTS.mono, color: COLORS.text.primary },
  sectionTitle: {
    fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.2px",
    color: COLORS.text.dim, marginBottom: 12, display: "flex", alignItems: "center", gap: 8,
  },
  divider: { flex: 1, height: 1, background: COLORS.border.primary },
  card: {
    background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`,
    borderRadius: 6, overflow: "hidden",
  },
  summaryRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 },
  summaryCard: { padding: "14px 16px", background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`, borderRadius: 6 },
  cardLabel: { fontSize: 9, color: COLORS.text.dim, textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FONTS.ui },
  cardValue: { fontSize: 18, fontWeight: 600, marginTop: 4, fontFamily: FONTS.mono },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 11 },
  th: {
    padding: "10px 12px", textAlign: "left", fontSize: 9, color: COLORS.text.dim,
    textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${COLORS.border.secondary}`,
    background: COLORS.bg.elevated, position: "sticky", top: 0, fontFamily: FONTS.ui,
  },
  td: { padding: "10px 12px", borderBottom: `1px solid ${COLORS.border.primary}`, color: COLORS.text.secondary },
  btn: {
    padding: "5px 12px", fontSize: 10, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 4,
    border: `1px solid ${COLORS.border.secondary}`, background: COLORS.bg.elevated, color: COLORS.text.muted,
    transition: "all 0.15s",
  },
  btnPrimary: {
    padding: "5px 12px", fontSize: 10, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 4,
    border: `1px solid ${COLORS.accent.blueBorder}`, background: COLORS.accent.blueBg, color: COLORS.accent.blue,
  },
  btnDanger: {
    padding: "4px 8px", fontSize: 9, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 3,
    border: `1px solid ${COLORS.negative.border}`, background: COLORS.negative.bg, color: COLORS.negative.text,
  },
  btnSuccess: {
    padding: "4px 8px", fontSize: 9, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 3,
    border: `1px solid ${COLORS.positive.border}`, background: COLORS.positive.bg, color: COLORS.positive.text,
  },
  input: {
    background: COLORS.bg.input, border: `1px solid ${COLORS.border.secondary}`, color: COLORS.text.primary,
    padding: "5px 8px", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 11, outline: "none", width: "100%",
  },
  subtotalRow: {
    padding: "8px 12px", background: COLORS.bg.primary, borderTop: `1px solid ${COLORS.border.secondary}`,
    display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600,
  },
  badge: (color) => ({
    display: "inline-block", padding: "2px 6px", borderRadius: 3, fontSize: 8,
    fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
    background: color + "22", color: color, border: `1px solid ${color}44`,
  }),
  tooltip: {
    background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`,
    borderRadius: 6, padding: "8px 12px", fontSize: 10, fontFamily: FONTS.mono,
  },
};

export const pnlColor = (v) => v >= 0 ? COLORS.positive.text : COLORS.negative.text;
export const blurStyle = { filter: "blur(8px)", userSelect: "none", transition: "filter 0.2s" };
