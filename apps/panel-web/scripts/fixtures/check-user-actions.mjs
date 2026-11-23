import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkUserActions(page, origin, output, width) {
  const writes = []
  const newName = 'review_kate'
  const rejectName = 'anna'
  const row = (name) => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })
  const dialog = page.getByRole('dialog')
  const capture = (state) => page.screenshot({ path: join(output, width + '-users-' + state + '.png'), animations: 'disabled', caret: 'hide' })
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname
    if (path.startsWith('/api/users') && req.method() !== 'GET') writes.push({ method: req.method(), path, body: req.postDataJSON() })
  })
  await page.goto(origin + '/users')
  await row('alex_dev').waitFor()
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await dialog.locator('input[name="username"]').fill(newName)
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click()
  await row(newName).waitFor()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].body.username, newName)
  await capture('created')
  await row(newName).getByRole('button', { name: 'Действия с ' + newName }).click()
  await page.getByRole('menuitem', { name: 'Отключить', exact: true }).click()
  await dialog.waitFor()
  assert.equal(writes.length, 1)
  await capture('row-confirm')
  await dialog.getByRole('button', { name: 'Отключить', exact: true }).click()
  await row(newName).getByText('Отключён', { exact: true }).waitFor()
  assert.equal(writes[1].method, 'PUT')
  assert.match(writes[1].path, /^\/api\/users\/[a-f0-9-]+$/)
  assert.deepEqual(writes[1].body, { status: 'disabled' })
  for (const name of ['alex_dev', rejectName]) await row(name).getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Отключить', exact: true }).click()
  await dialog.getByRole('button', { name: 'Отключить', exact: true }).click()
  await page.getByText(/Не вышло у 1: anna: USER_CHANGED/).waitFor()
  await row('alex_dev').getByText('Отключён', { exact: true }).waitFor()
  assert.deepEqual(writes[2], { method: 'POST', path: '/api/users/bulk', body: { userIds: ['sample-4a7c19', 'sample-9b2e77'], action: 'disable' } })
  assert.equal(await row(rejectName).getByRole('checkbox').isChecked(), true)
  assert.equal(await row('alex_dev').getByRole('checkbox').isChecked(), false)
  await capture('partial')
  return { created: newName, rowStatus: 'disabled', bulk: { requested: 2, succeeded: 1, failed: rejectName }, writes: writes.map(({ method, path }) => ({ method, path })) }
}
