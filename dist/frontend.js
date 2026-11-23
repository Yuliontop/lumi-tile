// src/frontend.ts
var FRAME_PREFIX = "lumi-tile:";
var MAX_TILES = 4;
var MIN_W = 320;
var MIN_H = 240;
var SETTINGS_KEY = "tile:layout";
var LOCAL_KEY = "lumi_tile:layout";
var ICON = {
  max: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  restore: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  flip: '<path d="M8 4v16M8 4L4 8M8 4l4 4M16 20V4M16 20l-4-4M16 20l4-4"/>',
  wide: '<rect x="3" y="7" width="18" height="10" rx="2"/>'
};
var svg = (d) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
function setup(ctx) {
  return window.name.startsWith(FRAME_PREFIX) ? setupFrame(ctx) : setupHost(ctx);
}
function setupFrame(ctx) {
  return ctx.dom.addStyle('div:has(> div > [data-spindle-mount="sidebar"]){display:none!important}');
}
function setupHost(ctx) {
  if (matchMedia("(pointer: coarse)").matches)
    return;
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const action = ctx.ui.registerInputBarAction({
    id: "tile_chat",
    label: "Tile another chat",
    subtitle: isLocal ? "Show a second chat beside this one" : "Only works when Lumiverse runs on this computer",
    enabled: isLocal,
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/></svg>'
  });
  const removeStyle = ctx.dom.addStyle(CSS);
  let tiles = [];
  let liveId = "";
  let col = 0.5;
  let row = 0.5;
  let wide = "top";
  let mount = null;
  let grid = null;
  let maxId = "";
  const els = new Map;
  let followTimer = 0;
  let saveTimer = 0;
  let loaded = false;
  action.onClick(() => void openPicker());
  window.addEventListener("pagehide", flushSave);
  loadLayout();
  async function loadLayout() {
    const stamped = [];
    try {
      stamped.push(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null"));
    } catch {}
    try {
      stamped.push(await ctx.settings?.get(SETTINGS_KEY));
    } catch {}
    const best = stamped.filter((s) => s && typeof s.at === "number").sort((a, b) => b.at - a.at)[0];
    loaded = true;
    const data = parseSaved(best?.data);
    if (!data || !isLocal || !multiTabAllowed() || tiles.length)
      return;
    const getMessages = ctx.chats.getMessages?.bind(ctx.chats);
    const alive = await Promise.all(data.tiles.map((t) => getMessages ? getMessages(t.chatId, { limit: 1 }).then(() => true, () => false) : true));
    const kept = data.tiles.map((t, i) => ({ ...t, id: uid(), i })).filter((t) => alive[t.i]);
    if (kept.length < 2 || tiles.length)
      return save();
    tiles = kept.map(({ id, chatId, name }) => ({ id, chatId, name }));
    liveId = kept.find((t) => t.i === data.live)?.id ?? tiles[0].id;
    maxId = kept.find((t) => t.i === data.max)?.id ?? "";
    col = data.col;
    row = data.row;
    wide = data.wide;
    render();
  }
  function save() {
    if (!loaded)
      return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushSave, 400);
  }
  function flushSave() {
    if (!loaded || !saveTimer)
      return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    const data = tiles.length < 2 ? null : {
      tiles: tiles.map(({ chatId, name }) => ({ chatId, name })),
      live: tiles.findIndex((t) => t.id === liveId),
      max: tiles.findIndex((t) => t.id === maxId),
      col,
      row,
      wide
    };
    const stamped = { at: Date.now(), data };
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(stamped));
    } catch {}
    ctx.settings?.set(SETTINGS_KEY, stamped).catch(() => {});
  }
  async function openPicker() {
    if (!multiTabAllowed())
      return showSingleTabNotice();
    if (tiles.length >= MAX_TILES)
      return;
    const modal = ctx.ui.showModal({ title: "Tile another chat", width: 420, maxHeight: 520 });
    const box = document.createElement("div");
    box.className = "lt-pick";
    box.innerHTML = '<input class="lt-search" type="search" placeholder="Search characters" aria-label="Search characters"><div class="lt-list" role="list"></div>';
    modal.root.appendChild(box);
    const search = box.querySelector("input");
    const list = box.querySelector(".lt-list");
    let req = 0;
    const load = async () => {
      const mine = ++req;
      let rows = [];
      try {
        rows = (await ctx.chats.listRecentGrouped?.({ limit: 40, search: search.value.trim() || undefined }))?.data ?? [];
      } catch (err) {
        list.textContent = `Couldn't load chats: ${String(err)}`;
        return;
      }
      if (mine !== req)
        return;
      const open = new Set([...tiles.map((t) => t.chatId), ctx.getActiveChat().chatId]);
      rows = rows.filter((r) => !open.has(r.latest_chat_id));
      list.replaceChildren(...rows.map((r) => pickRow(r, () => {
        modal.dismiss();
        addChat(r);
      })));
      if (!rows.length)
        list.textContent = "No other chats found.";
    };
    let t = 0;
    search.addEventListener("input", () => {
      clearTimeout(t);
      t = window.setTimeout(load, 200);
    });
    search.focus();
    await load();
  }
  function pickRow(r, pick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lt-row";
    b.setAttribute("role", "listitem");
    const img = document.createElement("img");
    img.alt = "";
    img.onerror = () => {
      img.style.visibility = "hidden";
    };
    img.src = r.character_image_id ? `/api/v1/images/${r.character_image_id}?size=sm` : `/api/v1/characters/${r.character_id}/avatar?size=sm`;
    const name = document.createElement("span");
    name.textContent = r.is_group ? r.group_name || r.character_name : r.character_name;
    b.append(img, name);
    b.addEventListener("click", pick);
    return b;
  }
  async function addChat(r) {
    const name = r.is_group ? r.group_name || r.character_name : r.character_name;
    const current = ctx.getActiveChat();
    if (!tiles.length) {
      if (!current.chatId)
        return route(r.latest_chat_id);
      tiles.push({ id: uid(), chatId: current.chatId, name: await currentName(current.characterId) });
    }
    const tile = { id: uid(), chatId: r.latest_chat_id, name };
    tiles.push(tile);
    liveId = tile.id;
    maxId = "";
    render();
  }
  async function currentName(characterId) {
    try {
      const rows = (await ctx.chats.listRecentGrouped?.({ limit: 100 }))?.data ?? [];
      return rows.find((r) => r.character_id === characterId)?.character_name ?? "Chat";
    } catch {
      return "Chat";
    }
  }
  function closeTile(id) {
    tiles = tiles.filter((t) => t.id !== id);
    if (liveId === id)
      liveId = tiles[0]?.id ?? "";
    if (maxId === id)
      maxId = "";
    if (tiles.length <= 1)
      return stopTiling();
    render();
  }
  function stopTiling() {
    clearTimeout(followTimer);
    const last = tiles[0];
    tiles = [];
    maxId = "";
    for (const e of els.values())
      e.off();
    els.clear();
    mount?.destroy();
    mount = grid = null;
    delete document.documentElement.dataset.lumiTile;
    save();
    if (last)
      route(last.chatId);
  }
  function render() {
    if (!mount) {
      mount = ctx.ui.mountApp({ className: "lt-app", position: "app-overlay" });
      grid = document.createElement("div");
      grid.className = "lt-root";
      mount.root.appendChild(grid);
      document.documentElement.dataset.lumiTile = "host";
    }
    const g = grid;
    for (const [id, e] of els)
      if (!tiles.some((t) => t.id === id)) {
        e.off();
        e.tile.remove();
        els.delete(id);
      }
    const n = tiles.length;
    const pair = wide === "top" ? "3" : "1";
    const cells = n === 2 ? [["1", "1"], ["1", "3"]] : n === 3 ? [[wide === "top" ? "1" : "3", "1 / -1"], [pair, "1"], [pair, "3"]] : [["1", "1"], ["1", "3"], ["3", "1"], ["3", "3"]];
    tiles.forEach((t, i) => {
      let e = els.get(t.id);
      if (!e) {
        e = makeTile(t);
        els.set(t.id, e);
        g.appendChild(e.tile);
      }
      e.tile.style.gridRow = cells[i][0];
      e.tile.style.gridColumn = cells[i][1];
      e.add.disabled = n >= MAX_TILES;
      e.flip.hidden = !(n === 3 && i === 0);
      e.flip.title = e.flip.ariaLabel = wide === "top" ? "Move to bottom" : "Move to top";
      e.makeWide.hidden = !(n === 3 && i !== 0);
      const maxed = t.id === maxId;
      e.tile.classList.toggle("lt-maxed", maxed);
      e.max.title = e.max.ariaLabel = maxed ? "Exit full screen" : "Full screen";
      e.max.innerHTML = svg(maxed ? ICON.restore : ICON.max);
    });
    g.classList.toggle("lt-max", !!maxId);
    g.querySelectorAll(".lt-gutter").forEach((x) => x.remove());
    g.appendChild(gutter("v", n === 2 ? "1" : n === 3 ? pair : "1 / -1", "2"));
    if (n >= 3)
      g.appendChild(gutter("h", "2", "1 / -1"));
    layout();
    applyLive();
  }
  function layout() {
    if (!grid)
      return;
    grid.style.gridTemplateColumns = `${col}fr 6px ${1 - col}fr`;
    grid.style.gridTemplateRows = tiles.length >= 3 ? `${row}fr 6px ${1 - row}fr` : "1fr";
    save();
  }
  function button(icon, label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lt-btn";
    b.title = b.ariaLabel = label;
    b.innerHTML = svg(icon);
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return b;
  }
  function makeTile(t) {
    const tile = document.createElement("section");
    tile.className = "lt-tile";
    tile.setAttribute("aria-label", t.name);
    const head = document.createElement("div");
    head.className = "lt-head";
    const title = document.createElement("span");
    title.className = "lt-title";
    title.textContent = t.name;
    const flip = button(ICON.flip, "Move to bottom", () => {
      wide = wide === "top" ? "bottom" : "top";
      render();
    });
    const makeWide = button(ICON.wide, "Make this the wide tile", () => {
      tiles = [t, ...tiles.filter((x) => x !== t)];
      render();
    });
    const add = button(ICON.add, "Tile another chat", () => void openPicker());
    const max = button(ICON.max, "Full screen", () => {
      maxId = maxId === t.id ? "" : t.id;
      if (maxId)
        liveId = t.id;
      render();
    });
    const close = button(ICON.close, `Close ${t.name}`, () => closeTile(t.id));
    head.append(title, flip, makeWide, add, max, close);
    head.addEventListener("pointerdown", (ev) => {
      if (!ev.target.closest("button"))
        setLive(t.id);
    });
    const frame = document.createElement("iframe");
    frame.className = "lt-frame";
    frame.name = FRAME_PREFIX + t.id;
    frame.title = t.name;
    frame.src = `/chat/${encodeURIComponent(t.chatId)}`;
    tile.append(head, frame);
    let win = null;
    const onFocus = () => setLive(t.id);
    const detach = () => {
      win?.removeEventListener("pointerdown", onFocus, true);
      win?.removeEventListener("focus", onFocus);
      win = null;
    };
    const onLoad = () => {
      detach();
      try {
        win = frame.contentWindow;
        win?.addEventListener("pointerdown", onFocus, true);
        win?.addEventListener("focus", onFocus);
      } catch {
        win = null;
      }
      markFrame(frame, t.id === liveId);
    };
    frame.addEventListener("load", onLoad);
    return { tile, frame, add, flip, makeWide, max, off: () => {
      detach();
      frame.removeEventListener("load", onLoad);
    } };
  }
  function gutter(dir, gridRow, gridColumn) {
    const g = document.createElement("div");
    g.className = `lt-gutter lt-gutter-${dir}`;
    g.style.gridRow = gridRow;
    g.style.gridColumn = gridColumn;
    g.setAttribute("role", "separator");
    g.setAttribute("aria-orientation", dir === "v" ? "vertical" : "horizontal");
    g.ariaLabel = dir === "v" ? "Resize columns" : "Resize rows";
    g.tabIndex = 0;
    const set = (v, size, minPx) => {
      const min = Math.min(0.45, minPx / size);
      const x = Math.min(1 - min, Math.max(min, v));
      if (dir === "v")
        col = x;
      else
        row = x;
      layout();
    };
    g.addEventListener("pointerdown", (ev) => {
      g.setPointerCapture(ev.pointerId);
      grid.classList.add("lt-drag", `lt-drag-${dir}`);
      const move = (e) => {
        const r = grid.getBoundingClientRect();
        if (dir === "v")
          set((e.clientX - r.left) / r.width, r.width, MIN_W);
        else
          set((e.clientY - r.top) / r.height, r.height, MIN_H);
      };
      const up = () => {
        grid?.classList.remove("lt-drag", "lt-drag-v", "lt-drag-h");
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });
    g.addEventListener("keydown", (e) => {
      const [less, more] = dir === "v" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
      const step = e.key === less ? -0.02 : e.key === more ? 0.02 : 0;
      if (!step)
        return;
      e.preventDefault();
      const r = grid.getBoundingClientRect();
      if (dir === "v")
        set(col + step, r.width, MIN_W);
      else
        set(row + step, r.height, MIN_H);
    });
    return g;
  }
  function setLive(id) {
    if (id === liveId || !tiles.some((t) => t.id === id))
      return;
    liveId = id;
    applyLive();
  }
  function applyLive() {
    for (const t of tiles) {
      const e = els.get(t.id);
      if (!e)
        continue;
      const live = t.id === liveId;
      e.tile.classList.toggle("lt-live", live);
      markFrame(e.frame, live);
    }
    clearTimeout(followTimer);
    const chatId = tiles.find((t) => t.id === liveId)?.chatId;
    if (chatId)
      followTimer = window.setTimeout(() => route(chatId), 400);
    save();
  }
  function route(chatId) {
    if (ctx.getActiveChat().chatId === chatId)
      return;
    ctx.host.surfaces?.invoke({ kind: "route", id: "/chat/:chatId" }, { chatId })?.catch?.(() => {});
  }
  function showSingleTabNotice() {
    const modal = ctx.ui.showModal({ title: "Tiling needs multiple tabs", width: 400 });
    const box = document.createElement("div");
    box.className = "lt-pick";
    box.innerHTML = '<p class="lt-note">Each tile is its own Lumiverse window. Turn off <b>Enforce one active browser tab</b> in Settings → Account, then try again.</p><button type="button" class="lt-row lt-cta">Open Account settings</button>';
    box.querySelector("button").addEventListener("click", () => {
      modal.dismiss();
      ctx.events.emit("open-settings", { view: "account" });
    });
    modal.root.appendChild(box);
  }
  return () => {
    flushSave();
    loaded = false;
    window.removeEventListener("pagehide", flushSave);
    clearTimeout(followTimer);
    tiles = [];
    for (const e of els.values())
      e.off();
    els.clear();
    mount?.destroy();
    delete document.documentElement.dataset.lumiTile;
    action.destroy();
    removeStyle();
  };
}
function markFrame(frame, live) {
  const state = live ? "live" : "idle";
  try {
    const doc = frame.contentDocument;
    if (!doc || doc.documentElement.dataset.lumiTile === state)
      return;
    doc.documentElement.dataset.lumiTile = state;
    frame.contentWindow?.dispatchEvent(new CustomEvent("lumi-tile:change", { detail: { state } }));
  } catch {}
}
function multiTabAllowed() {
  for (let i = 0;i < localStorage.length; i++) {
    const key = localStorage.key(i) ?? "";
    if (!key.startsWith("lumiverse:active-tab:"))
      continue;
    const user = key.slice("lumiverse:active-tab:".length);
    if (localStorage.getItem(`lumiverse:allow-multiple-tabs:${user}`) !== "true")
      return false;
  }
  return true;
}
function parseSaved(v) {
  if (!v || typeof v !== "object")
    return null;
  const o = v;
  if (!Array.isArray(o.tiles) || o.tiles.length < 2 || o.tiles.length > MAX_TILES)
    return null;
  const tiles = o.tiles.map((t) => {
    const x = t ?? {};
    return typeof x.chatId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x.chatId) ? { chatId: x.chatId, name: typeof x.name === "string" ? x.name.slice(0, 200) : "Chat" } : null;
  });
  if (tiles.some((t) => !t) || new Set(tiles.map((t) => t.chatId)).size !== tiles.length)
    return null;
  const share = (n) => typeof n === "number" && n >= 0.1 && n <= 0.9 ? n : 0.5;
  const index = (n) => Number.isInteger(n) && n >= 0 && n < tiles.length ? n : -1;
  return {
    tiles,
    live: index(o.live),
    max: index(o.max),
    col: share(o.col),
    row: share(o.row),
    wide: o.wide === "bottom" ? "bottom" : "top"
  };
}
var uid = () => Math.random().toString(36).slice(2, 10);
var HOST_HIDE = `
html[data-lumi-tile="host"] body > :is(:has([class*="_expressionImg_"]), :has(> [class*="_minimizedIcon_"])){display:none!important}
`;
var CSS = HOST_HIDE + `
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
`;
export {
  parseSaved,
  setup
};
