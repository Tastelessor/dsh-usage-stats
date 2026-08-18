/** Model price table: per-currency × per-period (peak/off-peak) prices, inline editing, save-back. */
import { useState } from 'react'
import type { Currency, ModelPrice, ModelPriceRow, Tier, TieredModelPrice, UnpricedModel } from '../shared/types.ts'

export interface PriceTableProps {
  models: readonly ModelPriceRow[]
  unpricedModels: readonly UnpricedModel[]
  /** Preferred currency; seeds the edit toggle. */
  currency: Currency
  t: (key: string) => any
  /** Persist the edited prices for one currency (both tiers); resolves after the settings write. */
  onSavePrices: (currency: Currency, prices: Record<string, TieredModelPrice>) => Promise<void>
}

const SYMBOL: Record<Currency, string> = { CNY: '¥', USD: '$' }
const CURRENCIES: readonly Currency[] = ['CNY', 'USD']
const TIERS: readonly Tier[] = ['peak', 'offPeak']

const ZERO: ModelPrice = { inputPerM: 0, cacheReadPerM: 0, outputPerM: 0, cacheWritePerM: 0 }
/** Shown/edited placeholder while a model has no configured price in the selected currency. */
const EMPTY_TIERED: TieredModelPrice = { peak: { ...ZERO }, offPeak: { ...ZERO } }

/** Turn a price row's number cell into an editable input. */
function PriceInput({ value, onChange, saving }: {
  value: number | null
  onChange: (value: number) => void
  saving: boolean
}): JSX.Element {
  const [text, setText] = useState(value === null ? '' : String(value))
  return (
    <input
      className="price-input"
      type="number"
      min={0}
      step="any"
      disabled={saving}
      value={text}
      placeholder="—"
      onChange={(event) => {
        setText(event.target.value)
        const parsed = Number(event.target.value)
        if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed)
      }}
    />
  )
}

/** Render one row per catalog model with a per-currency × per-period editor. */
export function PriceTable({ models, unpricedModels, currency, t, onSavePrices }: PriceTableProps): JSX.Element {
  const [editCurrency, setEditCurrency] = useState<Currency>(currency)
  const [editTier, setEditTier] = useState<Tier>('offPeak')
  const [drafts, setDrafts] = useState<Record<Currency, Record<string, TieredModelPrice>>>({ CNY: {}, USD: {} })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tieredOf = (row: ModelPriceRow): TieredModelPrice | null => editCurrency === 'CNY' ? row.cny : row.usd
  /** Complete tiered price as edited (or resolved, or empty when unconfigured). */
  const draftOf = (row: ModelPriceRow): TieredModelPrice =>
    drafts[editCurrency][row.model] ?? tieredOf(row) ?? EMPTY_TIERED
  const setDraft = (row: ModelPriceRow, patch: Partial<ModelPrice>): void => {
    setDrafts(d => {
      const currencyDrafts = d[editCurrency] ?? {}
      const base = currencyDrafts[row.model] ?? tieredOf(row) ?? EMPTY_TIERED
      return {
        ...d,
        [editCurrency]: {
          ...currencyDrafts,
          [row.model]: { ...base, [editTier]: { ...base[editTier], ...patch } },
        },
      }
    })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await onSavePrices(editCurrency, drafts[editCurrency])
      setDrafts(d => ({ ...d, [editCurrency]: {} }))
    } catch {
      setError(String(t('priceSaveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="price-table-wrap">
      <div className="price-table-head">
        <div className="price-table-title">{t('priceTableTitle')}</div>
        <div className="price-currency-toggle">
          {CURRENCIES.map(c => (
            <button key={c} className={editCurrency === c ? 'currency-btn active' : 'currency-btn'}
              onClick={() => setEditCurrency(c)}>
              {SYMBOL[c]} {c}
            </button>
          ))}
          {TIERS.map(tier => (
            <button key={tier} className={editTier === tier ? 'currency-btn active' : 'currency-btn'}
              onClick={() => setEditTier(tier)}>
              {t(tier === 'peak' ? 'priceTierPeak' : 'priceTierOffPeak')}
            </button>
          ))}
        </div>
      </div>
      <div className="price-peak-hint">{t('peakHint')}</div>
      {models.length === 0 && unpricedModels.length === 0
        ? <div className="price-empty">{t('empty')}</div>
        : (
          <table className="price-table">
            <thead>
              <tr>
                <th>{t('priceModel')}</th>
                <th>{t('priceCacheRead')}</th>
                <th>{t('priceInput')}</th>
                <th>{t('priceOutput')}</th>
              </tr>
            </thead>
            <tbody>
              {models.map(row => {
                const draft = draftOf(row)
                const tier = draft[editTier]
                const hasDraft = drafts[editCurrency][row.model] !== undefined
                return (
                  <tr key={`${row.provider}/${row.model}`} className={hasDraft ? 'price-row-editing' : undefined}>
                    <td>{row.name}</td>
                    <td><PriceInput key={`${editCurrency}/${editTier}/cacheRead`} value={tieredOf(row) !== null ? tier.cacheReadPerM : null} saving={saving} onChange={v => setDraft(row, { cacheReadPerM: v })} /></td>
                    <td><PriceInput key={`${editCurrency}/${editTier}/input`} value={tieredOf(row) !== null ? tier.inputPerM : null} saving={saving} onChange={v => setDraft(row, { inputPerM: v })} /></td>
                    <td><PriceInput key={`${editCurrency}/${editTier}/output`} value={tieredOf(row) !== null ? tier.outputPerM : null} saving={saving} onChange={v => setDraft(row, { outputPerM: v })} /></td>
                  </tr>
                )
              })}
              {unpricedModels.map(row => (
                <tr key={`used/${row.provider}/${row.model}`}>
                  <td>{row.model}</td>
                  <td>{t('priceNotConfigured')}</td>
                  <td>{t('priceNotConfigured')}</td>
                  <td>{t('priceNotConfigured')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <div className="price-actions">
        <button className="price-save" disabled={saving} onClick={() => void save()}>
          {saving ? t('priceSaving') : t('priceSave')}
        </button>
        {error !== null && <span className="price-error">{error}</span>}
        <span className="price-edit-hint">{t('priceEditHint')}</span>
      </div>
      {unpricedModels.length > 0 && <div className="price-hint">{t('unpricedHint')(unpricedModels.length)}</div>}
    </div>
  )
}