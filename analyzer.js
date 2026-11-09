/* Pixel Analyzer – analiz çekirdeği (tarayıcı + Node).
 * Girdi: genişlik, yükseklik, RGBA bayt dizisi. 1 piksel = 1 hücre, ölçekleme yok.
 * Yapay zeka yok, tamamen algoritmik.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PixelAnalyzer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GROUPS = [
    { id: 'tutorial', name: 'Tutorial', size: 64, full: false },
    { id: 'normal', name: 'Normal', size: 128, full: false },
    { id: 'hard', name: 'Hard', size: 128, full: true },
    { id: 'superhard', name: 'Super Hard', size: 256, full: false },
  ];

  // Zorluk skoru ağırlıkları (toplam 1). Ayrıntılar README / "Skor nasıl hesaplanır" bölümünde.
  // Küçük bölge: 1–3 piksellik bölge
  const SMALL_REGION_MAX = 3;

  const WEIGHTS = { cells: 0.30, colors: 0.20, regions: 0.20, fragment: 0.15, edges: 0.15 };

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  function keyToRGBA(k) {
    return [(k >>> 24) & 255, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];
  }
  function keyToHex(k) {
    const [r, g, b, a] = keyToRGBA(k);
    return '#' + hex2(r) + hex2(g) + hex2(b) + (a === 255 ? '' : hex2(a));
  }

  function analyze(width, height, data) {
    const W = width, H = height, N = W * H;
    // Her piksel için renk anahtarı; şeffaf = -1
    const key = new Float64Array(N); // uint32 değerleri güvenli tutmak için
    let transparent = 0, semi = 0;
    const counts = new Map();
    for (let i = 0; i < N; i++) {
      const p = i * 4, a = data[p + 3];
      if (a === 0) { key[i] = -1; transparent++; continue; }
      if (a < 255) semi++;
      const k = ((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | a) >>> 0;
      key[i] = k;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const opaque = N - transparent;

    // Görselin içindeki (şeffaf olmayan) içeriğin sınırları
    let cMinX = W, cMinY = H, cMaxX = -1, cMaxY = -1;
    for (let i = 0; i < N; i++) {
      if (key[i] < 0) continue;
      const x = i % W, y = (i - x) / W;
      if (x < cMinX) cMinX = x; if (x > cMaxX) cMaxX = x;
      if (y < cMinY) cMinY = y; if (y > cMaxY) cMaxY = y;
    }
    const contentBox = cMaxX < 0 ? null : { minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY, width: cMaxX - cMinX + 1, height: cMaxY - cMinY + 1 };

    // Palet
    const palette = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, c], i) => ({ id: 'color' + i, key: k, hex: keyToHex(k), rgba: keyToRGBA(k), count: c, ratio: opaque ? c / opaque : 0 }));
    const colorIndex = new Map(palette.map((p, i) => [p.key, i]));

    // Bölgeler: aynı renk + 8 yönlü (çapraz dahil) bağlantı
    const label = new Int32Array(N).fill(-1);
    const regions = [];
    const stack = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (key[i] < 0 || label[i] >= 0) continue;
      const id = regions.length, k = key[i];
      let sp = 0, size = 0;
      let minX = W, minY = H, maxX = -1, maxY = -1;
      stack[sp++] = i; label[i] = id;
      while (sp) {
        const j = stack[--sp];
        size++;
        const x = j % W, y = (j - x) / W;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx; if (nx < 0 || nx >= W) continue;
            const n = ny * W + nx;
            if (label[n] < 0 && key[n] === k) { label[n] = id; stack[sp++] = n; }
          }
        }
      }
      regions.push({ id, color: keyToHex(k), colorIndex: colorIndex.get(k), colorId: 'color' + colorIndex.get(k), size, bbox: [minX, minY, maxX, maxY] });
    }

    // Komşu farklı renk geçişleri (4 yönlü, sadece opak-opak çiftler)
    let pairs = 0, diffPairs = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (key[i] < 0) continue;
      if (x + 1 < W && key[i + 1] >= 0) { pairs++; if (key[i + 1] !== key[i]) diffPairs++; }
      if (y + 1 < H && key[i + W] >= 0) { pairs++; if (key[i + W] !== key[i]) diffPairs++; }
    }

    const outline = detectOutline(W, H, key);
    const group = classifyGroup(W, H, transparent);

    for (const r of regions) r.small = r.size <= SMALL_REGION_MAX;
    const smallRegions = regions.filter((r) => r.small).length;
    const features = {
      cells: opaque,
      colors: palette.length,
      regions: regions.length,
      avgRegionSize: regions.length ? opaque / regions.length : 0,
      smallRegionRatio: regions.length ? smallRegions / regions.length : 0,
      edgeDensity: pairs ? diffPairs / pairs : 0,
    };
    const score = difficultyScore(features);

    return {
      width: W, height: H, totalPixels: N,
      transparentPixels: transparent, opaquePixels: opaque,
      transparentRatio: N ? transparent / N : 0,
      semiTransparentPixels: semi,
      isFull: transparent === 0,
      colorCount: palette.length,
      palette,
      regionCount: regions.length,
      regions: regions.slice().sort((a, b) => a.size - b.size || a.colorIndex - b.colorIndex || a.id - b.id),
      contentBox,
      smallRegionCount: smallRegions,
      smallRegionRatio: regions.length ? smallRegions / regions.length : 0,
      labels: label,
      outline, group, features, score,
    };
  }

  /* Outline (dış çizgi) tespiti
   * Kenar pikseli: en az bir 4-komşusu şeffaf ya da görüntü dışı olan opak piksel.
   * Her kenar pikselinden içeri doğru (şeffaf tarafın tersine) en fazla 4 piksel yürünür ve
   * ilk farklı renge bakılır. Kenar rengi bu iç renkten belirgin şekilde koyuysa "kontur" sayılır.
   * Outline var: kenar piksellerinin ≥%60'ı kontur ise YA DA ≥%60'ı tek bir renkse.
   * Tam dolu (şeffafsız) görsellerde kenar = görüntü çerçevesi.
   */
  function detectOutline(W, H, key) {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const isT = (x, y) => x < 0 || y < 0 || x >= W || y >= H || key[y * W + x] < 0;
    let border = 0, contour = 0;
    const borderColors = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, k = key[i];
      if (k < 0) continue;
      let out = null;
      for (const d of dirs) if (isT(x + d[0], y + d[1])) { out = d; break; }
      if (!out) continue;
      border++;
      borderColors.set(k, (borderColors.get(k) || 0) + 1);
      // içeri yürü
      const ix = -out[0], iy = -out[1];
      let inner = null;
      for (let s = 1; s <= 4; s++) {
        const nx = x + ix * s, ny = y + iy * s;
        if (isT(nx, ny)) break;
        const nk = key[ny * W + nx];
        if (nk !== k) { inner = nk; break; }
      }
      if (inner !== null) {
        const a = keyToRGBA(k), b = keyToRGBA(inner);
        if (lum(a[0], a[1], a[2]) + 18 < lum(b[0], b[1], b[2])) contour++;
      }
    }
    let domKey = null, domCount = 0;
    for (const [k, c] of borderColors) if (c > domCount) { domCount = c; domKey = k; }
    const contourRatio = border ? contour / border : 0;
    const dominantRatio = border ? domCount / border : 0;
    const has = border > 0 && (contourRatio >= 0.6 || dominantRatio >= 0.6);
    let type = 'yok';
    if (has) type = dominantRatio >= 0.6 ? 'tek renk' : 'koyu kontur (çok renkli)';
    return {
      has, type, borderPixels: border, contourRatio, dominantRatio,
      dominantColor: domKey !== null ? keyToHex(domKey) : null,
    };
  }

  /* Zorluk grubu: boyut olarak en yakın hedef (64/128/256, logaritmik yakınlık) + dolu/boş durumu. */
  function classifyGroup(W, H, transparent) {
    const warnings = [];
    const full = transparent === 0;
    const side = Math.max(W, H);
    if (W !== H) warnings.push(`Görsel kare değil (${W}×${H}); büyük kenar (${side}) esas alındı.`);
    const sizes = [64, 128, 256];
    let nearest = sizes[0], best = Infinity;
    for (const s of sizes) { const d = Math.abs(Math.log2(side / s)); if (d < best) { best = d; nearest = s; } }
    const exact = W === nearest && H === nearest;
    if (!exact) warnings.push(`Boyut standart değil: ${W}×${H}. En yakın hedef ${nearest}×${nearest} kabul edildi.`);
    let g;
    if (nearest === 64) {
      g = GROUPS[0];
      if (full) warnings.push('Tutorial grubu dolu olmayan (şeffaf arka planlı) görsel bekler, bu görsel tam dolu.');
    } else if (nearest === 128) {
      g = full ? GROUPS[2] : GROUPS[1];
    } else {
      g = GROUPS[3];
      if (full) warnings.push('Super Hard grubu dolu olmayan (şeffaf arka planlı) görsel bekler, bu görsel tam dolu.');
    }
    return { id: g.id, name: g.name, targetSize: nearest, exact, full, warnings };
  }

  /* Zorluk skoru (0–100)
   * Her bileşen 0–1 aralığına normalize edilir, ağırlıklı toplam ×100.
   *  cells    – örülecek hücre sayısı (iş miktarı): log ölçek, 500 → 0, 40.000 → 1
   *  colors   – renk sayısı: 4 → 0, 48 → 1
   *  regions  – bölge sayısı (ayrı ayrı doldurulacak parça): log ölçek, 20 → 0, 3.000 → 1
   *  fragment – ortalama bölge küçüklüğü: ort. bölge 60+ px → 0, 3 px → 1 (log)
   *  edges    – komşu hücrelerde renk değişim oranı: 0.10 → 0, 0.55 → 1
   */
  function difficultyScore(f) {
    const logNorm = (v, lo, hi) => clamp01(Math.log(Math.max(v, 1) / lo) / Math.log(hi / lo));
    const parts = {
      cells: logNorm(f.cells, 500, 40000),
      colors: clamp01((f.colors - 4) / (48 - 4)),
      regions: logNorm(f.regions, 20, 3000),
      fragment: f.avgRegionSize ? 1 - logNorm(f.avgRegionSize, 3, 60) : 0,
      edges: clamp01((f.edgeDensity - 0.10) / (0.55 - 0.10)),
    };
    let s = 0;
    for (const k in WEIGHTS) s += WEIGHTS[k] * parts[k];
    const value = Math.round(s * 1000) / 10;
    let label = 'Çok kolay';
    if (value >= 80) label = 'Çok zor';
    else if (value >= 60) label = 'Zor';
    else if (value >= 40) label = 'Orta';
    else if (value >= 20) label = 'Kolay';
    return { value, label, parts, weights: WEIGHTS };
  }

  return { SMALL_REGION_MAX, analyze, classifyGroup, detectOutline, difficultyScore, GROUPS, WEIGHTS };
});
