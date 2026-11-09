/* Pixel Analyzer – arayüz ve tarayıcı geçmişi */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('tr-TR');
  const pct = (r, d = 1) => '%' + (r * 100).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const GROUP_DESC = {
    tutorial: '64×64 · dolu değil',
    normal: '128×128 · dolu değil',
    hard: '128×128 · tam dolu',
    superhard: '256×256 · dolu değil',
  };
  const PART_NAMES = { cells: 'Hücre sayısı', colors: 'Renk sayısı', regions: 'Bölge sayısı', fragment: 'Parçalılık', edges: 'Renk geçişi' };

  let cur = null; // { name, imageData, res, historyId }
  let view = 'image';
  let selection = null; // {type:'color', key} | {type:'region', id}
  let regLimit = 200;
  let regFilter = null; // renk filtresi (palet index)

  // ---------- IndexedDB ----------
  const DB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open('pixel-analyzer', 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => req.result.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => reject(req.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('history', mode);
        const store = t.objectStore('history');
        const r = fn(store);
        t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined);
        t.onerror = () => reject(t.error);
      });
    },
    add(item) { return this.tx('readwrite', (s) => s.add(item)); },
    all() { return this.tx('readonly', (s) => s.getAll()); },
    get(id) { return this.tx('readonly', (s) => s.get(id)); },
    del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
    clear() { return this.tx('readwrite', (s) => s.clear()); },
  };

  // ---------- Görsel çözme (renk dönüşümü ve premultiply olmadan) ----------
  async function decode(blob) {
    let source;
    try {
      source = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (e) {
      source = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('Görsel okunamadı'));
        img.src = URL.createObjectURL(blob);
      });
    }
    const w = source.width, h = source.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0);
    if (source.close) source.close();
    return ctx.getImageData(0, 0, w, h);
  }

  function thumb(imageData) {
    const c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    const s = Math.max(1, Math.floor(88 / Math.max(c.width, c.height)));
    const t = document.createElement('canvas');
    t.width = c.width * s; t.height = c.height * s;
    const tc = t.getContext('2d');
    tc.imageSmoothingEnabled = false;
    tc.drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/png');
  }

  function summary(res) {
    return {
      width: res.width, height: res.height, colors: res.colorCount, regions: res.regionCount, smallRegionRatio: res.smallRegionRatio,
      transparentRatio: res.transparentRatio, outline: res.outline.has, group: res.group.name,
      groupWarn: res.group.warnings.length > 0, score: res.score.value,
    };
  }

  // ---------- Dosya yükleme ----------
  async function handleFiles(files) {
    const list = [...files];
    let last = null;
    for (const f of list) {
      const isPng = f.type === 'image/png' || /\.png$/i.test(f.name);
      if (!isPng) { alert(`"${f.name}" PNG değil, atlandı.`); continue; }
      try {
        const imageData = await decode(f);
        const res = PixelAnalyzer.analyze(imageData.width, imageData.height, imageData.data);
        let id = null;
        try {
          id = await DB.add({ name: f.name, date: Date.now(), blob: f, thumb: thumb(imageData), summary: summary(res) });
        } catch (e) { console.warn('Geçmişe kaydedilemedi', e); }
        last = { name: f.name, imageData, res, historyId: id };
      } catch (e) {
        alert(`"${f.name}" analiz edilemedi: ${e.message}`);
      }
    }
    if (last) show(last);
    renderHistory();
  }

  const drop = $('drop'), fileInput = $('file');
  fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === drop) drop.classList.remove('over'); }));
  document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  // ---------- Sonuç gösterimi ----------
  function show(state) {
    cur = state; selection = null; regFilter = null; regLimit = 200;
    const r = state.res;
    $('empty').hidden = true; $('result').hidden = false;
    $('rName').textContent = state.name;

    const warns = [...r.group.warnings];
    if (r.semiTransparentPixels) warns.push(`${fmt(r.semiTransparentPixels)} yarı saydam piksel var; bunlar opak hücre olarak, alfa değeriyle ayrı renk sayıldı.`);
    $('warnings').innerHTML = warns.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('');

    $('sVal').textContent = r.score.value.toLocaleString('tr-TR');
    $('sLabel').textContent = r.score.label;
    $('gName').textContent = r.group.name;
    $('gDesc').textContent = GROUP_DESC[r.group.id] + (r.group.exact ? '' : ' · en yakın grup');
    $('sParts').innerHTML = Object.keys(r.score.weights).map((k) => {
      const v = r.score.parts[k], w = r.score.weights[k];
      return `<div class="part"><span>${PART_NAMES[k]} <span class="muted">(%${Math.round(w * 100)})</span></span><span class="bar"><i style="width:${(v * 100).toFixed(1)}%"></i></span><span class="num">${(v * w * 100).toFixed(1)}</span></div>`;
    }).join('');

    $('vName').textContent = state.name; $('vName').title = state.name;
    $('vSize').textContent = `${r.width} × ${r.height} px`;
    $('vCells').textContent = `${fmt(r.totalPixels)} hücre, ${fmt(r.opaquePixels)} dolu`;
    $('vColors').textContent = fmt(r.colorCount);
    $('vTr').textContent = pct(r.transparentRatio);
    $('vTrN').textContent = `${fmt(r.transparentPixels)} şeffaf piksel · ${r.isFull ? 'tam dolu' : 'dolu değil'}`;
    const o = r.outline;
    $('vOl').innerHTML = o.has ? '<span style="color:var(--good)">Var</span>' : '<span style="color:var(--muted)">Yok</span>';
    $('vOlD').innerHTML = o.borderPixels
      ? (o.has ? esc(o.type) + (o.type === 'tek renk' ? ` <span class="sw" style="background:${o.dominantColor}"></span> ${o.dominantColor}` : '') + ' · ' : '') +
        `kenarın ${pct(o.contourRatio, 0)}'ı koyu kontur, ${pct(o.dominantRatio, 0)}'ı tek renk`
      : 'opak piksel yok';
    $('vReg').textContent = fmt(r.regionCount);
    $('vRegD').textContent = `ort. ${r.features.avgRegionSize.toFixed(1)} px bölge başına`;
    $('vSmall').textContent = pct(r.smallRegionRatio);
    $('vSmallD').textContent = `${fmt(r.smallRegionCount)} / ${fmt(r.regionCount)} bölge 1–3 px`;
    const b = r.contentBox;
    $('vBox').textContent = b ? `${b.width} × ${b.height} px` : '—';
    $('vBoxD').textContent = b ? `x: ${b.minX}–${b.maxX} · y: ${b.minY}–${b.maxY} (şeffaf olmayan alan)` : 'opak piksel yok';
    $('tRegN').textContent = fmt(r.regionCount);
    $('tColN').textContent = fmt(r.colorCount);

    renderPalette(); renderRegions(); setupCanvas(); syncSelection();
    document.querySelectorAll('.history li').forEach((li) => li.classList.toggle('sel', +li.dataset.id === state.historyId));
  }

  const colorTag = (idx) => {
    const p = cur.res.palette[idx];
    return `<button class="cid" data-ci="${idx}" title="${p.hex.toUpperCase()}"><span class="sw" style="background:${p.hex}"></span> ${p.id}</button>`;
  };

  function renderPalette() {
    const r = cur.res;
    const regPerColor = new Array(r.palette.length).fill(0);
    for (const g of r.regions) regPerColor[g.colorIndex]++;
    $('palette').innerHTML = r.palette.map((p, i) =>
      `<tr data-ci="${i}"><td><b>${p.id}</b></td><td><span class="sw" style="background:${p.hex}"></span> <code>${p.hex.toUpperCase()}</code></td><td class="num">${fmt(p.count)}</td><td class="num">${pct(p.ratio)}</td><td class="num">${fmt(regPerColor[i])}</td></tr>`
    ).join('');
  }
  function selectColor(idx) {
    if (selection && selection.type === 'color' && selection.idx === idx) { selection = null; regFilter = null; }
    else { selection = { type: 'color', idx }; regFilter = idx; }
    regLimit = 200;
    renderRegions(); syncSelection();
  }
  $('palette').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-ci]'); if (!tr) return;
    selectColor(+tr.dataset.ci);
  });

  function renderRegions() {
    const r = cur.res;
    const regs = regFilter === null ? r.regions : r.regions.filter((g) => g.colorIndex === regFilter);
    const buckets = [['1–3 px (küçük)', 1, 3], ['4–20 px', 4, 20], ['21–100 px', 21, 100], ['100+ px', 101, Infinity]];
    $('regHist').innerHTML = buckets.map(([l, a, b]) => `<div class="hb"><b>${fmt(regs.filter((x) => x.size >= a && x.size <= b).length)}</b> · ${l}</div>`).join('');
    $('regFilter').innerHTML = regFilter === null
      ? `Tüm renkler · ${fmt(regs.length)} bölge · küçükten büyüğe`
      : `Filtre: ${colorTag(regFilter)} · ${fmt(regs.length)} bölge · küçükten büyüğe`;
    $('regFilterClr').hidden = regFilter === null;
    const shown = regs.slice(0, regLimit);
    $('regBody').innerHTML = shown.map((g, i) =>
      `<tr data-id="${g.id}"><td>${i + 1}</td><td>${colorTag(g.colorIndex)}</td><td class="num">${fmt(g.size)}</td><td>${g.small ? '<span class="smallTag">küçük</span>' : ''}</td><td>${g.bbox[0]},${g.bbox[1]} → ${g.bbox[2]},${g.bbox[3]}</td></tr>`
    ).join('');
    const more = $('regMore');
    more.hidden = regs.length <= regLimit;
    more.textContent = `Tümünü göster (${fmt(regs.length)} bölge)`;
  }
  $('regMore').addEventListener('click', () => { regLimit = Infinity; renderRegions(); syncSelection(); });
  $('regFilterClr').addEventListener('click', () => {
    regFilter = null; if (selection && selection.type === 'color') selection = null;
    renderRegions(); syncSelection();
  });
  $('listRegions').addEventListener('click', (e) => {
    const c = e.target.closest('.cid');
    if (c) { e.stopPropagation(); selectColor(+c.dataset.ci); return; }
    const tr = e.target.closest('#regBody tr'); if (!tr) return;
    const id = +tr.dataset.id;
    selection = selection && selection.type === 'region' && selection.id === id ? null : { type: 'region', id };
    syncSelection();
  });
  document.querySelectorAll('.listTabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.listTabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('listRegions').hidden = b.dataset.list !== 'regions';
    $('listColors').hidden = b.dataset.list !== 'colors';
  }));

  function syncSelection() {
    document.querySelectorAll('#palette tr').forEach((tr) => tr.classList.toggle('sel', !!selection && selection.type === 'color' && +tr.dataset.ci === selection.idx));
    let selRow = null;
    document.querySelectorAll('#regBody tr').forEach((tr) => {
      const on = !!selection && selection.type === 'region' && +tr.dataset.id === selection.id;
      tr.classList.toggle('sel', on); if (on) selRow = tr;
    });
    if (selRow) {
      const wrap = selRow.closest('.tableWrap'), rt = selRow.offsetTop, h = wrap.clientHeight;
      if (rt < wrap.scrollTop + 30 || rt > wrap.scrollTop + h - 30) wrap.scrollTop = rt - h / 2;
    }
    placeSelBox();
    const si = $('selInfo');
    if (!selection) { si.hidden = true; }
    else {
      si.hidden = false;
      if (selection.type === 'color') {
        const p = cur.res.palette[selection.idx];
        const n = cur.res.regions.filter((g) => g.colorIndex === selection.idx).length;
        si.innerHTML = `Seçili renk <b>${p.id}</b> <span class="sw" style="background:${p.hex}"></span> ${p.hex.toUpperCase()} · ${fmt(p.count)} px · ${fmt(n)} bölge <button class="btn small ghost" id="clrSel">Seçimi kaldır</button>`;
      } else {
        const g = cur.res.regions.find((x) => x.id === selection.id);
        si.innerHTML = `Seçili bölge: <b>${g.colorId}</b> <span class="sw" style="background:${g.color}"></span> ${g.color.toUpperCase()} · ${fmt(g.size)} px · x ${g.bbox[0]}–${g.bbox[2]}, y ${g.bbox[1]}–${g.bbox[3]} <button class="btn small ghost" id="clrSel">Seçimi kaldır</button>`;
      }
      $('clrSel').onclick = () => { selection = null; syncSelection(); };
    }
    draw();
  }

  // Seçili bölgenin etrafına çerçeve (1 px'lik bölgeler de görünsün diye)
  function placeSelBox() {
    let box = document.querySelector('.selBox');
    if (!selection || selection.type !== 'region') { if (box) box.remove(); return; }
    const g = cur.res.regions.find((x) => x.id === selection.id);
    if (!box) { box = document.createElement('div'); box.className = 'selBox'; cv.parentNode.appendChild(box); }
    const wr = cv.parentNode.getBoundingClientRect(), cr = cv.getBoundingClientRect();
    const sx = cr.width / cur.res.width, sy = cr.height / cur.res.height, pad = 3;
    box.style.left = (cr.left - wr.left + g.bbox[0] * sx - pad) + 'px';
    box.style.top = (cr.top - wr.top + g.bbox[1] * sy - pad) + 'px';
    box.style.width = ((g.bbox[2] - g.bbox[0] + 1) * sx + pad * 2) + 'px';
    box.style.height = ((g.bbox[3] - g.bbox[1] + 1) * sy + pad * 2) + 'px';
  }
  window.addEventListener('resize', () => { if (cur) placeSelBox(); });

  // ---------- Tuval ----------
  const cv = $('cv');
  function setupCanvas() {
    const r = cur.res;
    cv.width = r.width; cv.height = r.height;
    const scale = Math.max(1, Math.floor(560 / Math.max(r.width, r.height)));
    cv.style.width = r.width * scale + 'px';
    cv.style.height = 'auto';
    cv.style.aspectRatio = r.width + ' / ' + r.height;
  }

  function regionColor(id) {
    // deterministik, ayırt edilebilir renk (altın oran ile ton)
    const h = (id * 137.508) % 360, s = 55 + (id * 7) % 30, l = 45 + (id * 11) % 25;
    const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l / 100 - c / 2;
    let rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return rgb.map((v) => Math.round((v + m) * 255));
  }

  let borderMask = null;
  function getBorderMask() {
    const r = cur.res, W = r.width, H = r.height, src = cur.imageData.data;
    const m = new Uint8Array(W * H);
    const t = (x, y) => x < 0 || y < 0 || x >= W || y >= H || src[(y * W + x) * 4 + 3] === 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (t(x, y)) continue;
      if (t(x - 1, y) || t(x + 1, y) || t(x, y - 1) || t(x, y + 1)) m[y * W + x] = 1;
    }
    return m;
  }

  function draw() {
    if (!cur) return;
    const r = cur.res, W = r.width, H = r.height, src = cur.imageData.data, labels = r.labels;
    const out = new ImageData(W, H), d = out.data;
    if (view === 'outline' && (!borderMask || borderMask.length !== W * H || borderMask._for !== cur)) { borderMask = getBorderMask(); borderMask._for = cur; }
    const regColors = view === 'regions' ? new Map() : null;
    let selRegionSet = null;
    if (selection && selection.type === 'color') {
      selRegionSet = new Set(r.regions.filter((g) => g.colorIndex === selection.idx).map((g) => g.id));
    }
    for (let i = 0; i < W * H; i++) {
      const p = i * 4, lab = labels[i];
      if (lab < 0) { d[p + 3] = 0; continue; }
      let R = src[p], G = src[p + 1], B = src[p + 2], A = src[p + 3];
      if (view === 'regions') {
        let c = regColors.get(lab); if (!c) { c = regionColor(lab); regColors.set(lab, c); }
        [R, G, B] = c; A = 255;
      }
      let dim = false;
      if (view === 'outline' && !borderMask[i]) dim = true;
      if (selection) {
        const on = selection.type === 'region' ? lab === selection.id : selRegionSet.has(lab);
        if (!on) dim = true;
      }
      if (dim) { A = Math.round(A * (selection && selection.type === "region" ? 0.1 : 0.15)); }
      d[p] = R; d[p + 1] = G; d[p + 2] = B; d[p + 3] = A;
    }
    cv.getContext('2d').putImageData(out, 0, 0);
  }

  document.querySelectorAll('.viewTabs button').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    document.querySelectorAll('.viewTabs button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));

  cv.addEventListener('mousemove', (e) => {
    if (!cur) return;
    const rect = cv.getBoundingClientRect(), r = cur.res;
    const x = Math.floor((e.clientX - rect.left) / rect.width * r.width), y = Math.floor((e.clientY - rect.top) / rect.height * r.height);
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
    const i = y * r.width + x, lab = r.labels[i];
    if (lab < 0) { $('hover').textContent = `x ${x}, y ${y} · şeffaf`; return; }
    const g = r.regions.find((q) => q.id === lab);
    $('hover').innerHTML = `x ${x}, y ${y} · <b>${g.colorId}</b> <span class="sw" style="background:${g.color}"></span> ${g.color.toUpperCase()} · bölge ${fmt(g.size)} px`;
  });
  cv.addEventListener('click', (e) => {
    if (!cur) return;
    const rect = cv.getBoundingClientRect(), r = cur.res;
    const x = Math.floor((e.clientX - rect.left) / rect.width * r.width), y = Math.floor((e.clientY - rect.top) / rect.height * r.height);
    const lab = r.labels[y * r.width + x];
    if (lab === undefined || lab < 0) { selection = null; syncSelection(); return; }
    selection = selection && selection.type === 'region' && selection.id === lab ? null : { type: 'region', id: lab };
    syncSelection();
  });

  // ---------- JSON indirme ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('dlJson').addEventListener('click', () => {
    if (!cur) return;
    const r = cur.res;
    const data = {
      fileName: cur.name, width: r.width, height: r.height, colorCount: r.colorCount,
      palette: r.palette.map((p) => ({ id: p.id, hex: p.hex, count: p.count })),
      contentBox: r.contentBox,
      transparentPixels: r.transparentPixels, transparentRatio: r.transparentRatio, isFull: r.isFull,
      outline: r.outline, difficultyGroup: r.group,
      regionCount: r.regionCount, smallRegionCount: r.smallRegionCount, smallRegionRatio: r.smallRegionRatio,
      regions: r.regions.map((g) => ({ colorId: g.colorId, color: g.color, pixels: g.size, small: g.small, bbox: g.bbox })),
      difficultyScore: r.score, features: r.features,
    };
    download(cur.name.replace(/\.png$/i, '') + '-analiz.json', JSON.stringify(data, null, 2), 'application/json');
  });

  // ---------- Geçmiş ----------
  async function renderHistory() {
    const ul = $('history');
    let items = [];
    try { items = await DB.all(); } catch (e) { ul.innerHTML = '<li class="empty">Bu tarayıcıda geçmiş kaydı kullanılamıyor.</li>'; return; }
    items.sort((a, b) => b.date - a.date);
    if (!items.length) { ul.innerHTML = '<li class="empty">Henüz kayıt yok.</li>'; return; }
    ul.innerHTML = items.map((it) => {
      const s = it.summary, d = new Date(it.date);
      return `<li data-id="${it.id}" class="${cur && cur.historyId === it.id ? 'sel' : ''}" title="${esc(it.name)}">
        <img src="${it.thumb}" alt="">
        <div style="min-width:0"><div class="hn ellipsis">${esc(it.name)}</div>
        <div class="hm">${s.width}×${s.height} · ${esc(s.group)}${s.groupWarn ? ' ⚠' : ''} · skor ${s.score.toLocaleString('tr-TR')}</div>
        <div class="hm">${d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</div></div>
        <button class="del" title="Sil" aria-label="Sil">×</button></li>`;
    }).join('');
  }
  $('history').addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const id = +li.dataset.id;
    if (e.target.closest('.del')) {
      await DB.del(id);
      if (cur && cur.historyId === id) cur.historyId = null;
      renderHistory(); return;
    }
    const it = await DB.get(id);
    if (!it) return;
    const imageData = await decode(it.blob);
    const res = PixelAnalyzer.analyze(imageData.width, imageData.height, imageData.data);
    show({ name: it.name, imageData, res, historyId: id });
    if (window.innerWidth < 960) $('result').scrollIntoView({ behavior: 'smooth' });
  });
  $('clearHist').addEventListener('click', async () => {
    if (!confirm('Tüm geçmiş silinsin mi?')) return;
    await DB.clear(); renderHistory();
  });
  $('exportCsv').addEventListener('click', async () => {
    const items = (await DB.all()).sort((a, b) => a.date - b.date);
    const head = ['dosya', 'tarih', 'genislik', 'yukseklik', 'renk_sayisi', 'seffaf_orani', 'outline', 'zorluk_grubu', 'bolge_sayisi', 'kucuk_bolge_orani', 'zorluk_skoru'];
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = items.map((it) => {
      const s = it.summary;
      return [it.name, new Date(it.date).toISOString(), s.width, s.height, s.colors, s.transparentRatio.toFixed(4), s.outline ? 'var' : 'yok', s.group, s.regions, s.smallRegionRatio === undefined ? '' : s.smallRegionRatio.toFixed(4), s.score].map(q).join(',');
    });
    download('pixel-analyzer-gecmis.csv', '﻿' + [head.join(','), ...rows].join('\n'), 'text/csv');
  });

  renderHistory();
})();
