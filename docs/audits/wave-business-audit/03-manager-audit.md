# 👔 Mağaza Sahibi / Menecer (Store Owner / General Manager) Black-Box Brauzer Auditi Hesabatı

**Hədəf:** `http://localhost:3000/admin`  
**Rol:** Mağaza Sahibi / Baş Menecer (Store Owner / General Manager)  
**Metod:** 100% Black-Box İnteraktiv Brauzer Testi (kod bazasına baxılmadan)  
**Tarix:** 2026-11-13  

---

## 🎯 Yekun Qərar: Sahibkar bu gün bu sistemlə biznesini idarə edə və rəqəmlərə güvənə bilərmi?
> **QƏRAR:** ⚠️ **YÜKSƏK RİSK — İdarəetmə kor nöqtələri və maliyyə nəzarətinin olmaması.**  
> Mağaza brendinq rəngləri, çoxdilli mətnlər, şriftlər, kupon və banner idarəetməsi olduqca rahat və çevik işləsə də, **sahibkar üçün ən vacib olan maliyyə şəffaflığı və korporativ təhlükəsizlik sahəsində kritik boşluqlar var**:
> 1. **Maliyyə Rəqəmlərinə Güvənmək Olmur:** Kassada nağd və kartla aparılan satışlar əsas İdarəetmə Panelinin (Dashboard) gəlir göstəricilərinə daxil edilmir (kassada satış olsa da gəlir `0.00 AZN` qalır).
> 2. **Mənfəət və Maya Dəyəri Hesabatları Yoxdur:** `/admin/reports/margins` səhifəsi `/admin`-ə yönlənir; interfeysdə maya dəyəri (COGS), xalis mənfəət və marja analizləri üçün heç bir ekran yoxdur.
> 3. **Təhlükəsizlik Boşluğu:** Tək admin öz rolunu sadə bir təsdiq pəncərəsi ilə `işçi` edə bilər və bununla da mağaza tamamilə adminsiz və kilidli qala bilər.

---

## 🔍 Ətraflı Addımbaaddım Audit Nəticələri

### 1. İdarəetmə Paneli (Dashboard — `/admin`)
* **KPI Göstəriciləri və Satışların İtməsi:**
  - Panel 8 kart göstərir: *Gəlir (0.00 AZN)*, *Sifarişlər (0)*, *Orta sifariş dəyəri (0.00 AZN)*, *Gözləyən sifarişlər (0)*, *Yeni müştərilər (1)*, *Ləğvetmə faizi (0.0%)*, *Kuponlar (0)*.
  - **Kritik Qüsur:** Kassada nağd və ya kartla tamamlanan satışlar dashboard-da əks olunmur! Sahibkar gün ərzində kassada minlərlə manat satış olsa belə, gəliri `0.00 AZN` görür.
* **Backend Xətaları:** Dashboard açılarkən `GET /api/admin/inventory/signals/summary` 500 xətası, `coupon_usages` isə 400 xətası verir.
* **Dizayn və Lokalizasiya:** Tarix filtrləri Azərbaycanca (`7G`, `30G`, `Bu ay`, `90G`), lakin aktiv filtr etiketi ingiliscə çıxır (`This month`). "BİTİB" statuslu məhsulların adlarında daxili timestamp-lar görünür (`Test məhsulu 1794384736239-9c8a8g`).

---

### 2. İşçi Heyəti və Rollar (Staff Management — `/admin/users`)
* **Filtrasiya Çatışmazlığı:** Bütün 60+ müştəri və işçi eyni cədvəldədir. Sahibkar üçün işçiləri müştərilərdən ayırmaq üçün heç bir filtr və ya tab ("Hamısı", "Yalnız İşçilər", "Müştərilər") yoxdur.
* **İşçi Əlavə Edilməsi:** "İşçi əlavə et" modalı, forma validasiyası və dərhal cədvələ düşməsi problemsiz işləyir.
* **Özünü Demote Etmə Qorunması Təhlükəsi:** Admin öz sətirində rolu `işçi` etdikdə dialoq çıxır, lakin sistemdə başqa admin olub-olmaması yoxlanılmır. Tək admin özünü işçi etsə, sistemdə heç bir idarəedici qalmır.

---

### 3. Mənfəət və Marja Hesabatları (`/admin/reports/margins`)
* **Səhifə Mövcud Deyil:** `/admin/reports/margins` və ya `/admin/reports` yazdıqda brauzer dərhal `/admin` ünvanına yönlənir. Sol menyuda heç bir "Hesabatlar" linki yoxdur.
* **Biznes Təsiri:** Sahibkar məhsulların maya dəyərini, xalis mənfəəti, ən gəlirli və ya ən zərərli məhsulları vizual olaraq görə bilmir.

---

### 4. Mağaza Tənzimləmələri (Store Settings — `/admin/settings`)
* **İşlək Hissələr:** Brend rənglərinin seçimi (6 HEX rəng), mağaza adı, əlaqə nömrələri, sosial media linkləri, iş saatları, 20 Google Fonts şrift seçimi və yadda saxlama dərhal və uğurla işləyir.
* **Çatışmayan İdarəetmə Parametrləri:**
  - Ehtiyatların mənfiyə düşməsinə icazə/qadağa tənzimləməsi yoxdur.
  - Bildiriş xülasələri (günlük e-poçt/WhatsApp hesabatları) menyusu yoxdur.
  - Qaytarma, çatdırılma və məxfilik siyasəti üçün tənzimləmələr yoxdur.

---

### 5. Marketinq və Kuponlar (`/admin/coupons`, `/admin/banners`)
* **Kupon İdarəsi:** Statusun bir kliklə aktiv/deaktiv edilməsi, yeni kupon yaradılması (`VIP15`, 15%) çox rahat və operativdir.
* **Banner İdarəsi:** Şəkil URL-i, başlıq və keçid linki ilə yeni banner əlavə etmək işləyir.
* **Lokalizasiya Xətaları:** Kupon və banner modallarında bəzi yerlərdə Azərbaycan dili əvəzinə Türkcə placeholder çıxır (*"İsteğe bağlı"*).

---

## 🚦 Prioritetləşdirilmiş Təmir Siyahısı (Menecer)

| Prioritet | Sahə | Problem | Həll Təklifi |
|---|---|---|---|
| **P0 (Kritik Maliyyə)** | Dashboard | Kassa satışları gəlir kartlarına (Revenue) daxil edilmir (`0.00 AZN`) | Dashboard analitika sorğusuna həm onlayn, həm kassa satışları əlavə edilməlidir. |
| **P0 (Kritik İdarəetmə)** | Hesabatlar | `/admin/reports/margins` açılmır, heç bir marja və COGS hesabatı yoxdur | Mənfəət, maya dəyəri və dövriyyə hesabatları səhifəsi qurulmalıdır. |
| **P1 (Təhlükəsizlik)** | İcazələr | Son admin özünü demote edib sistemi kilidləyə bilər | Ən azı bir aktiv admin qalması server tərəfdən tələb olunmalıdır. |
| **P2 (UX)** | İşçi Heyəti | `/admin/users` səhifəsində işçiləri ayırmaq üçün filtr yoxdur | "Yalnız İşçilər" və "Müştərilər" tabları əlavə edilməlidir. |
| **P2 (Tənzimləmə)** | Parametrlər | Stok qaydaları və bildiriş tənzimləmələri çatışmır | Settings bölməsinə "Biznes Siyasəti və Siqnallar" sekməsi əlavə olunmalıdır. |
| **P3 (Lokalizasiya)** | Kupon/Banner | Türkcə "İsteğe bağlı" sözü çıxır | "İstəyə bağlı" olaraq dəyişdirilməlidir. |
