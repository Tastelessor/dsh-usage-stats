/** Model price table: three displayed prices per model (per 1M tokens). */
import type { Currency, ModelPriceRow, UnpricedModel } from '../shared/types.ts'

export interface PriceTableProps {
  models: readonly ModelPriceRow[]
  unpricedModels: readonly UnpricedModel[]
  currency: Currency
  t: (key: string) => any
}

const SYMBOL: Record<Currency, string> = { CNY: '¥', USD: '$' }

/** Render one row per catalog model; unpriced cells show "未配置". */
export function PriceTable({ models, unpricedModels, currency, t }: PriceTableProps): JSX.Element {
  const money = (value: number | null): string => value === null ? t('priceNotConfigured') : `${SYMBOL[currency]}${value}`
  return (
    <div className="price-table-wrap">
      <div className="price-table-title">{t('priceTableTitle')}</div>
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
              {models.map(row => (
                <tr key={`${row.provider}/${row.model}`}>
                  <td>{row.name}</td>
                  <td>{money(row.cacheReadPerM)}</td>
                  <td>{money(row.inputPerM)}</td>
                  <td>{money(row.outputPerM)}</td>
                </tr>
              ))}
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
      {unpricedModels.length > 0 && <div className="price-hint">{t('unpricedHint')(unpricedModels.length)}</div>}
    </div>
  )
}
