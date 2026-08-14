/** Model price table: per-currency prices (CNY/USD), inline editing, save-back. */
import { useState } from 'react'
import type { Currency, ModelPrice, ModelPriceRow, UnpricedModel } from '../shared/types.ts'

export interface PriceTableProps {
  models: readonly ModelPriceRow[]
  unpricedModels: readonly UnpricedModel[]
  /** Preferred currency; seeds the edit toggle. */
  currency: Currency
  t: (key: string) => any
  /** Persist the edited prices for one currency; resolves after the settings write. */
  onSavePrices: (currency: Currency, prices: Record<string, ModelPrice>) => Promise<void>
}

const SYMBOL: Record<Currency, string> = { CNY: '¥', USD: '$' }
const CURRENCIES: readonly Currency[] = ['CNY', 'USD']

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

/** Render one row per catalog model with a per-currency editor. */
export function PriceTable({ models, unpricedModels, currency, t, onSavePrices }: PriceTableProps): JSX.Element {
  const [editCurrency, setEditCurrency] = useState<Currency>(currency)
  const [drafts, setDrafts] = useState<Record<Currency, Record<string, ModelPrice>>>({ CNY: {}, USD: {} })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const priceOf = (row: ModelPriceRow): ModelPrice | null => editCurrency === 'CNY' ? row.cny : row.usd
  const draftOf = (row: ModelPriceRow): ModelPrice => drafts[editCurrency][row.model] ?? priceOf(row) ?? {
    inputPerM: 0, cacheReadPerM: 0, outputPerM: 0, cacheWritePerM: 0,
  }
  const setDraft = (row: ModelPriceRow, patch: Partial<ModelPrice>): void => {
    setDrafts(d => ({
      ...d,
      [editCurrency]: {
        ...d[editCurrency],
        [row.model]: { ...draftOf(row), ...patch },
      },
    }))
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
        </div>
      </div>
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
                const hasDraft = drafts[editCurrency][row.model] !== undefined
                return (
                  <tr key={`${row.provider}/${row.model}`} className={hasDraft ? 'price-row-editing' : undefined}>
                    <td>{row.name}</td>
                    <td><PriceInput key={`${editCurrency}/cacheRead`} value={priceOf(row)?.cacheReadPerM ?? null} saving={saving} onChange={v => setDraft(row, { cacheReadPerM: v })} /></td>
                    <td><PriceInput key={`${editCurrency}/input`} value={priceOf(row)?.inputPerM ?? null} saving={saving} onChange={v => setDraft(row, { inputPerM: v })} /></td>
                    <td><PriceInput key={`${editCurrency}/output`} value={priceOf(row)?.outputPerM ?? null} saving={saving} onChange={v => setDraft(row, { outputPerM: v })} /></td>
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
