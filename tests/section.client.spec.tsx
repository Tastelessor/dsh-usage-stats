// @vitest-environment jsdom
/** Placeholder section renders its copy. */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UsageStatsSection } from '../src/client/UsageStatsSection.tsx'

describe('UsageStatsSection', () => {
  it('renders the placeholder text', () => {
    render(<UsageStatsSection placeholder="用量统计（开发中）" />)
    expect(screen.getByText('用量统计（开发中）')).toBeTruthy()
  })
})
