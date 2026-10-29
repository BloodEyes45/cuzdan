# Cüzdan

<p align="center">
  <img src="icons/icon-192.png" width="96" height="96" alt="Cüzdan logosu">
</p>

Banka hesaplarını, nakdi ve kredi kartlarını tek ekranda toplayan küçük bir cüzdan uygulaması. Gelir ve gider girdikçe hesap bakiyeleri güncellenir; toplam para, kart borçları düşülerek gösterilir.

Saf **HTML + CSS + JavaScript**. Derleme adımı, paket yöneticisi veya sunucu tarafı yok.

## Özellikler

- Çoklu hesap: banka/nakit hesapları ve kredi kartları
- Tek toplam: nakit varlık − kart borçları
- Gelir / gider kaydı: hesap seçimi, kategori, not
- Kredi kartı harcaması borcu artırır, gelir borcu azaltır
- Aylık geçmiş: gelen, giden, net; günlük harcama grafiği ve kategori dağılımı
- Kayıt düzenleme, silme ve silmeyi geri alma
- Hesap ekleme, silme ve bakiye düzenleme
- Koyu / açık tema (sistem temasına uyum)
- JSON yedek alma ve geri yükleme
- Telefon ana ekranına ekleme için ikon ve manifest

## Yerelde çalıştırma

Klasörün içinde basit bir statik sunucu açmak yeterli:

```bash
python -m http.server 8123
```

Ardından tarayıcıda `http://localhost:8123` adresini aç.

Doğrudan `index.html` dosyasını açmak da çalışır; ancak manifest ve bazı tarayıcı özellikleri için sunucu üzerinden açmak daha iyidir.

## GitHub Pages ile yayınlama

1. Bu klasörü GitHub'da bir depoya yükle (public).
2. Depoda **Settings → Pages** bölümüne git.
3. **Source: Deploy from a branch**, branch: `main`, klasör: `/ (root)` seç ve kaydet.
4. Bir dakika sonra uygulama şu adreste yayında olur:

   ```text
   https://KULLANICI_ADI/DEPO_ADI/
   ```

5. Telefonda bu adresi aç. iPhone'da **Safari → Paylaş → Ana Ekrana Ekle**; Android'de **Chrome → Menü → Ana ekrana ekle**. Logoyla birlikte uygulama simgesi oluşur.

Depoyu ilk kez gönderirken:

```bash
git remote add origin https://github.com/KULLANICI_ADI/cuzdan.git
git push -u origin main
```

## Veriler

- Tüm veriler tarayıcının `localStorage` alanında (`cuzdan.v1`) tutulur; hiçbir sunucuya gönderilmez.
- Telefon değiştirirken veya tarayıcı verisini temizlemeden önce **Ayarlar → Yedek al** ile JSON dosyasını sakla; yeni cihazda **Yedekten yükle** ile geri getir.

## Dosyalar

| Dosya | Açıklama |
| --- | --- |
| `index.html` | Ekranlar ve arayüz iskeleti |
| `styles.css` | Liquid glass teması, mobil yerleşim |
| `app.js` | Hesaplar, bakiyeler, kayıtlar, grafikler |
| `logo.svg` | Vektör logo |
| `manifest.json` | Ana ekrana ekleme tanımı |
| `icons/` | Uygulama ikonları (180, 192, 512, 1024 px) |

## Not

Kart ödemesi ayrı bir kayıt türü değildir. Kart borcunu düşürmek için kart hesabına **Gelir** girebilir veya **Ayarlar → Hesaplar** bölümünden ilgili hesabın bakiyesini düzeltebilirsin.
