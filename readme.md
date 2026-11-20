# Reelix

CapCut tarzı masaüstü video düzenleyici (Electron + ffmpeg). Videoları birleştir, kes, geçiş ve ses ekle, animasyonlu altyazı oluştur, MP4 olarak dışa aktar.

> **Erken erişim (v0.1).** Reelix aktif geliştiriliyor; hatalar ve eksikler olabilir. Şu an yalnızca **macOS (Apple Silicon)** üzerinde denendi. Hazır bir uygulama paketi dağıtılmıyor, kaynak koddan çalıştırılır (aşağıya bak). Geri bildirim ve hata raporları için Issues bölümünü kullanabilirsin.

## Hızlı başlangıç
Gereksinimler: [Node.js](https://nodejs.org) 20 veya üstü, macOS.

```
git clone https://github.com/Aydin-Ocak/Reelix.git
cd Reelix
npm install
npm start
```

`npm install` sırasında ffmpeg, `ffmpeg-static` paketi aracılığıyla bilgisayarına indirilir; ayrıca ffmpeg kurman gerekmez. İlk altyazı oluşturmada Whisper modeli internetten indirilir (40–250 MB).

## Arayüz
- **Kitaplık (sol):** Medya, Ses, Metin, Geçiş ve Böl sekmeleri. Dosyalar içe aktarılır, oradan zaman çizelgesine sürüklenir ya da + ile eklenir.
- **Oynatıcı (orta):** canlı önizleme, kare hassasiyetli zaman kodu ve en-boy oranı seçimi.
- **Denetçi (sağ):** seçime göre değişir. Klip seçiliyse Video ve Ses sekmeleri, ses katmanı seçiliyse Ses, altyazı satırı seçiliyse metni düzenleme ve stil, geçiş seçiliyse Geçiş ayarları görünür.
- **Zaman çizelgesi (alt):**
  - Araç çubuğunda geri al, yinele, böl, sil, sessiz ve yakınlaştırma var.
  - Kliplerde video kareleri ve ses dalga formu görünür.
  - Ses bandının köşelerindeki yuvarlaklarla sesi yavaşça açıp kapatabilirsin.
- **Dışa aktarma:** sağ üstteki düğmeyle açılan pencereden H.264 MP4 olarak alınır.

## Özellikler
- Birden fazla videoyu birleştirme, kırpma ve oynatma kafasında bölme.
- Ses katmanları: başlangıç, seviye, fade, döngü.
- 12 geçiş efekti, başta karadan açılma ve sonda kararma.
- Animasyonlu altyazı ve okunan kelime vurgusu. Whisper ile otomatik altyazı oluşturur, SRT zamanlarını sesten düzeltir.
- Videoyu eşit parçalara, X saniyede bir ya da belirli zamanlardan bölme.
- Proje dosyası (.reelix; eski .kurgu projeleri de açılır).

## Klavye
`Boşluk` oynat · `←/→` bir kare (`⇧` ile bir saniye) · `⌘B` seçiliyi oynatma kafasından böl · `C` kesme aracı · `V` seçim aracı · `⇧`/`⌘` + tıkla çoklu seçim · `⌘G` / `⇧⌘G` grupla / grubu çöz · `⌫` sil · `⌘Z` / `⇧⌘Z` geri al / yinele · `⌘` + kaydırma yakınlaştır

## Seçim ve geçişler
- **Seçim kutusu:** zaman çizelgesinde boş bir yerden basıp sürükle; kutunun değdiği klipler ve sesler birlikte seçilir (⇧/⌘ ile mevcut seçime eklenir). Boşa tıklamak seçimi kaldırır ve oynatma kafasını oraya taşır; oynatma kafasını sürüklemek için üstteki cetveli kullan.
- **Video katmanları (overlay):** ana videonun üstünde ek video katmanları. Kitaplıktan bir videoyu ana izin üstüne sürükle veya kutucuktaki katman düğmesine bas. Katman klibi yatayda zamanı, dikeyde katmanı değiştirir; ana ize sürüklenirse ana ize, ana izdeki klip yukarı sürüklenirse katmana geçer. Oynatıcıda seçili katmanı sürükleyerek taşı, köşesinden büyüt/küçült; sağ panelden konum, ölçek, opaklık, "Köşe (PiP)" ve ses ayarları.
- **Ses izleri (katmanlar):** sesleri başlığından veya gövdesinden tutup yukarı-aşağı sürükleyerek başka bir ses izine taşı; en alttaki izin altına bırakınca yeni iz açılır. Bırakılan yerde başka bir ses varsa ses boş bir ize geçer, boşalan izler kendiliğinden kapanır.
- **Birlikte taşıma:** seçili öğelerden birini sürükleyince hepsi birlikte taşınır. Mıknatıs açıkken seçili video klipler blok halinde yeni sıraya yerleşir; kapalıyken klipler ve sesler zamanda birlikte kayar (aralarındaki mesafe korunur, sağa giderken önlerindeki klipleri iterler).
- **Geçiş kutusu:** iki klip arasındaki geçiş, süresi kadar genişlikte yarı saydam bir kutu ve ortada ⋈ simgesiyle gösterilir. Tıklayınca seçilir ve ayarları sağda açılır; seçiliyken kenarlarını sürükleyerek süresini değiştirebilirsin. ⌫ geçişi kaldırır.

## Zaman çizelgesi ayarları (araç çubuğunun sağı)
- **Ana iz mıknatısı:** açıkken video klipler arasında boşluk kalmaz, klip sürüklenince sırası değişir. Kapalıyken klipler serbestçe kaydırılır ve aralarında boşluk bırakılabilir; boşluklar dışa aktarmada siyah ve sessiz olur.
- **Otomatik yakalama:** sürüklerken klip, ses ve altyazı kenarlarına ve oynatma kafasına yapışır; yapıştığı yerde sarı bir çizgi görünür.
- **Bağlantı (▾ menü):** sesler ve altyazılar başladıkları video klibe bağlıdır; klip taşınınca, kırpılınca veya silinince onlar da kayar. Menüden sesler ve altyazılar ayrı ayrı açılıp kapatılır.
- **Önizleme ekseni (▾ menü):** fareyi zaman çizelgesinde gezdirince oynatıcı o kareyi gösterir. Menüden gezdirirken sesin çalması açılabilir.

Gruplu öğelerden biri kesildiğinde (kesme aracı veya ⌘B) gruptaki diğer katmanlar da aynı yerden kesilir; sol parçalar eski grupta, sağ parçalar yeni bir grupta kalır.

## Tasarım skill'leri
`.claude/skills/` altında iki skill var:
- `capcut-editor-ui`: bu uygulamanın tasarım sistemi (renkler, düzen, zaman çizelgesi kuralları).
- `frontend-design`: Anthropic'in genel arayüz tasarımı skill'i.

Arayüzde değişiklik yaparken önce bunlara bak.

## Derleme
```
npm run dist       # release/ altına .app üretir (macOS)
npm run dist:dmg   # .dmg üretir
```
Üretilen uygulama imzasızdır; ilk açılışta macOS'un güvenlik uyarısını onaylaman gerekebilir.

## Lisans ve üçüncü taraf bileşenler
Reelix kodu [MIT lisansı](LICENSE) ile yayınlanır.

Video işleme için [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) paketi kullanılır; bu paket kurulum sırasında GPL lisanslı bir ffmpeg derlemesi indirir. Bu depoda ffmpeg ikili dosyası bulunmaz ve dağıtılmaz. Altyazı için [Transformers.js](https://github.com/huggingface/transformers.js) ile OpenAI Whisper modelleri kullanılır; uygulama bunları çalışma zamanında indirir.
