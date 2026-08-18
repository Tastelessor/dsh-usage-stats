/**
 * Token-usage page styles as a self-contained module: exported CSS text plus
 * an idempotent injector, so the client bundle carries its own stylesheet
 * without any build-plugin magic. (A plain `import './token-usage.css'`
 * builds, but rolldown emits the sheet as a sibling `lib/client.css` that no
 * loader/host ever serves — the runtime bundle would be unstyled.)
 */

export const css = `
.token-usage { display: flex; flex-direction: column; gap: 16px; padding: 16px 0; }
.stats-toolbar { display: flex; gap: 8px; align-items: center; }
.range-btn, .series-btn, .currency-btn { padding: 4px 10px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 6px; background: var(--dsw-surface-bg, #ffffff); color: var(--dsw-color-text, #1f2328); cursor: pointer; }
.range-btn.active, .series-btn.active, .currency-btn.active { background: var(--dsw-color-accent, #2563eb); color: var(--dsw-color-text-inverse, #ffffff); border-color: var(--dsw-color-accent, #2563eb); }
.stats-summary { display: flex; gap: 16px; flex-wrap: wrap; }
.summary-card { flex: 1; min-width: 130px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; }
.summary-label { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); }
.summary-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
.series-switch { display: flex; gap: 6px; flex-wrap: wrap; }
.line-chart { border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 8px; }
.line-chart-title { font-size: 13px; color: var(--dsw-color-text-muted, #6e7781); margin-bottom: 4px; }
.chart-legend { display: flex; gap: 12px; font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); margin-bottom: 2px; }
.chart-legend-item { display: inline-flex; align-items: center; gap: 4px; }
.chart-legend-dot, .chart-tooltip-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.chart-body { position: relative; }
.chart-tooltip { position: absolute; transform: translate(-50%, -100%); pointer-events: none; background: var(--dsw-surface-overlay, #ffffff); border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 6px; padding: 6px 8px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); white-space: nowrap; z-index: 5; }
.chart-tooltip-date { font-weight: 600; margin-bottom: 2px; }
.chart-tooltip-row { display: flex; align-items: center; gap: 4px; }
.price-table-wrap { border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; }
.price-table-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.price-table-title { font-size: 13px; font-weight: 600; }
.price-currency-toggle { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.price-peak-hint { font-size: 11px; color: var(--dsw-color-text-muted, #6e7781); margin: -2px 0 6px; }
.price-table { border-collapse: collapse; width: 100%; }
.price-table th, .price-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--dsw-color-border, #d0d7de); font-size: 13px; }
.price-input { width: 88px; padding: 3px 6px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 4px; font-size: 12px; background: var(--dsw-surface-bg, #ffffff); color: var(--dsw-color-text, #1f2328); }
.price-row-editing td { background: var(--dsw-color-accent-faint, rgba(37, 99, 235, 0.06)); }
.price-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.price-save { padding: 4px 12px; border: 1px solid var(--dsw-color-accent, #2563eb); border-radius: 6px; background: var(--dsw-color-accent, #2563eb); color: var(--dsw-color-text-inverse, #ffffff); cursor: pointer; }
.price-save:disabled { opacity: 0.6; cursor: default; }
.price-error { font-size: 12px; color: var(--dsw-color-danger, #cf222e); }
.price-edit-hint { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); }
.price-hint { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); margin-top: 8px; }
.stats-empty, .stats-error, .price-empty { color: var(--dsw-color-text-muted, #6e7781); padding: 24px 0; text-align: center; }
`

/** Style-tag identity (mirrors the harness loader's `data-plugin` convention). */
const TAG_ID = 'dsh-token-usage'

/** Append the stylesheet once; no-ops when the tag is already present. */
export function injectTokenUsageCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = TAG_ID
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = css
  document.head.appendChild(tag)
}
