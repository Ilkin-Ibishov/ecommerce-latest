# 🔬 Dərin Adversarial Black-Box Canlı Brauzer Auditi (Wave 3 Hesabatı)

**Audit Metodu:** Kənar hallar (edge-cases), təhlükəsizlik və icazə baryerləri, forma manipulyasiyası, ekstremal en ölçüləri, dövriyyə və maliyyə sızmaları  
**Tarix:** 2026-11-14  
**Test Mühiti:** `http://localhost:3000` (Storefront/Admin) + `http://localhost:5000` (Express 5 API)  
**Skrinşotlar:** `docs/audits/wave-business-audit/screenshots-v3/`

---

## 🚨 Yeni Aşkarlanan Defect və Bug Siyahısı (Prioritet üzrə)

### 🔴 P0 — Kritik Təhlükəsizlik və Məlumat İtkisi Qüsurları:

#### 1. `product_variant_availability` RLS Səbəbindən Anbar Qalıqlarının Sıfırlanması
* **Fayl:** `artifacts/store/src/pages/admin/InventoryPage.tsx` (sətir 135–137)
* **Aşkarlanma:** Brauzer konsolunda və şəbəkə panelində:  
  `https://...supabase.co/rest/v1/product_variant_availability?select=... HTTP 403 Forbidden`
* **Kök Səbəb:** `20261105200000_m2c_view_security.sql` miqrasiyasında təhlükəsizlik məqsədilə `product_variant_availability` görünüşündən anon və authenticated rollarının hüquqları alınıb (`REVOKE ALL`). Lakin `InventoryPage.tsx` bu cədvələ brauzerdən birbaşa sorğu atır.
* **Təsir:** Sorğu 403 ilə bloklandığı üçün anbar cədvəlində bütün məhsulların faktiki qalığı (`on_hand`), rezervasiyası (`reserved_quantity`), satışa yararlı sayı (`available_quantity`) və kəsiri (`deficit_quantity`) **`0`** olaraq göstərilir. Anbardar real qalığı görə bilmir.
* **Həll Yolu:** Mövcud API serverində `service_role` ilə təchiz olunmuş qorunan `/api/admin/inventory` endpoint-i vasitəsilə məlumat çəkilməlidir.

---

### 🟠 P1 — Yüksək UX və Performans Antipattern-ləri:

#### 2. Qiymət Filtrlərində və Axtarışda Səhifənin Tam Yenidən Yüklənməsi (`window.location.href`)
* **Fayllar:** `artifacts/store/src/pages/storefront/ProductsPage.tsx` (sətir 139, 212, 350), `HeaderSearchBar.tsx` (sətir 84)
* **Aşkarlanma:** Məhsullar kataloqunda qiymət filtrini çəkdikdə səhifə ağarır və tam brauzer reload-u baş verir.
* **Kök Səbəb:** SPA daxili naviqasiyası əvəzinə sərt `window.location.href = ...` yazılıb.
* **Təsir:** Bütün React vəziyyətləri sıfırlanır, skriptlər yenidən endirilir, mobildə ekran yanıb-sönür və batareya/trafik itkisinə səbəb olur.
* **Həll Yolu:** `wouter` kitabxanasının `setLocation` hook-undan istifadə edilməlidir.

#### 3. Dil Dəyişdirildikdə Bütün Axtarış və Filtr Parametrlərinin İtməsi
* **Fayl:** `artifacts/store/src/components/storefront/LocaleSwitcher.tsx` (sətir 11)
* **Aşkarlanma:** `/az/products?category=ayaqqabi&pmin=20&pmax=100` səhifəsində dili `RU` etdikdə `/ru/products` açılır və bütün seçilmiş kateqoriya və qiymət filtrləri itir.
* **Kök Səbəb:** `LocaleSwitcher` yalnız `pathname`-i dəyişir, `window.location.search` sorğu sətirini tamamilə nəzərdən qaçırır.
* **Təsir:** İstifadəçi xarici dildə sayta baxmaq istədikdə axtardığı bütün filtrlər sıfırlanır və alış-veriş prosesi kəsilir.
* **Həll Yolu:** `/${parts.join("/")}${window.location.search}` şəklində mövcud query parametrləri saxlanılmalıdır.

---

### 🟡 P2 — Məlumatların Korlanması və Vizual Cila:

#### 4. CSV İxracında UTF-8 BOM Çatışmazlığı (Excel-də Azərbaycan Hərflərinin Pozulması)
* **Fayl:** `artifacts/store/src/components/admin/CSVExportButton.tsx` (sətir 34)
* **Aşkarlanma:** İxrac edilmiş CSV faylının ilk baytlarında `0xFEFF` BOM işarəsi yoxdur.
* **Təsir:** Microsoft Excel proqramı faylı ANSI kimi açır və bütün Azərbaycan hərfləri (`ə, ı, ö, ü, ç, ş, ğ`) tanınmaz simvollara çevrilir (`QÉ™bz MÉ™hsulu`).
* **Həll Yolu:** `new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" })` yazılmalıdır.

#### 5. `MarginContributorsTable` Cədvəlində Unikal React Key Çatışmazlığı
* **Fayl:** `artifacts/store/src/pages/admin/MarginReportPage.tsx`
* **Aşkarlanma:** Konsolda `Each child in a list should have a unique "key" prop` xəbərdarlığı.
* **Təsir:** Cədvəl böyüdükdə və sıralandıqda Virtual DOM uyğunsuzluğu və performans ləngiməsi yaranır.
* **Həll Yolu:** Cədvəl sətirlərinə unikal `key={row.variant_id || index}` əlavə edilməlidir.
