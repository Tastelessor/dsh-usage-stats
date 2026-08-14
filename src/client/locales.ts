/** Copy dictionaries for the usage-stats settings section. */
export const zh = {
  nav: '用量统计',
  placeholder: '用量统计（开发中）',
} as const

export const en = {
  nav: 'Usage Stats',
  placeholder: 'Usage Stats (in progress)',
} as const

export type UsageStatsKey = keyof typeof zh
