import { describe, it, expect } from 'vitest'

const DURATION_PARAMS: Record<string, { scenes: number; total: string }> = {
  "15-single": { scenes: 1, total: "15 seconds continuous, single shot" },
  "15-30": { scenes: 3, total: "15–30 seconds" },
  "30-45": { scenes: 5, total: "30–45 seconds" },
  "45-60": { scenes: 7, total: "45–60 seconds" },
}

function resolveDuration(key: string | undefined): { scenes: number; total: string } {
  return DURATION_PARAMS[key ?? "30-45"] ?? DURATION_PARAMS["30-45"]
}

describe('DURATION_PARAMS', () => {
  it('"15-single" → { scenes: 1 }', () => {
    expect(resolveDuration("15-single").scenes).toBe(1)
  })

  it('"15-30" → { scenes: 3 }', () => {
    expect(resolveDuration("15-30").scenes).toBe(3)
  })

  it('"30-45" → { scenes: 5 }', () => {
    expect(resolveDuration("30-45").scenes).toBe(5)
  })

  it('"45-60" → { scenes: 7 }', () => {
    expect(resolveDuration("45-60").scenes).toBe(7)
  })

  it('unknown key → fallback "30-45" → { scenes: 5 }', () => {
    expect(resolveDuration("unknown-key").scenes).toBe(5)
  })

  it('undefined key → fallback "30-45" → { scenes: 5 }', () => {
    expect(resolveDuration(undefined).scenes).toBe(5)
  })
})
