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
.range-btn, .currency-btn { padding: 4px 10px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 6px; background: var(--dsw-surface-bg, #ffffff); color: var(--dsw-color-text, #1f2328); cursor: pointer; }
.range-btn.active, .currency-btn.active { background: var(--dsw-color-accent, #2563eb); color: var(--dsw-color-text-inverse, #ffffff); border-color: var(--dsw-color-accent, #2563eb); }
.stats-summary { display: flex; gap: 16px; flex-wrap: wrap; }
.summary-card { flex: 1; min-width: 130px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; }
.summary-label { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); }
.summary-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
.heatmap-wrap { border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; position: relative; }
.heatmap-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.heatmap-title { font-size: 13px; font-weight: 600; }
.heatmap-legend { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-color-text-muted, #6e7781); }
.hm-swatch { width: 10px; height: 10px; border-radius: 2px; }
.heatmap-grid { display: grid; gap: 3px; }
.hm-month-label { font-size: 11px; font-weight: 600; color: var(--dsw-color-text-muted, #6e7781); align-self: end; padding: 0 2px 1px; }
.hm-weekday { font-size: 10px; color: var(--dsw-color-text-muted, #6e7781); text-align: center; align-self: center; }
.hm-cell { aspect-ratio: 1; border-radius: 3px; background: var(--dsw-color-border-faint, #ebecf0); }
.hm-l1 { background: rgba(37, 99, 235, 0.18); }
.hm-l2 { background: rgba(37, 99, 235, 0.38); }
.hm-l3 { background: rgba(37, 99, 235, 0.62); }
.hm-l4 { background: rgba(37, 99, 235, 0.9); }
.hm-today { outline: 1.5px solid var(--dsw-color-accent, #2563eb); outline-offset: 1px; }
.hm-tooltip { position: absolute; left: 8px; top: 40px; pointer-events: none; background: var(--dsw-surface-overlay, #ffffff); border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 6px; padding: 8px 10px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); white-space: nowrap; z-index: 20; display: flex; flex-direction: column; gap: 2px; }
.hm-tooltip-title { font-weight: 600; margin-bottom: 2px; }
.hm-tooltip-row { color: var(--dsw-color-text, #1f2328); }
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
