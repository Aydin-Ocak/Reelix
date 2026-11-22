---
name: capcut-editor-ui
description: Reelix'nun CapCut masaüstü düzenleyicisine benzeyen tasarım sistemi. Bu projede arayüze dokunan her değişiklikte (yeni panel, düğme, zaman çizelgesi bileşeni, renk veya düzen) kullan; renk/tipografi token'larını, panel düzenini ve zaman çizelgesi bileşen kurallarını tanımlar.
---

# CapCut tarzı düzenleyici arayüzü (Reelix)

Reelix bir video düzenleyici. Hedef görünüm CapCut masaüstü: koyu nötr gri paneller, tek bir camgöbeği vurgu, yoğun ama sakin bir çalışma alanı. Arayüz içeriğe (videoya) hizmet eder; panel kromu geri planda kalır. Bu brief görsel yönü sabitlediği için `frontend-design` skill'indeki "varsayılanlardan kaçın" kuralı burada CapCut diline sadık kalmakla sınırlanır.

## Token'lar (src/styles.css içindeki `:root`)

| Token | Değer | Kullanım |
|---|---|---|
| `--gap` | `#0e0e0f` | Paneller arası boşluk / pencere zemini |
| `--panel` | `#1a1a1b` | Panel yüzeyi |
| `--raise` | `#242426` | Girdi, kart, ikincil düğme |
| `--hover` | `#2e2e31` | Üzerine gelme |
| `--line` | `#2b2b2e` | 1px ayırıcılar |
| `--tx` / `--mut` | `#e8e8ea` / `#8d8d93` | Metin / ikincil metin |
| `--cy` | `#00c8d2` | Tek vurgu: seçili durum, birincil düğme, kaydırıcı, oynatma kafası tutamacı |
| `--clip-v` | `#21393d` | Video klip zemini |
| `--clip-a` | `#16443f` + dalga `#3fd8c4` | Ses klipleri |
| `--clip-t` | `#6a4a24` | Altyazı/metin klipleri |

Kurallar:
- Vurgu rengi yalnızca **seçim, birincil eylem ve etkin durum** için. Dekoratif gradyan yok.
- Panel köşeleri 8px; panel içi öğeler 4–6px. Gölge yalnızca açılır menü/modal için.
- Gerçek siyah (`#000`) yalnızca video önizleme alanında.

## Tipografi
- Sistem fontu (SF Pro), 12px gövde, 13px panel başlıkları (600), 11px ikincil.
- Bölüm başlıkları cümle düzeninde ("Ses seviyesi"), BÜYÜK HARF etiket yok.
- Zaman kodları `ui-monospace`, `HH:MM:SS:FF`; geçerli zaman `--tx`, toplam `--mut`.

## Düzen
```
┌────────────── üst çubuk: logo · proje adı (orta) · [Dışa aktar] ──────────────┐
├─ Kitaplık (sol) ─┬────────── Oynatıcı (orta) ──────────┬─ Denetçi (sağ) ─┤
│ ikon sekmeleri   │  başlık "Oynatıcı"                  │ seçime göre      │
│ Medya Ses Metin  │  video (siyah zemin)                │ Video | Ses      │
│ Geçiş Böl        │  zaman kodu · oynat · oran seçimi   │ Metin | Geçiş    │
├──────────────────┴─────────────────────────────────────┴──────────────────┤
│ araç çubuğu: geri al · yinele · böl · sil · sessiz       yakınlaştır ─○─  │
│ zaman çizelgesi: cetvel · video · ses · altyazı izleri                     │
└────────────────────────────────────────────────────────────────────────────┘
```
- Paneller arasında 4px `--gap` boşluğu; her panel kendi başlığına sahip (36px).
- Sol kitaplık: üstte ikon+etiket sekme satırı; medya ızgarası (16:9 küçük resim, sağ altta süre çipi, üzerine gelince `+`).
- Sağ denetçi bağlama duyarlı: klip → Video/Ses sekmeleri; ses katmanı → Ses; altyazı → Metin; geçiş → Geçiş; boş → proje özeti.
- Dışa aktarma bir **modal** (üst çubuktaki camgöbeği "Dışa aktar" düğmesi açar).

## Zaman çizelgesi bileşenleri
- Klip: üstte ad + süre çipleri, küçük resim şeridi, altta ses bandı. Seçili klip: 2px **beyaz** çerçeve.
- Ses bandında CapCut fade tutamaçları: sol/sağ üst köşede beyaz halka; içeri kaydırınca dipten normale rampa; çizgiyi dikey sürükleme = seviye.
- Kesme noktalarında küçük geçiş düğmesi; geçiş varsa vurgu renginde rozet.
- Oynatma kafası: beyaz 1px çizgi + üstte beyaz yuvarlatılmış tutamaç.
- ⌘ + kaydırma yakınlaştırır (imleç çapalı); araç çubuğunda yakınlaştırma kaydırıcısı.

## Etkileşim
- Hareket yalnızca kullanıcı eylemine yanıt olarak (seçim, açılma); giriş animasyonu yok.
- Klavye: Boşluk oynat, ←/→ kare/saniye, ⌘Z / ⇧⌘Z geri al/yinele, ⌫ seçiliyi sil, ⌘B böl, C kesme aracı, V seçim aracı, ⌘G / ⇧⌘G grupla/çöz.
- Araçlar: seçim (ok) ve kesme (jilet); kesme modunda imleç artı, kırmızı kesim çizgisi imleci izler ve oynatma kafasına yapışır.
- Araç çubuğunun sağında CapCut ayar düğmeleri: ana iz mıknatısı, otomatik yakalama, bağlantı (▾), önizleme ekseni (▾). Açık = camgöbeği ikon, kapalı = gri; ▾ ayrı koyu bir düğmede, açılır menü `.pop`.
- Yakalama çizgisi sarı (`#ffd84a`), önizleme ekseni çizgisi yarı saydam beyaz, kesme çizgisi kırmızı.
- Video katmanı izleri ana izin üstünde (`.track.otrack`, katman simgesi, klip zemini `#2b3350`); oynatıcıda seçili katman camgöbeği çerçeve + beyaz köşe tutamaçları.
- Çoklu seçim ⇧/⌘ + tıklama; seçili öğeler beyaz çerçeve. Gruplu öğelerin başlığında camgöbeği zincir çipi.
- Odak halkası `--cy` 2px.

## Yazı dili
- Türkçe, kısa, eylem odaklı düğmeler: "Dışa aktar", "Böl", "Sil", "Geri al".
- Boş durumlar ne yapılacağını söyler: "Video eklemek için İçe aktar'a tıkla veya dosyaları buraya sürükle".
