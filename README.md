# Orhaniye Hub + Neon PostgreSQL (başlangıç paketi)

Bu paket mevcut `public/index.html` dosyanı **değiştirmeden** korur ve yanına Neon PostgreSQL kullanan bir Node.js/Express API ekler. API; kayıt başvuruları, onaylı hesapla giriş/çıkış, video metadata kayıtları, sayfalı video listesi ve görüntülenme sayacı için temel uç noktalar içerir.

> **Önemli ve dürüst not:** Mevcut `index.html`, kendi içinde `localStorage` tabanlı eski uygulama durumunu kullanıyor. Bu paket API'yi ve veritabanı şemasını hazırlar ama eski HTML arayüzünün bütün düğmelerini otomatik olarak API'ye bağlamaz. Arayüz entegrasyonu ayrı bir geliştirme adımıdır. Şu anki kayıt/giriş akışını bu API ile değiştirmeden önce test et.

## Mimari

- **GitHub Pages:** yalnızca statik ön yüz (`public/index.html`).
- **Render veya benzeri Node.js hostu:** API (`server.js`). GitHub Pages Node.js sunucusu çalıştırmaz.
- **Neon:** kullanıcılar, video kayıtları, yorumlar, beğeniler ve olaylar.
- **Video dosyaları:** bu API yalnızca video URL'sini ve bilgilerini saklar; dosyanın kendisini yüklemez. Video dosyaları için ayrı bir nesne depolama hizmeti ve doğrudan/yetkili yükleme akışı gerekir.

## 1. Neon veritabanını hazırla

1. Neon Console → SQL Editor aç.
2. `sql/schema.sql` dosyasının tamamını SQL Editor'e yapıştır.
3. **Run** bas. Bu tabloları ve indeksleri oluşturur.

## 2. Bilgisayarda/Termux'ta yerel çalıştırma

Node.js 20 veya üstü gerekir.

```bash
npm install
cp .env.example .env
```

`.env` dosyasını düzenle:

- `DATABASE_URL`: Neon Connect ekranındaki PostgreSQL connection string. `sslmode=require` içermeli.
- `JWT_SECRET`: en az 32 karakterlik rastgele gizli değer.
- `FRONTEND_ORIGIN`: ön yüzün tam adresi. Yerelde `http://localhost:3000` olabilir.

Sonra:

```bash
npm start
```

Kontrol et: `http://localhost:3000/api/health` → `{"ok":true,"database":"connected"}` beklenir.

`.env` dosyasını asla GitHub'a gönderme. Gerçek bağlantı adresini sohbetlerde paylaşma. Daha önce paylaştıysan Neon'dan parolayı sıfırla.

## 3. GitHub Pages + API hostu

1. Bu klasörü GitHub deposuna yükle; gerçek `.env` dosyasını yükleme.
2. GitHub deposunda Settings → Pages bölümünden `public` klasörünü yayınlamak doğrudan desteklenmediği için en basit yöntem, `public/index.html` dosyasını ayrı bir `docs/index.html` konumuna kopyalamak ve Pages source olarak `main /docs` seçmektir. Alternatif olarak `public` içeriğini depo köküne koyabilirsin.
3. API'yi Render gibi Node.js barındıran bir hizmete ayrı deploy et. Build command: `npm install`; Start command: `npm start`.
4. API hostunun Environment ayarlarına `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN` ve `NODE_ENV=production` ekle. `FRONTEND_ORIGIN` değerini gerçek GitHub Pages URL'in yap.
5. `server.js` içinde `secure` cookie üretimde açıktır; API mutlaka HTTPS üzerinden çalışmalı.

## API uç noktaları

- `GET /api/health` — API ve veritabanı sağlık kontrolü.
- `POST /api/auth/register` — `{ "username", "displayName", "email", "password" }`; kayıt `pending` olur.
- `POST /api/auth/login` — `{ "username", "password" }`; yalnızca `active` hesaplara giriş verir, oturum HttpOnly cookie ile tutulur.
- `GET /api/auth/me` — mevcut oturum.
- `POST /api/auth/logout` — oturumu temizler.
- `GET /api/videos?limit=20&before=123` — onaylı video kayıtları; `limit` en fazla 50.
- `POST /api/videos` — giriş yapmış kullanıcı için video metaverisi; kayıt onay bekler. JSON: `{ "title", "description", "category", "videoUrl", "thumbnailUrl" }`.
- `POST /api/videos/:id/view` — onaylı videonun görüntülenme sayısını artırır.

Tarayıcıdan API çağrısı yaparken `credentials: 'include'` kullanılmalıdır. Kayıtların onaylı duruma alınması için yönetici paneli/komutu henüz eklenmedi; `pending` kayıtları elle SQL'den etkinleştirmek yalnızca ilk test içindir. Gerçek yayına geçmeden yönetici onay akışı eklenmelidir.

## Ölçek ve güvenlik notları

- PostgreSQL sorguları parametreli; parola hash'i bcrypt ile saklanır; giriş uç noktalarında hız sınırı vardır.
- Bağlantı havuzu sınırlıdır ve video listesi sayfalıdır. Bu, yoğunluğu azaltmaya yardım eder ama ücretsiz planın sınırlarını ortadan kaldırmaz.
- API CORS yalnızca `FRONTEND_ORIGIN` adresine izin verir. Pages URL'i değişirse ortam değişkenini güncelle.
- Bu başlangıç paketinde video dosyası upload/depolama, e-posta doğrulama, parola sıfırlama, yönetici onay paneli, yorum/beğeni uç noktaları ve eski `localStorage` verilerinin otomatik taşınması henüz uygulanmadı.
- `index.html` içindeki eski `localStorage` tabanlı giriş/kayıt sistemini bu API ile entegre etmeden, mevcut arayüzün hesapları ve videoları kalıcı şekilde Neon'a kaydedildiğini varsayma.
