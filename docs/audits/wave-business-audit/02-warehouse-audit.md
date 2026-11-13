# 📦 Anbardar (Warehouse / Inventory Staff) Black-Box Brauzer Auditi Hesabatı

**Hədəf:** `http://localhost:3000`  
**Rol:** Anbardar / Ehtiyat İdarəetmə Məsul Şəxsi (Warehouse Staff)  
**Metod:** 100% Black-Box İnteraktiv Brauzer Testi (kod bazasına baxılmadan)  
**Tarix:** 2026-11-13  

---

## 🎯 Yekun Qərar: Bu gün anbardar bu sistemlə işləyə bilərmi?
> **QƏRAR:** ⛔ **KRİTİK BLOKER — Anbar əməliyyatları faktiki olaraq tamamilə iflic vəziyyətdədir.**  
> Anbar panelinin vizual dizaynı və KPI göstəriciləri cəlbedici görünsə də, arxa plandakı icazə xətaları (403), çatışmayan SQL funksiyaları (500), yanlış ID ötürülmələri (404) və interfeysdə sətir əlavəetmə sahələrinin olmaması səbəbindən anbarın ən əsas 5 funksiyası (mal qəbulu, sayım, stok düzəlişi, siqnallar və rezervasiyalar) işləmir.

---

## 🔍 Ətraflı Addımbaaddım Audit Nəticələri

### 1. Qaimə ilə Mal Qəbulu (Supplier Receipts — `/admin/receipts`)
* **Cədvəldə Məlumat İtkisi:** `GET /api/admin/receipts` sorğusu `200 OK` ilə mövcud qəbzləri qaytarsa da, cədvəl `"Heç bir qəbz tapılmadı"` göstərir (frontend cavab formatını yanlış oxuyur).
* **Qəbzə Baxış 404 Verir:** `/admin/receipts/49761f37...` ünvanına daxil olduqda `404 Not Found` xətası çıxır.
* **Təchizatçı Siyahısı Boşdur:** "Yeni qəbz" modalında təchizatçı seçimi açılmır, yalnız `"Təchizatçı seçin"` qalır və formanı göndərdikdə HTML5 xətası verir. `/admin/suppliers` səhifəsində yeni təchizatçı yaradılsa da, modalın dropdown-ına gəlmir.
* **KRİTİK ARXİTEKTUR BOŞLUQ — Qəbz Sətirləri (Line Items) Yoxdur:** "Yeni qəbz" modalında qaimə nömrəsi, tarix, çatdırılma və gömrük xərci var, lakin **hansı məhsuldan neçə ədəd və hansı maya dəyəri ilə daxil olduğunu yazmaq üçün heç bir sətir/sahə yoxdur**! Anbardar hansı malların gəldiyini sistemə daxil edə bilmir.
* **Təchizatçılar Səhifəsi:** Sol menyuda təchizatçılar bölməsi yoxdur (yalnız URL-i əllə yazdıqda `/admin/suppliers` açılır). Orada da təchizatçılar mövcud olsa da, cədvəl boş qalır.

---

### 2. Sayım / İnventarizasiya (Stocktakes — `/admin/stocktakes`)
* **KRİTİK 403 İCAZƏ XƏTASI:**
  - `/admin/stocktakes` səhifəsinə daxil olan kimi `GET /api/admin/stocktakes` sorğusu **`HTTP 403 Forbidden`** xətası verir:  
    `{"error": "Forbidden: staff or admin required"}`  
    *(Admin kimi giriş edilməsinə baxmayaraq!)*
  - "Yeni sayım" düyməsi ilə sayım yaratmağa cəhd etdikdə də `POST /api/admin/stocktakes` eyni şəkildə **`403 Forbidden`** xətası ilə imtina edir.
* **Nəticə:** Anbardar fiziki sayım apara bilmir, kor sayım (blind count) sisteminə giriş tam bloklanıb.

---

### 3. Mal Qalığı Siqnalları və Sifariş Təklifləri
* **Yönləndirmə:** `/admin/inventory/signals` ünvanı birbaşa `/admin` panelinə yönlənir.
* **Stok Göstəriciləri (`/admin/inventory`):**
  - KPI kartları düzgün əks olunur: *Stokda yoxdur: 262*, *Az stok: 0*, *Sağlam stok: 3*.
* **Yenidən Sifariş Təklifləri (`/admin/inventory/reorder`):**
  - "Sifariş təklifləri" düyməsi basıldıqda səhifə açılır, lakin sonsuz yüklənmədə (shimmer) ilişib qalır.
  - Səbəb: `GET /api/admin/inventory/signals/low-stock` sorğusu **`HTTP 500 Internal Server Error`** xətası verir:  
    `{"error": "Database error fetching reorder suggestions", "details": "function public.get_reorder_suggestions() does not exist"}`.

---

### 4. Rezervasiyalar və Depozitlər (`/admin/reservations`)
* **Menyuda Xam Açarlar:** Sol menyuda rezervasiyalar bölməsi tərcümə olunmamış **`Admin.Nav.reservations`** xam açarı kimi çıxır.
* **403 Giriş Məhdudiyyəti:** Səhifə açılsa da, `"Loading deposits…"` vəziyyətində donur, çünki `GET /api/admin/reservations/deposits` sorğusu **`HTTP 403 Forbidden`** verir.
* **Depozit Əlavə Edilmir:** `/admin/inventory` səhifəsindəki `+ New Deposit` modalı açılsa da, variantlar siyahısı `GET /api/admin/stocktakes/variants` sorğusunun 403 verməsi səbəbindən boş qalır.

---

### 5. Maya Dəyəri Məxfiliyi və Sürətli Stok Düzəlişi
* **Məxfilik Yoxlaması:**
  - Anbar səhifəsində "Ümumi dəyər" (1349.15 AZN) və məhsul üzrə dəyərlər görünür. Lakin bu dəyərlər maya dəyəri (cost) yox, pərakəndə satış qiymətidir (`Say × Satış Qiyməti`).
  - Topdansatış alış qiymətləri və mənfəət marjaları anbar ekranında görünmür (məxfilik qorunur).
* **SÜRƏTLİ STOK DÜZƏLİŞİ (INLINE ADJUSTMENT) 404 VERİR:**
  - Anbar cədvəlində sayın üzərinə klikləyib (məs: `15`) səbəb seçərək (məs: `Stocktake Correction`) sayı dəyişdikdə `PATCH /api/admin/products/:id/stock` sorğusu göndərilir.
  - XƏTA: Sorğu **`HTTP 404 Not Found`** qaytarır:  
    `{"error": "Variant not found for identifier adcb8f82-859b-451d-a2e6-12871afc83dc"}`.  
    *Kök Səbəb:* İnterfeys variant ID-si əvəzinə **Məhsul ID-sini (Product ID)** göndərir! Bu səbəbdən anbardar heç bir mal qalığını cədvəldən əllə düzəldə bilmir.
* **CSV İxracı:** "CSV ixrac et" düyməsi dərhal və problemsiz `inventory-export-...csv` faylını yükləyir.

---

## 🚦 Prioritetləşdirilmiş Təmir Matrisi (Anbar)

| Prioritet | Sahə | Problem | Təsir |
|---|---|---|---|
| 🔴 **P0 (Kritik Bloker)** | İcazələr | `/stocktakes` və `/reservations` 403 Forbidden verir | Sayım aparmaq və depozitləri idarə etmək mümkün deyil. |
| 🔴 **P0 (Kritik Bloker)** | Mal Qəbulu | Qəbz modalında məhsul və say əlavə etmək olmur | Təchizatçıdan gələn malları qəbul etmək və stoku artırmaq olmur. |
| 🔴 **P0 (Kritik Bloker)** | Stok Siqnalları | `get_reorder_suggestions()` RPC funksiyası tapılmır (500) | Sifariş təklifləri ekranı tamamilə açılmır. |
| 🔴 **P0 (Kritik Bloker)** | Stok Düzəlişi | Cədvəldən say dəyişdikdə Variant ID əvəzinə Product ID gedir (404) | Əllə say düzəlişi və zədə/silinmə əməliyyatları işləmir. |
| 🟠 **P1 (Yüksək UX)** | Cədvəl Məlumatı | Qəbzlər və Təchizatçılar cədvəli 200 gəlsə də boş qalır | Frontend cavab obyektini yanlış xəritələndirir. |
| 🟡 **P2 (Orta Qüsur)** | Menyular | Təchizatçılar menyuda yoxdur, Rezervasiyalar xam açarla çıxır | Naviqasiya natamamdır. |
| 🟡 **P3 (Erqonomika)**| Cədvəl | Stok düzəliş düymələri ekrandan sağa çıxır | Üfüqi sürüşmə tələb edir. |
