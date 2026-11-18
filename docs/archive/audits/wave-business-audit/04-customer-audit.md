# 🛒 Alıcı (End-Customer) Black-Box Brauzer Auditi Hesabatı

**Hədəf:** `http://localhost:3000`  
**Rol:** Adi Alıcı / Gündəlik Onlayn Müştəri (End Customer)  
**Metod:** 100% Black-Box İnteraktiv Brauzer Testi (kod bazasına baxılmadan)  
**Tarix:** 2026-11-13  

---

## 🎯 Yekun Qərar: Bu gün bu mağazadan alış-veriş edərdimmi?
> **XEYR, tərəddüd edər və çox güman ki, səbəti tərk edib saytdan çıxardım.**  
> Əsas alış mexanikaları (məhsulun səbətə atılması, sayın dəyişdirilməsi, checkout forması) texniki olaraq işləsə də; mobildə saytın tamamilə dağılması, ziddiyyətli çatdırılma qiyməti, 404 xətalı linklər və şübhəli test məhsulları müştəridə inamsızlıq və narahatlıq yaradır.

---

## 🔍 Detallı Addımbaaddım Audit Nəticələri

### 1. Ana Səhifə və İlk Təəssürat (`/az`)
* **Müsbət:** Yuxarı bildiriş zolağı (*"100 AZN-dən yuxarı sifarişlərə Pulsuz Çatdırılma"*) və axtarış paneli aydın görünür. Hero banneri və *"Alış-verişə başla"* düyməsi səliqəlidir.
* **Vizual Qüsur — Kartlarda Yarımçıq Mətnlər:** Hero bannerinin altında 4 zəmanət kartı var (*Pulsuz Çatdırılma*, *Çatdırılmada Ödəniş*, *Asan Qaytarma*, *Təhlükəsiz Alış-veriş*). Kartların içində kifayət qədər boş yer olmasına baxmayaraq, bütün alt yazılar nöqtələrlə yarımçıq kəsilib (məs: `100 AZN-dən yuxarı...`, `Nağd • Kart...`, `14 gün ərzində...`).
* **İnamsızlıq Yaradan Detal — Şübhəli "Günün Təklifi":** Ana səhifədə taymerlə `dsdvsdv` adlı məhsul **0.00 AZN** qiyməti ilə (*"Ayda 0.00 AZN — 12 aya"*) göstərilir. Bu, alıcı üçün saytın fırıldaq və ya yarımçıq qalmış təəssüratını yaradır.
* **Test Məlumatı Çirkliliyi:** "Seçilmiş məhsullar" bölməsindəki məhsulların demək olar ki, hamısı şəkilsiz boz ikona malik `Qəbz Test Məhsulu` adlı təkrarlanan məhsullardır (25.00 AZN).

---

### 2. Axtarış və Kataloq Filtrləri (`/az/search` & `/az/products`)
* **Axtarış Funksionallığı:** Axtarış paneli sorğunu qəbul edir və nəticələr səhifəsinə yönləndirir.
* **Ciddi UX Boşluğu — Axtarışda Filtr və Səhifələnmə Yoxdur:** `/az/search` səhifəsində 50+ məhsul çıxsa belə, **heç bir çeşidləmə (sort), qiymət filtri, kateqoriya və ya səhifələmə (pagination)** yoxdur. Alıcı məcburdur ki, yüzlərlə məhsulu filtrləmədən sonsuz aşağı sürüşdürsün.
* **Kataloq Səhifəsi (`/az/products`):** "Sırala" menyusu işləyir (qiymətə, yeniliyə görə sıralama düzgün reaksiya verir). Lakin brend, ölçü, rəng və ya "yalnız stokda olanlar" kimi fasetli filtrlər çatışmır.

---

### 3. Məhsul Səhifəsi və Detallar (`/az/products/...`)
* **Tez Baxış (Quick View):** Tez açılır, şəkil və qiyməti göstərir, lakin variant seçimi və stok qalığı göstəricisi yoxdur.
* **Məhsul Detal Səhifəsi (PDP):**
  1. **Vizual Qüsur — Təkrarlanan İkiqat Breadcrumb:** Səhifənin yuxarısında bir-birinin üstünə iki eyni breadcrumb xətti düşür:
     * 1-ci sətir: `Ana səhifə / Məhsullar / Test Product 3`
     * 2-ci sətir: `Ana səhifə / Məhsullar / Test Product 3`
  2. **İşləməyən Link (HTTP 404):** Məhsul səhifəsindəki "Ölçü cədvəli" (Size Guide) linki klikləndikdə `/az/size-guide` səhifəsinə keçir və **404 Səhifə Tapılmadı** xətası verir.
  3. **Oxunma Çətinliyi (A11y Kontrastı):** "Çatdırılma və Qaytarılma" məlumat qutusundakı mətn çox solğun boz rəngdədir, açıq boz fonda oxumaq olduqca çətindir.
  4. **Tərcümə Qüsuru:** Sevimlilər (ürək) düyməsinin üzərinə gəldikdə tooltip Azərbaycan dili əvəzinə ingiliscə çıxır (*"Add to wishlist"*).

---

### 4. Səbət Drawer Təcrübəsi
* **Müsbət:** Məhsulu səbətə atdıqda dərhal toast bildirişi çıxır, səbət sayğacı dərhal yenilənir (məs: 0-dan 2-yə).
* **Müsbət:** `+` və `-` düymələri ilə say dəyişdikdə yekun məbləğ və vergi dərhal yenidən hesablanır.
* **Müsbət:** Pulsuz çatdırılma progress-barı dinamik olaraq nə qədər alış-veriş qalmasını real vaxtda göstərir.
* **Kritik UX Qüsuru — Səbət Pəncərəsi Checkout-u Örtür:** "Sifariş ver" düyməsi klikləndikdə URL `/az/checkout` ünvanına dəyişir, lakin **Səbət Drawer-i bağlanmır və bütün checkout səhifəsini tamamilə örtülü saxlayır**! Müştəri çaşqınlıq içində qalır və yalnız səbətin kiçik `✕` düyməsini tapıb bağladıqdan sonra checkout formasını görə bilir.

---

### 5. Sifarişin Rəsmiləşdirilməsi (Checkout - `/az/checkout`)
* **Müsbət:** Ad, WhatsApp nömrəsi (`+994...`), çatdırılma ünvanı və qeydlər sahəsi düzgün işləyir və validasiya edir.
* **İnamsızlıq Yaradan Maliyyə Ziddiyyəti:** Header-də və səbət drawer-ində açıq şəkildə **"Pulsuz çatdırılma yalnız 100 AZN-dən yuxarı sifarişlərədir"** yazıldığı halda, checkout səhifəsində cəmi **19.98 AZN** olan sifariş üçün Çatdırılma: **"Pulsuz"** yazılır. Real müştəri burada çaşqınlıq yaşayır: "Çatdırılma həqiqətən pulsuzdur, yoxsa qapıda məndən əlavə pul istəyəcəklər?"

---

### 6. Dillərarası Keçid və Məlumat İtkisi
* **Müsbət:** `AZ`, `RU`, `EN` dilləri arasında keçid menyuları və səhifə mətnlərini təmiz şəkildə dəyişir.
* **Məlumat İtkisi Xətası (Data Loss Bug):** Müştəri checkout formasında adını, nömrəsini və ünvanını yazdıqdan sonra səhifənin yuxarısından dili dəyişərsə, səhifə yenilənir və **yazılmış bütün şəxsi məlumatlar və ünvan silinir**!

---

### 7. Mobil Görünüş (`390x844` Viewport)
* **BLOKER — Mobil Dizayn Tamamilə Dağılıb:**
  * Smartfon ölçüsündə (`390x844`) test edildikdə bütün səhifə konteyneri **`823.2px` enində kilidli qalır**!
  * Header elementlərinin (Axtarış, Səbət, Profil, Dil seçici) 50%-dən çoxu ekranın sağ tərəfindən kənara çıxır və görünmür.
  * Məhsul şəbəkəsi 4 sütunluq desktop ölçüsündə qalır, mətnlər və düymələr bir-birinə qarışır.
  * Heç bir mobil menyu (hamburger drawer) və ya aşağı naviqasiya paneli mövcud deyil.

---

## 📋 Prioritetləşdirilmiş Təmir Siyahısı

| Prioritet | Sahə | Problem | Həll Təklifi |
|---|---|---|---|
| **P0 (Kritik Bloker)** | Mobil CSS | Ekran 823px kilidlənir, üfüqi sürüşmə yaranır | Viewport meta və responsive Tailwind grid (`grid-cols-1 sm:grid-cols-2 md:grid-cols-4`) təmin edilməlidir. |
| **P1 (Yüksək UX)** | Səbət Drawer | "Sifariş ver" klikləndikdə səbət drawer-i açıq qalır | Checkout-a keçid zamanı səbət drawer-i avtomatik bağlanmalıdır (`closeCart()`). |
| **P1 (Biznes Güvəni)** | Çatdırılma Məntiqi | 100 AZN-dən aşağı sifarişdə "Pulsuz" göstərilir | Mağaza çatdırılma qaydası (pulsuz limit və ya sabit rüsum) checkout-da dəqiq əks olunmalıdır. |
| **P2 (Orta Qüsur)** | PDP | İkiqat breadcrumb və `/size-guide` 404 linki | Dublikat breadcrumb silinməli, ölçü cədvəli modalı və ya səhifəsi əlavə olunmalıdır. |
| **P2 (Orta Qüsur)** | Checkout | Dil dəyişdikdə forma məlumatları sıfırlanır | Forma vəziyyəti (draft state) sessionStorage və ya URL-dən asılı olmayan şəkildə saxlanmalıdır. |
| **P3 (Vizual Cila)** | Ana Səhifə | Zəmanət kartlarındakı mətnlər nöqtələrlə kəsilir | Kartların `truncate` xüsusiyyəti aradan qaldırılmalı, mətnlər tam oxunmalıdır. |
