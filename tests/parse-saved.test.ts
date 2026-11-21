import { expect, test } from 'bun:test'
import { parseSaved } from '../src/frontend'

const ok = { tiles: [{ chatId: 'a-1', name: 'A' }, { chatId: 'b_2', name: 'B' }], live: 1, max: -1, col: 0.6, row: 0.4, wide: 'bottom' }

test('accepts a valid layout', () => {
  expect(parseSaved(ok)).toEqual(ok as never)
})

test('rejects bad shapes', () => {
  for (const bad of [null, 'x', {}, { tiles: [] }, { tiles: [ok.tiles[0]] }, { tiles: [...ok.tiles, ...ok.tiles, ok.tiles[0]] }]) {
    expect(parseSaved(bad)).toBeNull()
  }
})

test('rejects unsafe or duplicate chat ids', () => {
  expect(parseSaved({ ...ok, tiles: [{ chatId: '../x' }, ok.tiles[1]] })).toBeNull()
  expect(parseSaved({ ...ok, tiles: [ok.tiles[0], ok.tiles[0]] })).toBeNull()
})

test('clamps numbers and enums to safe defaults', () => {
  const p = parseSaved({ ...ok, live: 9, max: 1.5, col: 2, row: 'x', wide: 'left', tiles: [{ chatId: 'a', name: 5 }, { chatId: 'b', name: 'x'.repeat(300) }] })!
  expect([p.live, p.max, p.col, p.row, p.wide]).toEqual([-1, -1, 0.5, 0.5, 'top'])
  expect(p.tiles[0].name).toBe('Chat')
  expect(p.tiles[1].name.length).toBe(200)
})
