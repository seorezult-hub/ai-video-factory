import { describe, it, expect } from 'vitest'

describe('GET /api/health', () => {
  it('route module exports GET function', async () => {
    const mod = await import('@/app/api/health/route')
    expect(typeof mod.GET).toBe('function')
  })

  it('GET returns response with status "ok"', async () => {
    const { GET } = await import('@/app/api/health/route')
    const response = await GET()
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('ai-video-factory')
  })
})
