/**
 * Usage-stats page styles as a self-contained module: exported CSS text plus
 * an idempotent injector, so the client bundle carries its own stylesheet
 * without any build-plugin magic. (A plain `import './usage-stats.css'`
 * builds, but rolldown emits the sheet as a sibling `lib/client.css` that no
 * loader/host ever serves — the runtime bundle would be unstyled.)
 */

export const css = `
.usage-stats { display: flex; flex-direction: column; gap: 16px; padding: 16px 0; }
.stats-toolbar { display: flex; gap: 8px; align-items: center; }
.range-btn, .series-btn { padding: 4px 10px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 6px; background: var(--dsw-surface-bg, #ffffff); color: var(--dsw-color-text, #1f2328); cursor: pointer; }
.range-btn.active, .series-btn.active { background: var(--dsw-color-accent, #2563eb); color: var(--dsw-color-text-inverse, #ffffff); border-color: var(--dsw-color-accent, #2563eb); }
.stats-summary { display: flex; gap: 16px; }
.summary-card { flex: 1; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; }
.summary-label { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); }
.summary-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
.series-switch { display: flex; gap: 6px; flex-wrap: wrap; }
.line-chart { border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 8px; }
.line-chart-title { font-size: 13px; color: var(--dsw-color-text-muted, #6e7781); margin-bottom: 4px; }
.price-table-wrap { border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; }
.price-table-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.price-table { border-collapse: collapse; width: 100%; }
.price-table th, .price-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--dsw-color-border, #d0d7de); font-size: 13px; }
.price-hint { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); margin-top: 8px; }
.stats-empty, .stats-error, .price-empty { color: var(--dsw-color-text-muted, #6e7781); padding: 24px 0; text-align: center; }
`

/** Style-tag identity (mirrors the harness loader's `data-plugin` convention). */
const TAG_ID = 'dsh-usage-stats'

/** Append the stylesheet once; no-ops when the tag is already present. */
export function injectUsageStatsCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = TAG_ID
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = css
  document.head.appendChild(tag)
}
