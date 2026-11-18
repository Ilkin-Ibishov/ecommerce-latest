# 🛒 Kassir (Cashier / POS Staff) Black-Box Brauzer Auditi Hesabatı

**Hədəf:** `http://localhost:3000/admin/counter`  
**Rol:** Tələsik Kassa Satıcısı / POS Terminal Operatoru (Retail Cashier)  
**Metod:** 100% Black-Box İnteraktiv Brauzer Testi (kod bazasına baxılmadan)  
**Tarix:** 2026-11-13  

---

## 🎯 Yekun Qərar: Kassir bu terminal ilə sürətli və təhlükəsiz işləyə bilərmi?
> **QƏRAR:** **Sadə və tək-tük satışlar üçün işləkdir, lakin gərgin pərakəndə satış növbəsində son dərəcə yavaş və yüksək risklidir.**  
> Barkod axtarışı, səbət idarəsi və satışın yekunlaşdırılması baza səviyyədə işləsə də; kassa terminalında təsdiq modalının olmaması, qalıq (change) kalkulyatorunun yoxluğu və sayın birbaşa rəqəmlə daxil edilə bilməməsi kassirin işini ciddi şəkildə ləngidir və kassada pul kəsirinə (səhvlərə) zəmin yaradır.

---

## 🔍 Ətraflı Addımbaaddım Audit Nəticələri

### 1. Terminal İnterfeysi və Məhsul Seçimi
* **İnterfeys Quruluşu:** Yuxarıda tam enli barkod/axtarış zolağı (`Barkodu oxudun və ya adı yazın`), sol/mərkəzdə səbət cədvəli, sağda isə endirim, ümumi məbləğ, ödəniş növü (`Nağd`, `Kart`, `Digər`) və `Tamamla` düyməsi yerləşir.
* **Çatışmayan Pərakəndə Elementləri:**
  - **Vizual Məhsul Düymələri Yoxdur:** Açılışda səhifə tamamilə boşdur ("Səbət boşdur"). Barkodu olmayan xırda məhsullar (paket, hədiyyə qabı, xırda aksessuarlar) üçün toxunma düymələri (touch grid) yoxdur.
  - **Axtarış Erqonomikası:** Axtarışda məhsul yazdıqda açılan siyahıdan məhsulu seçmək üçün mütləq mausu götürüb klikləmək lazımdır. Klaviatura oxları (arrow keys) ilə sürətli seçim dəstəklənmir.

---

### 2. Səbət İdarəetməsi və Hesablamalar
* **Sayın Dəyişdirilməsi Əziyyəti:**
  - Məhsulun sayını yalnız `+` və `-` düymələri ilə dəyişmək olur.
  - **Ciddi Narahatlıq:** Say üçün birbaşa rəqəm yazmaq sahəsi yoxdur. Əgər alıcı bir məhsuldan 20 və ya 50 ədəd alarsa, kassir məcburdur ki, `+` düyməsini 19-49 dəfə klikləsin!
* **Məhsulun Silinməsi:** Zibil qutusu ikonu (`Sil`) səbətdən məhsulu dərhal və problemsiz silir.
* **Vergi / ƏDV Göstəricisi:** Səbətdə heç bir ƏDV bölgüsü göstərilmir, yalnız yekun `Cəmi XX.XX AZN` əks olunur.
* **Endirim Sınağı:**
  - AZN ilə sabit endirim daxil edilə bilir.
  - Məhsulun qiymətindən böyük endirim yazıldıqda (məs: 10 AZN-lik mala 15 AZN endirim), yekun məbləğ düzgün olaraq `0.00 AZN`-ə bərabərləşdirilir (mənfiyə düşmür).
  - Mənfi endirim daxil edilməsi (`-5 AZN`) rədd edilir.
  - **Çatışmazlıq:** Faizlə endirim (məs: 10%, 20%) seçimi yoxdur və böyük endirimlər üçün menecer təsdiqi tələb olunmur.

---

### 3. Ödəniş və Kassa Əməliyyatı
* **KRİTİK RİSK — Təsdiq Modalı Yoxdur:** `Tamamla` düyməsi klikləndiyi anda heç bir xəbərdarlıq və ya təsdiq pəncərəsi açılmadan birbaşa satış tamamlanır. Tələsik növbədə təsadüfi klik dərhal satış əməliyyatına çevrilir və onu ləğv etmək olmur.
* **Ödəniş Seçimləri:** Yalnız `Nağd`, `Kart`, `Digər`.
* **CİDDİ KASSA ƏSKİKLİYİ — Verilən Pul və Qalıq (Change) Hesablayıcısı Yoxdur:**
  - `Nağd` seçildikdə alıcının nə qədər pul verdiyini yazmaq üçün **heç bir xana yoxdur** (məs: 35 AZN borca qarşı alıcı 50 AZN verəndə).
  - Ekranda **qaytarılacaq qalıq (qəpik-quruş) hesablanıb göstərilmir**. Kassir qalığı beynində və ya kənar kalkulyatorda hesablamalıdır. Bu isə axşam kassa bağlayarkən kassa kəsirlərinin yaranmasına ən böyük səbəbdir.
* **Qarışıq (Split) Ödəniş:** Ekranda hissə-hissə (məs: 20 AZN nağd + 15 AZN kart) ödəmək imkanı yoxdur.

---

### 4. Qəbz və Növbəti Müştəriyə Keçid
* **Qəbz Çıxarışı:**
  - Satış tamamlandıqda qəbz modalı avtomatik açılmır. Yalnız kiçik bir toast bildirişi çıxır (`Satış #231 tamamlandı. Qəbz`).
  - Qəbzi çap etmək üçün bu kiçik bildirişdəki linkə klikləmək lazımdır. Bu zaman sistem kassa ekranından çıxıb `/admin/counter/receipt?id=...` səhifəsinə yönlənir.
  - Bu naviqasiya kassiri terminaldan uzaqlaşdırır və gözləyən növbəti alıcı üçün yenidən "Kassaya qayıt" düyməsini basmağa məcbur edir.
* **Yenilənmə:** Kassa ekranına qayıtdıqda səbət təmizlənir, lakin axtarış inputunda bəzən əvvəlki mətn qalır.

---

## 📋 Prioritetləşdirilmiş Təmir Siyahısı (Kassa)

| Prioritet | Sahə | Problem | Həll Təklifi |
|---|---|---|---|
| **P0 (Kritik Risk)** | Ödəniş | Təsdiq pəncərəsi yoxdur, `Tamamla` tək kliklə bazaya yazır | `PaymentModal` açılmalı, yekun məbləğ və təsdiq tələb olunmalıdır. |
| **P1 (Kassa Sürəti)** | Nağd Ödəniş | Qalıq (change) hesablanmır | Müştərinin təqdim etdiyi nağd məbləğ xanası və `Qalıq: X.XX AZN` göstəricisi əlavə olunmalıdır. |
| **P1 (Kassa Sürəti)** | Səbət | Sayı birbaşa yazmaq olmur (yalnız `+`/`-`) | Səbətdə sayın üzərinə klikləyib klaviatura ilə birbaşa `50` yazmaq imkanı verilməlidir. |
| **P2 (Funksionallıq)**| Ödəniş | Qarışıq ödəniş (Nağd + Kart) UI-da yoxdur | Modal daxilində hissəli tender bölgüsü təmin edilməlidir. |
| **P2 (Erqonomika)** | Qəbz | Qəbz üçün kassa səhifəsindən kənara çıxılır | Qəbz modal şəklində açılmalı və dərhal çap düyməsi təqdim edilməlidir. |
| **P3 (Vizual Cila)** | Cədvəl | Satışlar cədvəlində başlıqlar toqquşur (`MəbləğStatus`) | Cədvəl sütunları arasına boşluq verilməlidir. |
| **P3 (Lokalizasiya)** | Menyu | Menyuda `Admin.Nav.reservations` xam açarı çıxır | Tərcümə faylında açar təyin olunmalıdır. |
