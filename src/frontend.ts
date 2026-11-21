import type { SpindleFrontendContext, SpindleAppMountHandle, SpindleGroupedRecentChat } from 'lumiverse-spindle-types'

// Each extra chat is a same-origin <iframe src="/chat/<id>"> running a full Lumiverse (docs/PLAN.md §1).
// This bundle runs in the top page ("host mode") and inside every tile frame ("frame mode").

const FRAME_PREFIX = 'lumi-tile:'
const MAX_TILES = 4
const MIN_W = 320
const MIN_H = 240

interface Tile { id: string; chatId: string; name: string }
interface TileEls { tile: HTMLElement; frame: HTMLIFrameElement; add: HTMLButtonElement; flip: HTMLButtonElement; makeWide: HTMLButtonElement; max: HTMLButtonElement; off: () => void }
interface Saved { tiles: { chatId: string; name: string }[]; live: number; max: number; col: number; row: number; wide: 'top' | 'bottom' }

const SETTINGS_KEY = 'tile:layout' // must be module:name (quirks §5.1)
const LOCAL_KEY = 'lumi_tile:layout'

const ICON = {
  max: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  restore: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  flip: '<path d="M8 4v16M8 4L4 8M8 4l4 4M16 20V4M16 20l-4-4M16 20l4-4"/>',
  wide: '<rect x="3" y="7" width="18" height="10" rx="2"/>',
}
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`

export function setup(ctx: SpindleFrontendContext) {
  return window.name.startsWith(FRAME_PREFIX) ? setupFrame(ctx) : setupHost(ctx)
}

// ── Frame mode: hide the app drawer, leave ChatView alone ──
function setupFrame(ctx: SpindleFrontendContext) {
  return ctx.dom.addStyle('div:has(> div > [data-spindle-mount="sidebar"]){display:none!important}')
}

// ── Host mode ──
function setupHost(ctx: SpindleFrontendContext) {
  if (matchMedia('(pointer: coarse)').matches) return // desktop only (PLAN §7)

  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
  const action = ctx.ui.registerInputBarAction({
    id: 'tile_chat',
    label: 'Tile another chat',
    subtitle: isLocal ? 'Show a second chat beside this one' : 'Only works when Lumiverse runs on this computer',
    enabled: isLocal,
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/></svg>',
  })

  const removeStyle = ctx.dom.addStyle(CSS)
  let tiles: Tile[] = []
  let liveId = ''
  let col = 0.5 // left column share
  let row = 0.5 // top row share (3 and 4 tiles)
  let wide: 'top' | 'bottom' = 'top' // where the wide tile (tiles[0]) sits with 3 tiles
  let mount: SpindleAppMountHandle | null = null
  let grid: HTMLElement | null = null
  let maxId = '' // tile shown full screen, '' for none
  const els = new Map<string, TileEls>()
  let followTimer = 0
  let saveTimer = 0
  let loaded = false // never save before the saved layout has been read (quirks §5.3)

  action.onClick(() => void openPicker())
  window.addEventListener('pagehide', flushSave)
  void loadLayout()

  // ── Persistence: account settings + localStorage, each stamped { at, data }, newest wins ──
  async function loadLayout() {
    const stamped: { at: number; data: unknown }[] = []
    try { stamped.push(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null')) } catch {}
    try { stamped.push((await ctx.settings?.get(SETTINGS_KEY)) as never) } catch {}
    const best = stamped.filter((s) => s && typeof s.at === 'number').sort((a, b) => b.at - a.at)[0]
    loaded = true
    const data = parseSaved(best?.data)
    if (!data || !isLocal || !multiTabAllowed() || tiles.length) return
    // Drop chats deleted since the layout was saved.
    // getMessages is in the host but not the published types (quirks §1); without it, keep every chat.
    const getMessages = (ctx.chats as unknown as { getMessages?: (id: string, o: { limit: number }) => Promise<unknown> }).getMessages?.bind(ctx.chats)
    const alive = await Promise.all(data.tiles.map((t) => getMessages ? getMessages(t.chatId, { limit: 1 }).then(() => true, () => false) : true))
    const kept = data.tiles.map((t, i) => ({ ...t, id: uid(), i })).filter((t) => alive[t.i])
    if (kept.length < 2 || tiles.length) return save()
    tiles = kept.map(({ id, chatId, name }) => ({ id, chatId, name }))
    liveId = kept.find((t) => t.i === data.live)?.id ?? tiles[0].id
    maxId = kept.find((t) => t.i === data.max)?.id ?? ''
    col = data.col
    row = data.row
    wide = data.wide
    render()
  }

  function save() {
    if (!loaded) return
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(flushSave, 400)
  }

  function flushSave() {
    if (!loaded || !saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = 0
    const data: Saved | null = tiles.length < 2 ? null : {
      tiles: tiles.map(({ chatId, name }) => ({ chatId, name })),
      live: tiles.findIndex((t) => t.id === liveId),
      max: tiles.findIndex((t) => t.id === maxId),
      col, row, wide,
    }
    const stamped = { at: Date.now(), data }
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(stamped)) } catch {}
    ctx.settings?.set(SETTINGS_KEY, stamped).catch(() => {})
  }

  async function openPicker() {
    if (!multiTabAllowed()) return showSingleTabNotice()
    if (tiles.length >= MAX_TILES) return
    const modal = ctx.ui.showModal({ title: 'Tile another chat', width: 420, maxHeight: 520 })
    const box = document.createElement('div')
    box.className = 'lt-pick'
    box.innerHTML = '<input class="lt-search" type="search" placeholder="Search characters" aria-label="Search characters"><div class="lt-list" role="list"></div>'
    modal.root.appendChild(box)
    const search = box.querySelector('input')!
    const list = box.querySelector('.lt-list') as HTMLElement
    let req = 0

    const load = async () => {
      const mine = ++req
      let rows: SpindleGroupedRecentChat[] = []
      try {
        rows = (await ctx.chats.listRecentGrouped?.({ limit: 40, search: search.value.trim() || undefined }))?.data ?? []
      } catch (err) {
        list.textContent = `Couldn't load chats: ${String(err)}`
        return
      }
      if (mine !== req) return
      const open = new Set([...tiles.map((t) => t.chatId), ctx.getActiveChat().chatId])
      rows = rows.filter((r) => !open.has(r.latest_chat_id))
      list.replaceChildren(...rows.map((r) => pickRow(r, () => { modal.dismiss(); void addChat(r) })))
      if (!rows.length) list.textContent = 'No other chats found.'
    }
    let t = 0
    search.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(load, 200) })
    search.focus()
    await load()
  }

  function pickRow(r: SpindleGroupedRecentChat, pick: () => void) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'lt-row'
    b.setAttribute('role', 'listitem')
    const img = document.createElement('img')
    img.alt = ''
    img.onerror = () => { img.style.visibility = 'hidden' } // characters without an avatar 404
    img.src = r.character_image_id ? `/api/v1/images/${r.character_image_id}?size=sm` : `/api/v1/characters/${r.character_id}/avatar?size=sm`
    const name = document.createElement('span')
    name.textContent = r.is_group ? (r.group_name || r.character_name) : r.character_name
    b.append(img, name)
    b.addEventListener('click', pick)
    return b
  }

  async function addChat(r: SpindleGroupedRecentChat) {
    const name = r.is_group ? (r.group_name || r.character_name) : r.character_name
    const current = ctx.getActiveChat()
    if (!tiles.length) {
      if (!current.chatId) return route(r.latest_chat_id) // no chat open: just open it, nothing to tile with
      tiles.push({ id: uid(), chatId: current.chatId, name: await currentName(current.characterId) })
    }
    const tile = { id: uid(), chatId: r.latest_chat_id, name }
    tiles.push(tile)
    liveId = tile.id
    maxId = '' // show the new chat
    render()
  }

  async function currentName(characterId: string | null) {
    try {
      const rows = (await ctx.chats.listRecentGrouped?.({ limit: 100 }))?.data ?? []
      return rows.find((r) => r.character_id === characterId)?.character_name ?? 'Chat'
    } catch { return 'Chat' }
  }

  function closeTile(id: string) {
    tiles = tiles.filter((t) => t.id !== id)
    if (liveId === id) liveId = tiles[0]?.id ?? ''
    if (maxId === id) maxId = ''
    if (tiles.length <= 1) return stopTiling()
    render()
  }

  function stopTiling() {
    clearTimeout(followTimer) // a pending follow would route away from the chat that's left
    const last = tiles[0]
    tiles = []
    maxId = ''
    for (const e of els.values()) e.off()
    els.clear()
    mount?.destroy()
    mount = grid = null
    delete document.documentElement.dataset.lumiTile
    save() // saves "no layout"
    if (last) route(last.chatId)
  }

  function render() {
    if (!mount) {
      mount = ctx.ui.mountApp({ className: 'lt-app', position: 'app-overlay' })
      grid = document.createElement('div')
      grid.className = 'lt-root'
      mount.root.appendChild(grid)
      document.documentElement.dataset.lumiTile = 'host'
    }
    const g = grid!
    for (const [id, e] of els) if (!tiles.some((t) => t.id === id)) { e.off(); e.tile.remove(); els.delete(id) }
    const n = tiles.length
    // Grid tracks: tile | 6px gutter | tile, in both directions. Moving a tile only changes its grid cell,
    // so frames never reload. Layouts: 2 side by side; 3 = wide tile on top or bottom + 2 side by side; 4 = 2x2.
    const pair = wide === 'top' ? '3' : '1'
    const cells: [string, string][] =
      n === 2 ? [['1', '1'], ['1', '3']]
      : n === 3 ? [[wide === 'top' ? '1' : '3', '1 / -1'], [pair, '1'], [pair, '3']]
      : [['1', '1'], ['1', '3'], ['3', '1'], ['3', '3']]
    tiles.forEach((t, i) => {
      let e = els.get(t.id)
      if (!e) { e = makeTile(t); els.set(t.id, e); g.appendChild(e.tile) }
      e.tile.style.gridRow = cells[i][0]
      e.tile.style.gridColumn = cells[i][1]
      e.add.disabled = n >= MAX_TILES
      e.flip.hidden = !(n === 3 && i === 0)
      e.flip.title = e.flip.ariaLabel = wide === 'top' ? 'Move to bottom' : 'Move to top'
      e.makeWide.hidden = !(n === 3 && i !== 0)
      const maxed = t.id === maxId
      e.tile.classList.toggle('lt-maxed', maxed)
      e.max.title = e.max.ariaLabel = maxed ? 'Exit full screen' : 'Full screen'
      e.max.innerHTML = svg(maxed ? ICON.restore : ICON.max)
    })
    g.classList.toggle('lt-max', !!maxId)
    g.querySelectorAll('.lt-gutter').forEach((x) => x.remove())
    g.appendChild(gutter('v', n === 2 ? '1' : n === 3 ? pair : '1 / -1', '2'))
    if (n >= 3) g.appendChild(gutter('h', '2', '1 / -1'))
    layout()
    applyLive()
  }

  function layout() {
    if (!grid) return
    grid.style.gridTemplateColumns = `${col}fr 6px ${1 - col}fr`
    grid.style.gridTemplateRows = tiles.length >= 3 ? `${row}fr 6px ${1 - row}fr` : '1fr'
    save()
  }

  function button(icon: string, label: string, onClick: () => void) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'lt-btn'
    b.title = b.ariaLabel = label
    b.innerHTML = svg(icon)
    b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick() })
    return b
  }

  function makeTile(t: Tile) {
    const tile = document.createElement('section')
    tile.className = 'lt-tile'
    tile.setAttribute('aria-label', t.name)
    const head = document.createElement('div')
    head.className = 'lt-head'
    const title = document.createElement('span')
    title.className = 'lt-title'
    title.textContent = t.name
    const flip = button(ICON.flip, 'Move to bottom', () => { wide = wide === 'top' ? 'bottom' : 'top'; render() })
    const makeWide = button(ICON.wide, 'Make this the wide tile', () => {
      tiles = [t, ...tiles.filter((x) => x !== t)]
      render()
    })
    const add = button(ICON.add, 'Tile another chat', () => void openPicker())
    const max = button(ICON.max, 'Full screen', () => {
      maxId = maxId === t.id ? '' : t.id
      if (maxId) liveId = t.id
      render()
    })
    const close = button(ICON.close, `Close ${t.name}`, () => closeTile(t.id))
    head.append(title, flip, makeWide, add, max, close)
    // Header buttons must not make the tile live first (closing it would then queue a follow to it).
    head.addEventListener('pointerdown', (ev) => { if (!(ev.target as Element).closest('button')) setLive(t.id) })

    const frame = document.createElement('iframe')
    frame.className = 'lt-frame'
    frame.name = FRAME_PREFIX + t.id
    frame.title = t.name
    frame.src = `/chat/${encodeURIComponent(t.chatId)}`
    tile.append(head, frame)

    // Clicks/keyboard focus inside a frame never reach this page; listen on the frame's own window (same origin).
    let win: Window | null = null
    const onFocus = () => setLive(t.id)
    const detach = () => {
      win?.removeEventListener('pointerdown', onFocus, true)
      win?.removeEventListener('focus', onFocus)
      win = null
    }
    const onLoad = () => {
      detach()
      try {
        win = frame.contentWindow
        win?.addEventListener('pointerdown', onFocus, true)
        win?.addEventListener('focus', onFocus)
      } catch { win = null }
      markFrame(frame, t.id === liveId)
    }
    frame.addEventListener('load', onLoad)
    return { tile, frame, add, flip, makeWide, max, off: () => { detach(); frame.removeEventListener('load', onLoad) } }
  }

  // v: resizes columns (col), h: resizes rows (row).
  function gutter(dir: 'v' | 'h', gridRow: string, gridColumn: string) {
    const g = document.createElement('div')
    g.className = `lt-gutter lt-gutter-${dir}`
    g.style.gridRow = gridRow
    g.style.gridColumn = gridColumn
    g.setAttribute('role', 'separator')
    g.setAttribute('aria-orientation', dir === 'v' ? 'vertical' : 'horizontal')
    g.ariaLabel = dir === 'v' ? 'Resize columns' : 'Resize rows'
    g.tabIndex = 0
    const set = (v: number, size: number, minPx: number) => {
      const min = Math.min(0.45, minPx / size)
      const x = Math.min(1 - min, Math.max(min, v))
      if (dir === 'v') col = x; else row = x
      layout()
    }
    g.addEventListener('pointerdown', (ev) => {
      g.setPointerCapture(ev.pointerId)
      grid!.classList.add('lt-drag', `lt-drag-${dir}`)
      const move = (e: PointerEvent) => {
        const r = grid!.getBoundingClientRect()
        if (dir === 'v') set((e.clientX - r.left) / r.width, r.width, MIN_W)
        else set((e.clientY - r.top) / r.height, r.height, MIN_H)
      }
      const up = () => {
        grid?.classList.remove('lt-drag', 'lt-drag-v', 'lt-drag-h')
        g.removeEventListener('pointermove', move)
        g.removeEventListener('pointerup', up)
        g.removeEventListener('pointercancel', up)
      }
      g.addEventListener('pointermove', move)
      g.addEventListener('pointerup', up)
      g.addEventListener('pointercancel', up)
    })
    g.addEventListener('keydown', (e) => {
      const [less, more] = dir === 'v' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
      const step = e.key === less ? -0.02 : e.key === more ? 0.02 : 0
      if (!step) return
      e.preventDefault()
      const r = grid!.getBoundingClientRect()
      if (dir === 'v') set(col + step, r.width, MIN_W)
      else set(row + step, r.height, MIN_H)
    })
    return g
  }

  function setLive(id: string) {
    if (id === liveId || !tiles.some((t) => t.id === id)) return
    liveId = id
    applyLive()
  }

  function applyLive() {
    for (const t of tiles) {
      const e = els.get(t.id)
      if (!e) continue
      const live = t.id === liveId
      e.tile.classList.toggle('lt-live', live)
      markFrame(e.frame, live)
    }
    // Keep the hidden top-level app on the live chat so drawer panels act on it (PLAN §3).
    clearTimeout(followTimer)
    const chatId = tiles.find((t) => t.id === liveId)?.chatId
    if (chatId) followTimer = window.setTimeout(() => route(chatId), 400)
    save()
  }

  function route(chatId: string) {
    if (ctx.getActiveChat().chatId === chatId) return
    ctx.host.surfaces?.invoke({ kind: 'route', id: '/chat/:chatId' }, { chatId })?.catch?.(() => {})
  }

  function showSingleTabNotice() {
    const modal = ctx.ui.showModal({ title: 'Tiling needs multiple tabs', width: 400 })
    const box = document.createElement('div')
    box.className = 'lt-pick'
    box.innerHTML = '<p class="lt-note">Each tile is its own Lumiverse window. Turn off <b>Enforce one active browser tab</b> in Settings → Account, then try again.</p><button type="button" class="lt-row lt-cta">Open Account settings</button>'
    box.querySelector('button')!.addEventListener('click', () => { modal.dismiss(); ctx.events.emit('open-settings', { view: 'account' }) })
    modal.root.appendChild(box)
  }

  return () => {
    // Unloading the extension (update, disable) must keep the saved layout: write what's pending, then stop saving.
    flushSave()
    loaded = false
    window.removeEventListener('pagehide', flushSave)
    clearTimeout(followTimer)
    tiles = []
    for (const e of els.values()) e.off()
    els.clear()
    mount?.destroy()
    delete document.documentElement.dataset.lumiTile
    action.destroy()
    removeStyle()
  }
}

function markFrame(frame: HTMLIFrameElement, live: boolean) {
  const state = live ? 'live' : 'idle'
  try {
    const doc = frame.contentDocument
    if (!doc || doc.documentElement.dataset.lumiTile === state) return
    doc.documentElement.dataset.lumiTile = state
    frame.contentWindow?.dispatchEvent(new CustomEvent('lumi-tile:change', { detail: { state } }))
  } catch { /* frame not loaded yet */ }
}

// The host's single-tab guard (lib/active-tab.ts) would make every other window stop working.
// ponytail: checks every account that ever claimed a tab in this browser; fine for one user per browser.
function multiTabAllowed() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) ?? ''
    if (!key.startsWith('lumiverse:active-tab:')) continue
    const user = key.slice('lumiverse:active-tab:'.length)
    if (localStorage.getItem(`lumiverse:allow-multiple-tabs:${user}`) !== 'true') return false
  }
  return true
}

// Saved layouts come from storage another device or version wrote: validate every field, reject on doubt.
export function parseSaved(v: unknown): Saved | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.tiles) || o.tiles.length < 2 || o.tiles.length > MAX_TILES) return null
  const tiles = o.tiles.map((t) => {
    const x = (t ?? {}) as Record<string, unknown>
    return typeof x.chatId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.chatId)
      ? { chatId: x.chatId, name: typeof x.name === 'string' ? x.name.slice(0, 200) : 'Chat' }
      : null
  })
  if (tiles.some((t) => !t) || new Set(tiles.map((t) => t!.chatId)).size !== tiles.length) return null
  const share = (n: unknown) => (typeof n === 'number' && n >= 0.1 && n <= 0.9 ? n : 0.5)
  const index = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) < tiles.length ? (n as number) : -1)
  return {
    tiles: tiles as Saved['tiles'],
    live: index(o.live),
    max: index(o.max),
    col: share(o.col),
    row: share(o.row),
    wide: o.wide === 'bottom' ? 'bottom' : 'top',
  }
}

const uid = () => Math.random().toString(36).slice(2, 10)

const CSS = `
.lt-root{position:fixed;inset:var(--app-interactive-safe-top,0px) 0 0 0;display:grid;grid-template-rows:1fr;background:var(--lumiverse-bg,#0c0b10);padding:6px;box-sizing:border-box}
.lt-root *,.lt-pick,.lt-pick *{box-sizing:border-box;margin:0;letter-spacing:normal;text-transform:none;text-indent:0;float:none}
.lt-tile{display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid var(--lumiverse-border,#333);border-radius:10px;overflow:hidden;background:var(--lumiverse-bg,#0c0b10)}
.lt-tile.lt-live{border-color:var(--lumiverse-primary,#c8a)}
.lt-head{flex:0 0 28px;display:flex;align-items:center;gap:8px;padding:0 4px 0 10px;background:var(--lumiverse-bg-elevated,#16141c);color:var(--lumiverse-text-muted,#aaa);font:12px/1 var(--lumiverse-font-family,sans-serif);cursor:default;user-select:none}
.lt-live .lt-head{color:var(--lumiverse-text,#eee)}
.lt-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lt-btn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.lt-btn[hidden]{display:none!important}
.lt-btn:hover:not(:disabled),.lt-btn:focus-visible{background:var(--lumiverse-fill-subtle,rgba(255,255,255,.08));outline:none}
.lt-btn:disabled{opacity:.35;cursor:default}
.lt-frame{flex:1;width:100%;min-height:0;border:0;background:transparent;filter:brightness(.55) saturate(.8);transition:filter .2s}
.lt-live .lt-frame{filter:none}
.lt-gutter{border-radius:3px;outline:none}
.lt-gutter-v{cursor:col-resize}
.lt-gutter-h{cursor:row-resize}
.lt-gutter:hover,.lt-gutter:focus-visible,.lt-drag-v .lt-gutter-v,.lt-drag-h .lt-gutter-h{background:var(--lumiverse-primary,#c8a);opacity:.5}
.lt-max .lt-tile:not(.lt-maxed),.lt-max .lt-gutter{visibility:hidden}
.lt-maxed{position:absolute;inset:6px;z-index:1}
.lt-drag .lt-frame{pointer-events:none}
.lt-drag{user-select:none}
.lt-drag-v{cursor:col-resize}
.lt-drag-h{cursor:row-resize}
@media (prefers-reduced-motion: reduce){.lt-frame{transition:none}}
.lt-pick{display:flex;flex-direction:column;gap:8px;padding:2px;font-family:var(--lumiverse-font-family,sans-serif)}
.lt-search{width:100%;padding:8px 10px;border:1px solid var(--lumiverse-border,#333);border-radius:8px;background:var(--lumiverse-bg,#0c0b10);color:var(--lumiverse-text,#eee);font:13px/1.2 inherit}
.lt-list{display:flex;flex-direction:column;gap:2px;color:var(--lumiverse-text-muted,#aaa);font-size:13px}
.lt-row{display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--lumiverse-text,#eee);font:13px/1.2 var(--lumiverse-font-family,sans-serif);text-align:left;cursor:pointer}
.lt-row:hover,.lt-row:focus-visible{background:var(--lumiverse-fill-subtle,rgba(255,255,255,.08));outline:none}
.lt-row img{width:32px;height:32px;border-radius:50%;object-fit:cover;flex:none}
.lt-note{color:var(--lumiverse-text,#eee);font-size:13px;line-height:1.5}
.lt-cta{justify-content:center;background:var(--lumiverse-fill-subtle,rgba(255,255,255,.08))}
`
