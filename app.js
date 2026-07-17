"use strict";

/* ==========================================================================
   My Price Book — grocery price comparison
   Data lives in localStorage. Backup/restore via JSON file.
   ========================================================================== */

/* ---------- storage ---------- */
const K = { stores: "pricebook-stores", items: "pricebook-items", basket: "pricebook-basket", theme: "pricebook-theme" };
const UNITS = ["oz", "lb", "g", "kg", "ml", "l", "ct", "ea"];
const errEl = document.getElementById("err");

function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); errEl.classList.add("hidden"); } catch (e) { errEl.classList.remove("hidden"); } }

let stores = load(K.stores, []);   // [{id, name}]
let items  = load(K.items, []);    // see migrate()
let basket = load(K.basket, {});   // {itemId: qty}
let currentView = "prices";
let editingId = null;              // item id, "new", or null
let formDraft = null;             // working copy while the item form is open
let searchTerm = "";

function saveStores() { save(K.stores, stores); }
function saveItems()  { save(K.items, items); }
function saveBasket() { save(K.basket, basket); }

/* one-time shape migration (older data used prices[sid] = {price, ts}) */
function migrate() {
  let changed = false;
  for (const it of items) {
    if (!it.mode) { it.mode = "each"; changed = true; }
    if (it.mode === "unit" && !it.unit) { it.unit = "oz"; changed = true; }
    if (it.prices) for (const sid in it.prices) {
      const p = it.prices[sid];
      if (p && p.price != null && p.reg == null) { p.reg = +p.price; delete p.price; changed = true; }
    }
  }
  if (changed) saveItems();
}
migrate();

/* ---------- helpers ---------- */
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function money(n) { return "$" + (Math.round(n * 100) / 100).toFixed(2); }
function moneyU(n) { return n < 1 ? "$" + n.toFixed(3) : "$" + n.toFixed(2); }      // finer precision for per-unit prices
function num(str) { if (str == null || str === "") return null; const n = parseFloat(String(str).replace(/[^0-9.]/g, "")); return isFinite(n) && n >= 0 ? n : null; }
function storeName(id) { const s = stores.find(x => x.id === id); return s ? s.name : "?"; }
function relTime(ts) {
  if (!ts) return "";
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return "today"; if (d === 1) return "yesterday";
  if (d < 30) return d + "d ago"; if (d < 365) return Math.round(d / 30) + "mo ago";
  return Math.round(d / 365) + "y ago";
}

/* price math ------------------------------------------------------------- */
// effective package/each price a shopper pays (sale wins if present)
function effOf(p) {
  if (!p) return null;
  if (p.sale != null && p.sale !== "") return +p.sale;
  if (p.reg != null && p.reg !== "") return +p.reg;
  return null;
}
function onSale(p) { return !!(p && p.sale != null && p.sale !== "" && p.reg != null && p.reg !== "" && +p.sale < +p.reg); }
// the number used for comparing across stores: per-unit for unit items, else the eff price
function cmpOf(item, p) {
  const e = effOf(p); if (e == null) return null;
  if (item.mode === "unit") { const sz = p.size != null ? +p.size : null; return (sz && sz > 0) ? e / sz : null; }
  return e;
}
function fmtCmp(item, v) { return item.mode === "unit" ? moneyU(v) + "/" + item.unit : money(v); }

// comparable price rows for an item: [{store, reg, sale, size, eff, cmp, sale?}]
function pricesOf(item) {
  const out = [];
  for (const s of stores) {
    const p = item.prices && item.prices[s.id]; if (!p) continue;
    const cmp = cmpOf(item, p); if (cmp == null) continue;
    out.push({ store: s, reg: p.reg, sale: p.sale, size: p.size, ts: p.ts, eff: effOf(p), cmp, onSale: onSale(p) });
  }
  return out;
}
function cheapest(item) {
  const ps = pricesOf(item); if (!ps.length) return null;
  const min = Math.min(...ps.map(p => p.cmp));
  return { min, winners: ps.filter(p => p.cmp === min), count: ps.length };
}

/* ---------- view switching ---------- */
function switchView(v) {
  currentView = v;
  for (const x of ["prices", "basket", "cheapest", "stores"]) {
    document.getElementById("view-" + x).classList.toggle("hidden", x !== v);
    document.querySelector('.navbtn[data-view="' + x + '"]').classList.toggle("active", x === v);
  }
  if (v === "prices") renderItems();
  if (v === "basket") renderBasket();
  if (v === "cheapest") renderCheapest();
  if (v === "stores") renderStores();
  renderTally();
}
document.querySelectorAll(".navbtn").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));

function renderTally() {
  const bk = Object.values(basket).filter(q => q > 0).length;
  document.getElementById("tally").textContent =
    items.length + " item" + (items.length === 1 ? "" : "s") + " · " +
    stores.length + " store" + (stores.length === 1 ? "" : "s") +
    (bk ? " · " + bk + " in basket" : "");
}

/* ========================================================================
   PRICES
   ======================================================================== */
function renderItems() {
  const wrap = document.getElementById("itemList");
  if (!stores.length) { wrap.innerHTML = '<div class="empty">Add a <b>store</b> first (🏬 Stores tab), then start logging prices.</div>'; return; }
  if (!items.length && editingId == null) { wrap.innerHTML = '<div class="empty">No items yet. Tap <b>＋ Add an item</b> to log your first price.</div>'; return; }

  const q = searchTerm.trim().toLowerCase();
  let list = items.slice();
  if (q) list = list.filter(it => (it.name + " " + (it.size || "") + " " + (it.category || "")).toLowerCase().includes(q));
  list.sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) { wrap.innerHTML = '<div class="empty">No items match "' + esc(searchTerm) + '".</div>'; return; }

  wrap.innerHTML = list.map(itemCard).join("");
  wrap.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.id, act = btn.dataset.act;
    if (act === "edit") { openItemForm(id); }
    else if (act === "add-basket") { basket[id] = (basket[id] || 0) + 1; saveBasket(); btn.textContent = "✓ In basket (" + basket[id] + ")"; renderTally(); }
    else if (act === "del") {
      if (btn.classList.contains("armed")) { items = items.filter(x => x.id !== id); delete basket[id]; saveItems(); saveBasket(); renderItems(); renderTally(); }
      else { btn.classList.add("armed"); btn.textContent = "Tap to confirm"; setTimeout(() => { btn.classList.remove("armed"); btn.textContent = "Delete"; }, 3000); }
    }
  }));
}

function itemCard(it) {
  const c = cheapest(it);
  const ps = pricesOf(it).sort((a, b) => a.cmp - b.cmp);
  const unitTag = it.mode === "unit" ? ' <span class="modetag">per ' + esc(it.unit) + "</span>" : "";
  let cheapLine, table = "", winClass = "";

  if (!c) {
    cheapLine = '<div class="noprice">No comparable prices yet — tap Edit prices' + (it.mode === "unit" ? " (unit items need a size at each store)." : ".") + "</div>";
  } else {
    winClass = " win";
    const names = c.winners.map(w => esc(w.store.name) + (w.onSale ? ' <span class="saletag">sale</span>' : "")).join(" / ");
    cheapLine = '<div class="cheap-line"><span class="lbl">Cheapest</span> <b>' + fmtCmp(it, c.min) + "</b> · " + names + "</div>";
    if (ps.length > 1) {
      const rows = ps.map(p => {
        const diff = p.cmp - c.min, pct = c.min > 0 ? diff / c.min * 100 : 0, best = p.cmp === c.min;
        // store cell + detail line
        let detail = "";
        if (it.mode === "unit") detail = money(p.eff) + " / " + (p.size != null ? p.size : "?") + " " + esc(it.unit) + (p.onSale ? " · was " + money(p.reg) : "");
        else if (p.onSale) detail = "was " + money(p.reg);
        const storeCell = '<td><span class="sc-name">' + esc(p.store.name) + (p.onSale ? ' <span class="saletag">sale</span>' : "") + "</span>"
          + (detail ? '<span class="sc-sub">' + detail + "</span>" : "") + "</td>";
        const priceCell = "<td>" + fmtCmp(it, p.cmp) + "</td>";
        const diffCell = best ? '<td class="muted">—</td>' : '<td class="up">+' + (it.mode === "unit" ? moneyU(diff) : money(diff)) + "</td>";
        const pctCell  = best ? '<td class="muted">—</td>' : '<td class="up">+' + pct.toFixed(0) + "%</td>";
        return '<tr class="' + (best ? "best" : "") + '">' + storeCell + priceCell + diffCell + pctCell + "</tr>";
      }).join("");
      const priceHead = it.mode === "unit" ? "$/" + esc(it.unit) : "Price";
      table = '<details class="cmp"><summary>Compare all ' + ps.length + ' stores</summary>'
        + '<table class="cmptbl"><thead><tr><th>Store</th><th>' + priceHead + '</th><th>+$</th><th>+%</th></tr></thead><tbody>'
        + rows + "</tbody></table></details>";
    }
  }
  const inBasket = basket[it.id] > 0;
  return '<div class="card' + winClass + '">'
    + '<div class="card-top"><div><div class="iname">' + esc(it.name) + unitTag + "</div>"
    + (it.size ? '<div class="isize">' + esc(it.size) + "</div>" : "") + "</div>"
    + (c ? '<div class="stamp">Best ' + fmtCmp(it, c.min) + "</div>" : "") + "</div>"
    + cheapLine + table
    + '<div class="rowbtns">'
    + '<button class="ebtn" data-act="edit" data-id="' + it.id + '">Edit prices</button>'
    + '<button class="ebtn go" data-act="add-basket" data-id="' + it.id + '">' + (inBasket ? "✓ In basket (" + basket[it.id] + ")" : "＋ Add to basket") + "</button>"
    + '<button class="ebtn accent" data-act="del" data-id="' + it.id + '">Delete</button>'
    + "</div></div>";
}

/* ---- add / edit item form (uses a working draft so mode toggles don't lose input) ---- */
document.getElementById("addItemBtn").addEventListener("click", () => openItemForm("new"));
document.getElementById("search").addEventListener("input", e => { searchTerm = e.target.value; renderItems(); });

function openItemForm(id) {
  editingId = id;
  if (id === "new") formDraft = { name: "", size: "", category: "", mode: "each", unit: "oz", prices: {} };
  else {
    const it = items.find(x => x.id === id); if (!it) { editingId = null; return; }
    formDraft = { name: it.name, size: it.size || "", category: it.category || "", mode: it.mode || "each", unit: it.unit || "oz",
      prices: JSON.parse(JSON.stringify(it.prices || {})) };
  }
  renderForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function readFormIntoDraft() {
  if (!formDraft) return;
  const g = sel => document.getElementById(sel);
  if (g("fName")) formDraft.name = g("fName").value;
  if (g("fSize")) formDraft.size = g("fSize").value;
  if (g("fCat")) formDraft.category = g("fCat").value;
  document.querySelectorAll("[data-pfield]").forEach(inp => {
    const sid = inp.dataset.store, field = inp.dataset.pfield;
    formDraft.prices[sid] = formDraft.prices[sid] || {};
    formDraft.prices[sid][field] = inp.value;
  });
}
function renderForm() {
  const area = document.getElementById("formArea");
  if (editingId == null) { area.innerHTML = ""; return; }
  if (!stores.length) { area.innerHTML = '<div class="hint">Add a store first on the 🏬 Stores tab.</div>'; return; }
  const d = formDraft, editing = editingId !== "new", isUnit = d.mode === "unit";

  const modeChips = '<div class="segbar"><button type="button" class="segbtn' + (!isUnit ? " on" : "") + '" data-mode="each">Each / package</button>'
    + '<button type="button" class="segbtn' + (isUnit ? " on" : "") + '" data-mode="unit">Per unit</button></div>';

  const unitSel = isUnit ? '<div class="field"><label>Unit to compare by</label><select id="fUnit" class="inline">'
    + UNITS.map(u => '<option value="' + u + '"' + (u === d.unit ? " selected" : "") + ">" + u + "</option>").join("") + "</select></div>" : "";

  const priceRows = stores.map(s => {
    const p = d.prices[s.id] || {};
    const note = p.ts ? '<span class="updnote">updated ' + relTime(p.ts) + "</span>" : "";
    const regIn  = '<div class="mini"><label>Reg</label><div class="minput"><span>$</span><input inputmode="decimal" data-store="' + s.id + '" data-pfield="reg" value="' + esc(p.reg != null ? p.reg : "") + '" placeholder="0.00"></div></div>';
    const saleIn = '<div class="mini"><label>Sale</label><div class="minput"><span>$</span><input inputmode="decimal" data-store="' + s.id + '" data-pfield="sale" value="' + esc(p.sale != null ? p.sale : "") + '" placeholder="—"></div></div>';
    const sizeIn = isUnit ? '<div class="mini"><label>Size (' + esc(d.unit) + ')</label><div class="minput"><input inputmode="decimal" data-store="' + s.id + '" data-pfield="size" value="' + esc(p.size != null ? p.size : "") + '" placeholder="0"></div></div>' : "";
    return '<div class="pstore"><div class="ps-head">' + esc(s.name) + " " + note + "</div>"
      + '<div class="ps-grid' + (isUnit ? " three" : "") + '">' + regIn + saleIn + sizeIn + "</div></div>";
  }).join("");

  area.innerHTML = '<div class="panel"><div class="panel-head"><h2 class="disp">' + (editing ? "Edit item" : "New item") + '</h2><button class="xbtn" id="formClose">✕</button></div>'
    + '<div class="field"><label>Item name</label><input id="fName" value="' + esc(d.name) + '" placeholder="e.g. Russet potatoes"></div>'
    + '<div class="grid2"><div><label>Size / note (optional)</label><input id="fSize" value="' + esc(d.size) + '" placeholder="5 lb bag"></div>'
    + '<div><label>Category (optional)</label><input id="fCat" value="' + esc(d.category) + '" placeholder="Produce"></div></div>'
    + '<label style="margin-top:4px">Pricing</label>' + modeChips
    + (isUnit ? '<div class="hint" style="margin:-4px 0 8px">Enter each store\'s price and the size it covers — the app compares by $/' + esc(d.unit) + ".</div>" : "")
    + unitSel
    + '<label style="margin-top:2px">Price at each store</label>'
    + '<div class="hint" style="margin:-2px 0 8px">Leave Reg blank to skip a store. Fill Sale only when it\'s on sale.</div>'
    + priceRows
    + '<div class="saverow"><button class="savebtn disp" id="fSave">' + (editing ? "Save changes" : "Save item") + '</button><button class="cancelbtn" id="fCancel">Cancel</button></div></div>';

  document.getElementById("formClose").addEventListener("click", closeForm);
  document.getElementById("fCancel").addEventListener("click", closeForm);
  document.getElementById("fSave").addEventListener("click", saveForm);
  area.querySelectorAll(".segbtn").forEach(b => b.addEventListener("click", () => { readFormIntoDraft(); d.mode = b.dataset.mode; renderForm(); }));
  const us = document.getElementById("fUnit");
  if (us) us.addEventListener("change", () => { readFormIntoDraft(); d.unit = us.value; renderForm(); });
}
function closeForm() { editingId = null; formDraft = null; document.getElementById("formArea").innerHTML = ""; }
function saveForm() {
  readFormIntoDraft();
  const d = formDraft;
  const name = (d.name || "").trim();
  if (!name) { const n = document.getElementById("fName"); if (n) n.focus(); return; }

  const editing = editingId !== "new";
  const existing = editing ? items.find(x => x.id === editingId) : null;
  const prev = existing ? (existing.prices || {}) : {};
  const prices = {};
  for (const s of stores) {
    const raw = d.prices[s.id] || {};
    const reg = num(raw.reg), sale = num(raw.sale), size = num(raw.size);
    if (reg == null && sale == null) continue;                 // no price entered for this store
    const rec = { reg, sale };
    if (d.mode === "unit") rec.size = size;
    const before = prev[s.id];
    const same = before && before.reg === reg && before.sale === sale && (d.mode !== "unit" || before.size === size);
    rec.ts = (same && before.ts) ? before.ts : Date.now();
    prices[s.id] = rec;
  }
  const payload = { name, size: (d.size || "").trim(), category: (d.category || "").trim(), mode: d.mode, unit: d.unit, prices };
  if (existing) Object.assign(existing, payload);
  else items.push(Object.assign({ id: uid("i") }, payload));
  saveItems(); closeForm(); renderItems(); renderTally();
}

/* ========================================================================
   BASKET
   ======================================================================== */
function renderBasket() {
  const v = document.getElementById("view-basket");
  if (!items.length) { v.innerHTML = '<div class="empty">Log some item prices first, then build a basket to compare store totals.</div>'; return; }

  const inBasket = Object.keys(basket).filter(id => basket[id] > 0 && items.find(x => x.id === id));
  const available = items.filter(x => !(basket[x.id] > 0)).sort((a, b) => a.name.localeCompare(b.name));

  let html = '<div class="bk-add"><select id="bkAdd"><option value="">＋ Add item to basket…</option>'
    + available.map(x => '<option value="' + x.id + '">' + esc(x.name) + (x.size ? " (" + esc(x.size) + ")" : "") + "</option>").join("") + "</select></div>";

  if (!inBasket.length) {
    html += '<div class="empty">Your basket is empty. Add items above to compare what each store would charge.</div>';
    v.innerHTML = html; wireBasketAdd(); return;
  }

  // qty rows (typeable + steppers)
  html += '<div class="bk-list">';
  inBasket.map(id => items.find(x => x.id === id)).sort((a, b) => a.name.localeCompare(b.name)).forEach(it => {
    const unitLbl = it.mode === "unit" ? esc(it.unit) : "×";
    html += '<div class="bk-item"><div class="bn"><div class="nm">' + esc(it.name) + "</div>"
      + (it.size ? '<div class="sz">' + esc(it.size) + "</div>" : "") + "</div>"
      + '<div class="qty"><button data-bk="dec" data-id="' + it.id + '">−</button>'
      + '<input class="qin" inputmode="decimal" data-bk="set" data-id="' + it.id + '" value="' + basket[it.id] + '">'
      + '<button data-bk="inc" data-id="' + it.id + '">+</button></div>'
      + '<span class="qunit">' + unitLbl + "</span>"
      + '<button class="bk-x" data-bk="rm" data-id="' + it.id + '">✕</button></div>';
  });
  html += "</div>";
  html += '<button class="ebtn accent" id="bkClear" style="margin:6px 0 18px">Empty basket</button>';

  // totals per store
  const bItems = inBasket.map(id => ({ item: items.find(x => x.id === id), qty: basket[id] }));
  const results = stores.map(s => {
    let total = 0, covered = 0, missing = [];
    for (const b of bItems) {
      const cmp = cmpOf(b.item, (b.item.prices || {})[s.id]);
      if (cmp != null) { total += cmp * b.qty; covered++; } else missing.push(b.item.name);
    }
    return { store: s, total, covered, missing, coversAll: missing.length === 0 && covered > 0 };
  }).filter(r => r.covered > 0);
  results.sort((a, b) => (b.coversAll - a.coversAll) || (a.total - b.total));
  const bestComplete = results.find(r => r.coversAll);

  html += '<div class="panel-head"><h2 class="disp">Total by store</h2></div>';
  if (!results.length) html += '<div class="hint">None of your stores have prices for these items yet.</div>';
  else {
    if (!bestComplete) html += '<div class="hint">No single store carries every item — totals below only cover what each store has.</div>';
    results.forEach(r => {
      const isBest = bestComplete && r.store.id === bestComplete.store.id;
      let sub;
      if (isBest) sub = "Cheapest full basket";
      else if (bestComplete && r.coversAll) { const diff = r.total - bestComplete.total, pct = bestComplete.total > 0 ? diff / bestComplete.total * 100 : 0; sub = '<span class="over">+' + money(diff) + " (+" + pct.toFixed(0) + "%)</span> vs " + esc(bestComplete.store.name); }
      else sub = r.covered + " item" + (r.covered === 1 ? "" : "s") + " priced";
      const missNote = r.missing.length ? '<span class="miss">missing: ' + r.missing.map(esc).join(", ") + "</span>" : "";
      html += '<div class="totcard' + (isBest ? " best" : "") + (r.coversAll ? "" : " incomplete") + '">'
        + '<div class="tot-top"><div class="tot-name">' + esc(r.store.name) + (isBest ? ' <span class="stamp" style="display:inline-block">Best</span>' : "") + "</div>"
        + '<div class="tot-amt">' + money(r.total) + "</div></div>"
        + '<div class="tot-sub">' + sub + (missNote ? " · " + missNote : "") + "</div></div>";
    });
  }

  // cheapest possible (split)
  const byStore = {}; let optTotal = 0; const uncovered = [];
  for (const b of bItems) {
    const c = cheapest(b.item);
    if (!c) { uncovered.push(b.item.name); continue; }
    const w = c.winners[0]; optTotal += c.min * b.qty;
    (byStore[w.store.id] = byStore[w.store.id] || []).push({ item: b.item, qty: b.qty, cmp: c.min });
  }
  const storeIds = Object.keys(byStore);
  if (storeIds.length) {
    html += '<div class="panel" style="margin-top:20px"><div class="panel-head"><h2 class="disp">Cheapest possible 🪄</h2></div>'
      + '<div class="tot-top"><div class="tot-name">If you split your shopping</div><div class="tot-amt" style="color:var(--good)">' + money(optTotal) + "</div></div>";
    if (bestComplete) {
      const saved = bestComplete.total - optTotal;
      html += '<div class="tot-sub" style="margin-bottom:4px">' + (saved > 0.005
        ? "Saves <b style=\"color:var(--good)\">" + money(saved) + "</b> vs all at " + esc(bestComplete.store.name) + " (" + storeIds.length + " store" + (storeIds.length === 1 ? "" : "s") + ")"
        : "Same as buying everything at " + esc(bestComplete.store.name)) + "</div>";
    }
    html += '<div class="split">';
    storeIds.sort((a, b) => storeName(a).localeCompare(storeName(b))).forEach(sid => {
      html += '<div class="sstore">' + esc(storeName(sid)) + "</div>";
      byStore[sid].forEach(l => {
        const label = l.item.mode === "unit" ? l.qty + " " + esc(l.item.unit) : (l.qty > 1 ? "×" + l.qty : "");
        html += '<div class="sline"><span class="snm">' + esc(l.item.name) + (label ? " " + label : "") + '</span><span>' + money(l.cmp * l.qty) + "</span></div>";
      });
    });
    html += "</div>";
    if (uncovered.length) html += '<div class="tot-sub" style="margin-top:8px">No price on file for: ' + uncovered.map(esc).join(", ") + "</div>";
    html += "</div>";
  }

  v.innerHTML = html;
  wireBasketAdd();
  v.querySelectorAll("[data-bk]").forEach(el => {
    const id = el.dataset.id, act = el.dataset.bk;
    if (act === "set") {
      el.addEventListener("change", () => { const q = num(el.value); if (q && q > 0) basket[id] = q; else delete basket[id]; saveBasket(); renderBasket(); renderTally(); });
      el.addEventListener("keydown", e => { if (e.key === "Enter") el.blur(); });
    } else {
      el.addEventListener("click", () => {
        if (act === "inc") basket[id] = (+basket[id] || 0) + 1;
        else if (act === "dec") basket[id] = Math.max(0, (+basket[id] || 0) - 1);
        else if (act === "rm") delete basket[id];
        if (basket[id] === 0) delete basket[id];
        saveBasket(); renderBasket(); renderTally();
      });
    }
  });
  const clr = document.getElementById("bkClear");
  if (clr) clr.addEventListener("click", () => { basket = {}; saveBasket(); renderBasket(); renderTally(); });
}
function wireBasketAdd() {
  const sel = document.getElementById("bkAdd");
  if (sel) sel.addEventListener("change", () => { if (sel.value) { basket[sel.value] = (basket[sel.value] || 0) + 1; saveBasket(); renderBasket(); renderTally(); } });
}

/* ========================================================================
   CHEAPEST (winners)
   ======================================================================== */
function renderCheapest() {
  const v = document.getElementById("view-cheapest");
  if (!stores.length || !items.length) { v.innerHTML = '<div class="empty">Log prices for a few items across your stores, then see which store wins each one.</div>'; return; }

  const wins = {}; stores.forEach(s => wins[s.id] = []);
  let comparable = 0;
  items.forEach(it => {
    const c = cheapest(it); if (!c) return;
    const ps = pricesOf(it).sort((a, b) => a.cmp - b.cmp);
    if (ps.length >= 2) comparable++;
    let margin = null, tag = "";
    if (ps.length === 1) tag = "only store priced";
    else if (c.winners.length > 1) tag = "tied";
    else margin = ps[1].cmp - ps[0].cmp;
    c.winners.forEach(w => wins[w.store.id].push({ item: it, cmp: c.min, margin, tag, onSale: w.onSale }));
  });

  const ordered = stores.slice().sort((a, b) => wins[b.id].length - wins[a.id].length || a.name.localeCompare(b.name));
  let html = '<div class="hint">Which store is cheapest for each item. ' + comparable + " item" + (comparable === 1 ? "" : "s") + " priced at 2+ stores.</div>";
  ordered.forEach(s => {
    const list = wins[s.id];
    html += '<div class="winstore"><h3>' + esc(s.name) + '</h3><div class="wincount disp">cheapest for ' + list.length + " item" + (list.length === 1 ? "" : "s") + "</div>";
    if (!list.length) html += '<div style="color:var(--ink-soft);font-style:italic;font-size:13px">Not the cheapest on anything yet.</div>';
    else list.sort((a, b) => a.item.name.localeCompare(b.item.name)).forEach(w => {
      const it = w.item;
      const right = w.margin != null ? '<span class="marg">' + (it.mode === "unit" ? moneyU(w.margin) : money(w.margin)) + " cheaper</span>" : '<span class="tag">' + w.tag + "</span>";
      html += '<div class="winrow"><span>' + esc(it.name) + (it.mode === "unit" ? ' <span class="tag">/' + esc(it.unit) + "</span>" : (it.size ? ' <span class="tag">' + esc(it.size) + "</span>" : ""))
        + (w.onSale ? ' <span class="saletag">sale</span>' : "") + "</span>"
        + '<span>' + fmtCmp(it, w.cmp) + " · " + right + "</span></div>";
    });
    html += "</div>";
  });
  v.innerHTML = html;
}

/* ========================================================================
   STORES
   ======================================================================== */
function renderStores() {
  const v = document.getElementById("view-stores");
  let html = '<button id="addStoreBtn" class="addbtn disp">＋ Add a store</button><div id="storeForm"></div>';
  if (!stores.length) html += '<div class="empty">No stores yet. Add the grocery stores you compare — like <b>Harmons</b>, <b>Smith\'s</b>, or <b>Costco</b>.</div>';
  else stores.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
    const priced = items.filter(it => it.prices && it.prices[s.id] && effOf(it.prices[s.id]) != null).length;
    html += '<div class="card"><div class="card-top"><div><div class="iname">' + esc(s.name) + "</div>"
      + '<div class="isize">' + priced + " item" + (priced === 1 ? "" : "s") + " priced</div></div></div>"
      + '<div class="rowbtns"><button class="ebtn" data-sact="rename" data-id="' + s.id + '">Rename</button>'
      + '<button class="ebtn accent" data-sact="del" data-id="' + s.id + '">Delete</button></div></div>';
  });
  v.innerHTML = html;

  document.getElementById("addStoreBtn").addEventListener("click", () => showStoreForm());
  v.querySelectorAll("[data-sact]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.id, act = btn.dataset.sact;
    if (act === "rename") showStoreForm(id);
    else if (act === "del") {
      if (btn.classList.contains("armed")) { stores = stores.filter(x => x.id !== id); items.forEach(it => { if (it.prices) delete it.prices[id]; }); saveStores(); saveItems(); renderStores(); renderTally(); }
      else { btn.classList.add("armed"); btn.textContent = "Tap to confirm"; setTimeout(() => { btn.classList.remove("armed"); btn.textContent = "Delete"; }, 3000); }
    }
  }));
}
function showStoreForm(id) {
  const editing = !!id, s = editing ? stores.find(x => x.id === id) : null;
  const area = document.getElementById("storeForm");
  area.innerHTML = '<div class="panel"><div class="field"><label>' + (editing ? "Rename store" : "Store name") + '</label>'
    + '<input id="sName" value="' + esc(s ? s.name : "") + '" placeholder="e.g. Harmons"></div>'
    + '<div class="saverow"><button class="savebtn disp" id="sSave">' + (editing ? "Save" : "Add store") + '</button><button class="cancelbtn" id="sCancel">Cancel</button></div></div>';
  const nameInp = document.getElementById("sName"); nameInp.focus();
  document.getElementById("sCancel").addEventListener("click", () => area.innerHTML = "");
  const doSave = () => { const name = nameInp.value.trim(); if (!name) { nameInp.focus(); return; } if (editing) s.name = name; else stores.push({ id: uid("s"), name }); saveStores(); area.innerHTML = ""; renderStores(); renderTally(); };
  document.getElementById("sSave").addEventListener("click", doSave);
  nameInp.addEventListener("keydown", e => { if (e.key === "Enter") doSave(); });
}

/* ========================================================================
   THEME + BACKUP
   ======================================================================== */
const themeBtn = document.getElementById("themeBtn");
function applyTheme(t) { document.body.classList.toggle("dark", t === "dark"); themeBtn.textContent = t === "dark" ? "☀️" : "🌙"; }
applyTheme(load(K.theme, ""));
themeBtn.addEventListener("click", () => { const dark = !document.body.classList.contains("dark"); applyTheme(dark ? "dark" : ""); save(K.theme, dark ? "dark" : ""); });

function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
document.getElementById("exportBtn").addEventListener("click", () => {
  const payload = JSON.stringify({ version: 2, app: "pricebook", exported: new Date().toISOString(), stores, items, basket }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "pricebook-backup-" + today() + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  document.getElementById("backupStatus").textContent = "Backed up " + today();
});
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", ev => {
  const file = ev.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!Array.isArray(d.items) || !Array.isArray(d.stores)) throw new Error("bad");
      const idMap = {};
      d.stores.forEach(ns => {
        const match = stores.find(s => s.name.trim().toLowerCase() === (ns.name || "").trim().toLowerCase());
        if (match) idMap[ns.id] = match.id;
        else { const nid = ns.id && !stores.some(s => s.id === ns.id) ? ns.id : uid("s"); stores.push({ id: nid, name: ns.name }); idMap[ns.id] = nid; }
      });
      let added = 0; const existingIds = new Set(items.map(i => i.id));
      d.items.forEach(ni => {
        const remapped = {};
        if (ni.prices) for (const oldSid in ni.prices) { const kept = idMap[oldSid] || oldSid; const p = ni.prices[oldSid]; if (p && p.price != null && p.reg == null) { p.reg = +p.price; delete p.price; } remapped[kept] = p; }
        const dup = items.find(i => i.name.trim().toLowerCase() === (ni.name || "").trim().toLowerCase());
        if (dup) dup.prices = Object.assign({}, dup.prices, remapped);
        else { let iid = ni.id && !existingIds.has(ni.id) ? ni.id : uid("i"); existingIds.add(iid); items.push({ id: iid, name: ni.name, size: ni.size || "", category: ni.category || "", mode: ni.mode || "each", unit: ni.unit || "oz", prices: remapped }); added++; }
      });
      migrate(); saveStores(); saveItems(); switchView(currentView);
      document.getElementById("backupStatus").textContent = "Restored " + added + " new item" + (added === 1 ? "" : "s");
    } catch (e) { alert("That file doesn't look like a Price Book backup."); }
    ev.target.value = "";
  };
  reader.readAsText(file);
});

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));

/* ---------- boot ---------- */
renderItems();
renderTally();
