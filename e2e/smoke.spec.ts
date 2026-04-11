import { test, expect } from '@playwright/test'

test('health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
})

test('главная страница загружается', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/AI Video Factory/)
  await expect(page.getByRole('link', { name: /Начать с ассетами/ })).toBeVisible()
})

test('неавторизованный /dashboard → редирект на /login', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

test('/register содержит форму регистрации', async ({ page }) => {
  await page.goto('/register')
  await expect(page.getByRole('button', { name: /Зарегистрироваться/ })).toBeVisible()
})

test('API /api/balances без auth → 401', async ({ request }) => {
  const res = await request.get('/api/balances')
  expect(res.status()).toBe(401)
})

test('API /api/generate/script/parse без auth → 401', async ({ request }) => {
  const res = await request.post('/api/generate/script/parse', {
    data: { videoDuration: '15-single' }
  })
  expect(res.status()).toBe(401)
})
