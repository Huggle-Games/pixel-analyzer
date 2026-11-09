# Pixel Analyzer

Yarn oyunu (Yarnscapes benzeri) için pixel-art PNG analiz aracı. Tamamen tarayıcıda çalışır, sunucu ve yapay zeka yoktur. 1 piksel = 1 hücre, görsel büyütülmez.

## Çıktılar
- Dosya adı, görsel çözünürlüğü (px), içerik sınırları (şeffaf olmayan alanın min/max x,y ve genişlik×yükseklik)
- Renk sayısı, renk paleti: her renge kullanım miktarına göre `color0`, `color1`… id'si verilir (color0 en çok kullanılan)
- Şeffaf piksel oranı (alfa = 0 olan pikseller)
- Outline var/yok
- Zorluk grubu: Tutorial 64×64 dolu değil · Normal 128×128 dolu değil · Hard 128×128 tam dolu · Super Hard 256×256 dolu değil. "Tam dolu" = hiç şeffaf piksel yok. Standart dışı boyutlar en yakın gruba (logaritmik yakınlık, büyük kenar) atanır ve uyarı gösterilir.
- Bölgeler: aynı renkte, çapraz dahil 8 yönlü birbirine değen pikseller. Her bölgenin renk id'si, piksel sayısı, konumu ve küçük bölge (1–3 px) etiketi; liste küçükten büyüğe sıralı, renk id'sine göre filtrelenebilir.
- Küçük bölge oranı: 1–3 px bölgelerin tüm bölgelere oranı
- Zorluk skoru (0–100)
- Geçmiş: yüklenen dosyalar ve sonuçlar tarayıcının IndexedDB'sinde saklanır, CSV olarak dışa aktarılabilir.

## Outline tespiti
Kenar pikseli = en az bir 4-komşusu şeffaf ya da görüntü dışı olan opak piksel. Her kenar pikselinden içeri doğru en fazla 4 piksel yürünür, ilk farklı renk bulunur. Kenar rengi bu iç renkten belirgin şekilde koyuysa (parlaklık farkı > 18) "koyu kontur" sayılır.
Outline var ⇔ kenar piksellerinin ≥ %60'ı koyu kontur **veya** ≥ %60'ı tek bir renk.

## Zorluk skoru
Her bileşen 0–1 arasına normalize edilir, ağırlıklarla toplanıp 100 ile çarpılır.

| Bileşen | Ağırlık | 0 | 1 |
|---|---|---|---|
| Hücre sayısı (opak piksel) | %30 | 500 | 40.000 (log) |
| Renk sayısı | %20 | 4 | 48 |
| Bölge sayısı | %20 | 20 | 3.000 (log) |
| Parçalılık (ortalama bölge boyutu) | %15 | ≥ 60 px | ≤ 3 px (log) |
| Renk geçişi (4-komşu opak çiftlerde farklı renk oranı) | %15 | %10 | %55 |

Etiketler: 0–20 çok kolay, 20–40 kolay, 40–60 orta, 60–80 zor, 80+ çok zor.
"Best of Yarnscapes" örnekleri (36 görsel, ≈100×100) 22–63 arasında, çoğu 48–60.
Ağırlıklar ve sınırlar `analyzer.js` içinde `WEIGHTS` ve `difficultyScore` fonksiyonunda.

## Yayın
Statik dosyalar (index.html, style.css, analyzer.js, app.js). GitHub Pages: Settings → Pages → Branch: main / root.
