# M4 Stock Signals: Hərtərəfli Black-Box QA Test Planı və Test Keysləri

> **Sənəd:** M4 Phase Black-Box QA Test Plan  
> **Hədəf Faza:** M4 — Stock signals: low stock, reorder, dead stock  
> **Əsas Tələb:** Kodu görməyən (Blind / True Black-Box) müstəqil QA mühəndisi tərəfindən icra olunur  
> **Tarix:** 2026-11-14  

---

## 1. Məqsəd və QA Strategiyası

Bu sənəd M4 fazasında tətbiq olunan bütün funksionallıqların, riyazi düsturların, təhlükəsizlik/RBAC qaydalarının və istifadəçi təcrübəsinin (UX) hərtərəfli və qərəzsiz yoxlanılması üçün nəzərdə tutulmuşdur.

Testlərin aparılması üçün **"Kodu Görməyən QA Sub-Agenty"** modeli tətbiq edilir:
- QA Sub-agenti mənbə kodunu (`src/`, `lib/`, `supabase/migrations/`) oxumur və analiz etmir.
- Agent yalnız bu test planında göstərilən ssenarilərə, canlı veb səhifələrə (`http://localhost:3000`), şəbəkə sorğularına (Network API), brauzer konsoluna və ekran görüntülərinə əsaslanır.
- Hər bir test keysi üçün dəqiq giriş addımları, riyazi olaraq gözlənilən nəticə və qəbul meyarları müəyyən edilmişdir.

---

## 2. Test İstifadəçiləri və Giriş Məlumatları (Personas)

Testlər zamanı üç fərqli səlahiyyət kateqoriyası yoxlanılır (bütün test nömrələri üçün bypass OTP: **`999999`**):

| Persona | Telefon Nömrəsi | Rol | Məqsəd və İcazə Həddi |
|---|---|---|---|
| **Admin (Mağaza Sahibi)** | `+994550000001` | `admin` | Tam səlahiyyət. Bütün siqnallar, təchizatçılar, maya dəyəri (cost) və dondurulmuş kapital məbləğləri tam görünməlidir. |
| **Staff (İşçi / Anbardar)** | `+994550000002` | `staff` | Əməliyyat səlahiyyəti. Az qalan və satılmayan malları görür (rəf işləri üçün), lakin **maya dəyəri, marja və ümumi maliyyə məbləğləri qətiyyən görünməməlidir** (nə UI-da, nə də API JSON-da). Reorder səhifəsinə girişi bloklanmalıdır (403). |
| **Müştəri / Anonim (Shopper)** | `+994550000003` və ya daxil olmamış | `customer` / `anon` | İctimai istifadəçi. Bütün admin və inventar siqnal səhifələri və API endpoint-ləri tam qapalı olmalıdır (401/403). |

---

## 3. Deterministik Test Datasetləri (Fixture Specification)

Mühit qurucu skript (`scripts/audit/setup-m4-test-environment.ts`) vasitəsilə təyin edilən xüsusi test məhsulları və variantları:

### Qrup A: Az Qalan və Bitmiş Ehtiyat (Low & Out of Stock)
* **`QA-M4-LOW-01` (Aktiv Az Qalan):**
  * Fiziki qalıq: 12, Aktiv rezervasiya: 5 $\rightarrow$ Mövcud (Available): **7 ədəd**.
  * Fərdi hədd (`low_stock_threshold`): **10**.
  * *Gözlənilən Siqnal:* **Low Stock (Az qalan)** ($7 \le 10$).
* **`QA-M4-OUT-02` (Bitmiş Ehtiyat):**
  * Fiziki qalıq: 4, Aktiv rezervasiya: 4 $\rightarrow$ Mövcud (Available): **0 ədəd**.
  * Fərdi hədd: **5**.
  * *Gözlənilən Siqnal:* **Out of Stock (Bitmiş)** ($0 \le 0$). Siyahıda ən başda sıralanmalıdır.
* **`QA-M4-GLOBAL-03` (Qlobal Hədd Varisliyi):**
  * Fiziki qalıq: 8, Aktiv rezervasiya: 0 $\rightarrow$ Mövcud (Available): **8 ədəd**.
  * Fərdi hədd: `NULL` (Təyin edilməyib, qlobal mağaza həddi: 10 götürülməlidir).
  * *Gözlənilən Siqnal:* **Low Stock (Az qalan)** ($8 \le 10$).
* **`QA-M4-HEALTHY-04` (Normal Ehtiyat):**
  * Fiziki qalıq: 25, Aktiv rezervasiya: 0 $\rightarrow$ Mövcud: **25 ədəd**, Hədd: **5**.
  * *Gözlənilən Siqnal:* **Normal** (Heç bir xəbərdarlıq çıxmamalıdır).

### Qrup B: Satılmayan Mallar və Dondurulmuş Pul (Dead Stock / Not Selling)
* **`QA-M4-DEAD-30`:** Qalıq: 15 ədəd. İlk mədaxil: 60 gün əvvəl. Son satış: **45 gün əvvəl**. Maya dəyəri: 20.00 AZN.
  * *Gözlənilən Siqnal:* 30 günlük filtrdə görünməlidir ($45 \ge 30$). 60 günlük filtrdə görünməməlidir.
* **`QA-M4-DEAD-90`:** Qalıq: 10 ədəd. İlk mədaxil: 120 gün əvvəl. Son satış: **105 gün əvvəl**. Maya dəyəri: **25.00 AZN**.
  * *Gözlənilən Siqnal:* 90 günlük filtrdə görünməlidir. Dondurulmuş kapital: $10 \times 25.00 = \mathbf{250.00 \text{ AZN}}$.
* **`QA-M4-DEAD-180`:** Qalıq: 40 ədəd. İlk mədaxil: 200 gün əvvəl. Heç vaxt satışı olmayıb. Maya dəyəri: **10.00 AZN**.
  * *Gözlənilən Siqnal:* 180 günlük filtrdə görünməlidir. Dondurulmuş kapital: $40 \times 10.00 = \mathbf{400.00 \text{ AZN}}$.
* **`QA-M4-ACTIVE-ITEM`:** Qalıq: 15 ədəd. Son satış: 2 gün əvvəl.
  * *Gözlənilən Siqnal:* Heç bir satılmayan filtrində çıxmamalıdır.

### Qrup C: Təkrar Sifariş Təklifləri və Sürət (Reorder & Sales Velocity)
* **`QA-M4-REORDER-FAST` (Aktiv Təklif):**
  * Qalıq: 6 ədəd, Rezerv: 0 $\rightarrow$ Mövcud: 6 ədəd.
  * Son 28 gündə satış sayı: 56 ədəd (56 ədəd / 28 gün $\rightarrow$ **Sürət: 2.0 ədəd/gün**).
  * Satış əməliyyatı sayı: 8 fərqli qəbz/sifariş ($> 3$ satış həddi $\rightarrow$ `has_enough_data = true`).
  * Təminat müddəti: $6 / 2.0 = \mathbf{3 \text{ gün}}$.
  * Hədəf təminat: 60 gün. Təklif olunan sifariş: $\lceil 60 \times 2.0 - 6 \rceil = \mathbf{114 \text{ ədəd}}$.
  * Təchizatçı: `"Baku Electronics MMC"` (Əlaqə: `+994124000000`).
* **`QA-M4-REORDER-INSUFFICIENT` (Məlumat Yetərsizliyi):**
  * Qalıq: 5 ədəd. Son 28 gündə cəmi 1 satış ($< 3$ satış həddi).
  * *Gözlənilən Siqnal:* Sistem sifariş miqdarı uydurmamalı, aydın şəkildə **"Məlumat yetərsizdir"** nişanı göstərməlidir.
* **`QA-M4-REORDER-ZERO`:** Qalıq: 8 ədəd. Son 28 gündə 0 satış.
  * *Gözlənilən Siqnal:* Reorder siyahısında görünməməlidir (çünki sürət sıfırdır).

### Qrup D: `track_stock = false` və Hibrid Dəstlər (Bundles)
* **`QA-M4-SERVICE-NOTRACK`:** Fiziki olmayan xidmət (`track_stock = false`).
  * *Gözlənilən Davranış:* Qalıq hesabatında "Limitsiz" olmalıdır. Kassada satıldıqda qəbz çıxır, lakin ledger-ə heç bir çıxış hərəkəti yazılmır. Sayım (stocktake) cədvəlinə düşmür.
* **`QA-M4-BUNDLE-HYBRID`:** Dəst — tərkibi: 1 ədəd `QA-M4-LOW-01` (fiziki mövcud: 7) və 1 ədəd `QA-M4-SERVICE-NOTRACK`.
  * *Gözlənilən Davranış:* Dəstin ictimai və daxili mövcudluq sayı dəqiq **7 ədəd** olmalıdır.

---

## 4. Test Keysləri Matrisi (Test Cases Matrix)

| Test ID | Modul / Kateqoriya | Prioritet | Testin Adı və Məqsədi | Əsas Giriş Addımları | Gözlənilən Nəticə |
|---|---|---|---|---|---|
| **TC-M4-001** | Low Stock | P0 | Aktiv az qalan malın tanınması | Admin ilə daxil ol $\rightarrow$ `/admin/inventory` $\rightarrow$ "Az qalan" filtrini seç | `QA-M4-LOW-01` siyahıda çıxır: On-hand: 12, Reserved: 5, Available: 7, Threshold: 10, Status: "Az qalan" |
| **TC-M4-002** | Out of Stock | P0 | Bitmiş malın aşkar olunması və sıralaması | Admin ilə `/admin/inventory` $\rightarrow$ "Az qalan" filtri | `QA-M4-OUT-02` siyahının **ən başında** çıxır (Out of stock birinci gəlməlidir): Available: 0, Status: "Bitmiş" |
| **TC-M4-003** | Low Stock | P1 | Qlobal həddin tətbiq olunması (Variant həddi NULL olduqda) | Admin ilə `/admin/inventory` $\rightarrow$ "Az qalan" filtri | `QA-M4-GLOBAL-03` siyahıda görünür (Qlobal hədd 10 əsasında, Available: 8 <= 10) |
| **TC-M4-004** | Low Stock | P1 | Normal malın xəbərdarlıq almaması | Admin ilə `/admin/inventory` $\rightarrow$ "Az qalan" filtri | `QA-M4-HEALTHY-04` az qalan siyahısında **qətiyyən görünmür** |
| **TC-M4-005** | Dashboard | P1 | Dashboard siqnal kartları və sayğaclar | Admin ilə `/admin` ana səhifəsinə daxil ol | Dashboard-da "Az qalan", "Bitmiş", "Satılmayan" sayları doğru əks olunur və kartlara kliklədikdə müvafiq filtrli səhifə açılır |
| **TC-M4-006** | Dead Stock | P0 | 30 günlük satılmayan mal filtri | `/admin/inventory` $\rightarrow$ "Satılmayan" filtri $\rightarrow$ 30 gün seç | `QA-M4-DEAD-30` siyahıda çıxır (son satış 45 gün əvvəl) |
| **TC-M4-007** | Dead Stock | P1 | 60 günlük filtrdə 30 günlük malın çıxmaması | `/admin/inventory` $\rightarrow$ "Satılmayan" filtri $\rightarrow$ 60 gün seç | `QA-M4-DEAD-30` siyahıdan itir (çünki 45 < 60) |
| **TC-M4-008** | Dead Stock | P0 | 90 günlük satılmayan və dondurulmuş kapital | Admin ilə `/admin/inventory` $\rightarrow$ "Satılmayan" filtri $\rightarrow$ 90 gün | `QA-M4-DEAD-90` çıxır: Qalıq 10, Maya dəyəri 25.00 AZN, Dondurulmuş məbləğ: **250.00 AZN** |
| **TC-M4-009** | Dead Stock | P0 | 180 günlük heç vaxt satılmamış mal və ümumi cəm | Admin ilə `/admin/inventory` $\rightarrow$ "Satılmayan" filtri $\rightarrow$ 180 gün | `QA-M4-DEAD-180` çıxır (400.00 AZN). Səhifənin yuxarısında ümumi dondurulmuş kapital cəmi düzgün toplanır |
| **TC-M4-010** | Dead Stock | P1 | Aktiv satılan malın satılmayan siyahısına düşməməsi | `/admin/inventory` $\rightarrow$ "Satılmayan" bütün filtrlər (30/60/90/180) | `QA-M4-ACTIVE-ITEM` heç bir satılmayan siyahısında görünmür |
| **TC-M4-011** | Reorder | P0 | Aktiv sifariş təklifi və təminat günləri | Admin ilə `/admin/inventory/reorder` səhifəsinə daxil ol | `QA-M4-REORDER-FAST` təkliflərdə çıxır: Mövcud: 6, Satış: 56, Sürət: 2.0/gün, Təminat: 3 gün, Təklif olunan sifariş: **114 ədəd** |
| **TC-M4-012** | Reorder | P1 | Təchizatçıya görə qruplaşdırma və əlaqə | `/admin/inventory/reorder` | `QA-M4-REORDER-FAST` "Baku Electronics MMC" təchizatçı başlığı altında çıxır və təchizatçının əlaqə nömrəsi görünür |
| **TC-M4-013** | Reorder | P0 | Dürüstlük: Yetərsiz data olduqda yalançı proqnoz verilməməsi | `/admin/inventory/reorder` | `QA-M4-REORDER-INSUFFICIENT` üçün sifariş rəqəmi çıxmır, "Məlumat yetərsizdir" status nişanı göstərilir |
| **TC-M4-014** | Reorder | P1 | Sıfır satışlı malın reorder siyahısına düşməməsi | `/admin/inventory/reorder` | `QA-M4-REORDER-ZERO` reorder siyahısında çıxmır (o yalnız Dead Stock-a aiddir) |
| **TC-M4-015** | Reorder | P1 | Parametrlərin dəyişdirilməsi (Pəncərə və Hədəf günlər) | `/admin/inventory/reorder` $\rightarrow$ Hədəf günləri dəyişdir | Sifariş rəqəmləri yeni parametrlərə uyğun reaktiv yenilənir |
| **TC-M4-016** | Track Stock | P0 | `track_stock=false` olan xidmətin kassa satışı | Kassa POS `/admin/counter` $\rightarrow$ `QA-M4-SERVICE-NOTRACK` əlavə et və satışı tamamla | Satış uğurla keçir, qəbz çıxır, lakin `stock_movements` cədvəlinə hərəkət yazılmır |
| **TC-M4-017** | Track Stock | P0 | `track_stock=false` olan xidmətin mövcudluq hesabatı | `/admin/inventory` $\rightarrow$ `QA-M4-SERVICE-NOTRACK` axtar | Mövcudluq 0 deyil, "Limitsiz" / "-" göstərilir, az qalan siqnalı vermir |
| **TC-M4-018** | Bundles | P1 | Hibrid dəstin mövcudluq sayı | `/az/products` və ya admin cədvəlində `QA-M4-BUNDLE-HYBRID` yoxla | Dəstin mövcudluğu fiziki komponentin sayına (7 ədəd) bərabərdir |
| **TC-M4-019** | RBAC / Security | P0 | **Staff rolu üçün maliyyə və maya dəyərinin gizlədilməsi (UI & Network)** | Staff (`550000002`) ilə daxil ol $\rightarrow$ `/admin/inventory` $\rightarrow$ "Satılmayan" seç. Network panelini yoxla | UI-da Maya Dəyəri və Dondurulmuş Məbləğ sütunları **yoxdur**. Network panelində `/api/admin/inventory/signals/dead-stock` cavabında `unit_cost` və `capital_tied_up` sahələri **tam silinib (redaktə olunub)** |
| **TC-M4-020** | RBAC / Security | P0 | **Staff rolu üçün Reorder səhifəsinin bloklanması** | Staff (`550000002`) ilə `/admin/inventory/reorder` səhifəsinə daxil olmağa cəhd et | Giriş qadağan edilir (403 Forbidden və ya xəbərdarlıq ekranı) |
| **TC-M4-021** | RBAC / Security | P0 | **Anonim/Müştəri üçün siqnal endpoint-lərinin bloklanması** | Çıxış et (Anonim) $\rightarrow$ Brauzerdən `/api/admin/inventory/signals/summary` çağır | Sorğu 401 Unauthorized qaytarır |
| **TC-M4-022** | UX / i18n | P1 | Azərbaycan dilində terminologiya uyğunluğu | `/az/admin/inventory` və `/az/admin/inventory/reorder` | "Az qalan", "Bitmiş", "Satılmayan", "Təchizatçı", "Təminat günləri". UI-da "Dead stock" arqo sözü getmir |
| **TC-M4-023** | UX / i18n | P1 | İngilis və Rus dillərinə keçid | Dili dəyiş (`en`, `ru`) | Bütün cədvəl başlıqları, statuslar və xəta mesajları tərcümə olunub, `i18n` açar adı görünmür |
| **TC-M4-024** | Chaos / Edge | P1 | Kassa satışının ləğvi (Void Sale) zamanı sürətin bərpası | Kassada 5 ədəd `QA-M4-REORDER-FAST` sat, sonra dərhal həmin satışı ləğv (void) et | Reorder səhifəsində satış sürəti və təklif sayı düzgün qalır (ləğv edilmiş satış sürətə qatılmır) |
| **TC-M4-025** | Chaos / Edge | P1 | Sıfıra bölünmə mühafizəsi | Satışı olmayan variant üçün təminat günü hesablaması | Sistemdə `Infinity` və ya `NaN` xətası çıxmır, qəza baş vermir |

---

## 5. Blind QA Sub-Agenti üçün İcra və Hesabat Təlimatı

QA Sub-agenti icra zamanı aşağıdakı qaydalara əməl etməlidir:
1. **Mənbə kodunu oxumaq qadağandır.** Kod bazasına (`.ts`, `.sql`, `.tsx` fayllarına) `read_file` ilə baxılmamalıdır.
2. Bütün sınaqlar canlı Playwright/Brauzer və HTTP sorğuları vasitəsilə aparılmalıdır.
3. Hər bir test keysi üçün `docs/audits/m4-qa-blackbox-results.md` hesabat faylında qeydiyyat aparılmalıdır:
   * **Status:** PASS / FAIL / BLOCKED
   * **Faktiki Nəticə və Sübut:** Ekran görüntüsü linki (`file://...`), şəbəkə cavabları (Network JSON), konsol xətaları.
   * **Defekt təsviri:** Əgər FAIL olarsa, dəqiq reproduksiya addımları və xətanın mahiyyəti.
