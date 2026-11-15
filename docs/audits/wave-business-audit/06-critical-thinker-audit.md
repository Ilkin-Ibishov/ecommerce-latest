# 🧠 Tənqidi Düşünən və Biznes Boşluqları (Critical Thinker) Auditi

**Hədəf:** Bütün Sistem (Baza, API, Kassa, Vitrin, Maliyyə)  
**Rol:** Yüksək İQ-lü Tənqidi Düşünən & Adversarial Biznes Auditoru  
**Metod:** Sistemik kənar hallar, eyni anda paralel əməliyyatlar (race conditions), sui-istifadə və maliyyə boşluqları  
**Tarix:** 2026-11-13  

---

## 1. Concurrency Tələsi: Onlayn və Kassa Satışının Eyni Anda Baş Verməsi

* **Ssenari:** Bir məhsulun bazada **cəmi 1 ədəd qalığı** var. Mağazadakı alıcı kassa terminalında onu alır, eyni saniyədə isə saytdakı onlayn müştəri "Sifariş ver" düyməsini klikləyir.
* **Zəiflik Analizi:**
  - Kassa satışı `/api/admin/counter/checkout`, onlayn satış isə `/api/checkout` üzərindən icra olunur.
  - Cari tətbiqdə hər iki axın stoku yoxlayarkən eyni anda `1 > 0` görür və bazada sətir səviyyəsində kilid (`SELECT ... FOR UPDATE`) və ya optimistik versiya yoxlaması aparılmırsa, **hər iki satış uğurla tamamlanır**.
* **Dağıdıcı Biznes Nəticəsi:**
  - Kassadakı alıcı malı götürüb mağazadan çıxır; onlayn alıcıdan isə pul çıxılır və ona təsdiq e-poçtu gedir. Mağaza sifarişi ləğv etməyə, müştəri ilə mübahisə etməyə və bank komissiyalarını itirməyə məcbur qalır.

---

## 2. Maliyyə və Qəpik İtkisi (Penny & Cash Leakage)

1. **Kassirin Nəzarətsiz Endirimləri:**
   - Kassa terminalında istənilən məhsula ixtiyari endirim daxil edilə bilir. Məsələn, 10 AZN-lik mala 5 AZN endirim yazdıqda qiymət heç bir menecer PIN kodu olmadan 50% azalır.
   - *Sui-istifadə Riski:* Kassir tanışlarına 90% endirimlə mal sata və ya kassadan nağd pul çəkə bilər.
2. **Kalkulyatorsuz Nağd Kassa İtkisi:**
   - Kassir hər nağd əməliyyatda qalığı (change) beynində hesablayır. Tələsik axşam saatlarında yorğunluq səbəbindən hər gün kassada kəsir yaranacaq.
3. **Ziddiyyətli Çatdırılma Qiyməti (Kuryer Mübahisəsi):**
   - Saytda 100 AZN-dən aşağı sifarişlərə çatdırılma ödənişli elan edilsə də, checkout-da 19.98 AZN-lik sifarişə "Çatdırılma: Pulsuz" yazılır.
   - *Maliyyə Zərəri:* Qapıda kuryer pul tələb etdikdə alıcı imtina edəcək və mağaza ikiqat kuryer daşıma haqqını cibindən ödəyəcək.

---

## 3. "İflic Olmuş Anbar" Domino Effekti

1. **Mal Qəbulu İşləmir:** Qəbz modalında məhsul və say sahələri olmadığı üçün yeni gələn mallar sistemə rəsmi daxil edilə bilmir.
2. **Sayım Aparmaq Olmursa (403):** Anbardar sayım apara bilmir, kor sayım sistemi bloklanıb.
3. **Faktiki Stok ilə Baza Arasında Qopma:**
   - 1 ay ərzində faktiki anbar ilə kompüterdəki rəqəmlər tamamilə fərqli olacaq.
   - Mağazada artıq satılıb bitmiş və ya xarab olmuş mallar saytda "satışda" görünəcək ("kabus ehtiyat"), yeni gələn mallar isə sistemə salınmadığı üçün vitrində gizli qalacaq.

---

## 4. Korporativ İdarəetmə və Daxili Təhdid Riskləri

1. **Tək Adminin Özünü Sistemdən Çıxarması:**
   - Mağaza sahibi öz profilində rolu `işçi` etsə, sistemdə başqa admin qalmadığı üçün panel tamamilə sahibkarsız qalır və heç kim parametrləri dəyişə bilmir.
2. **Müştəri Məlumatlarının Qorunmaması:**
   - Bütün 60+ müştəri birbaşa siyahıda göstərilir. Bütün işçilər müştərilərin telefon nömrələrini və sifariş tarixçələrini görə bilirlər (fərdi məlumatların qorunması qanunvericiliyinə ziddir).

---

## 5. Müştəri İtkisi və Satış Qıfının (Funnel) Dağılması

1. **823px Mobil Dağılması:**
   - **Təxmini Səbəti Tərk Etmə Faizi: 75% - 85%**. Azərbaycanda alıcıların 80%-i saytlara Instagram və TikTok reklamları ilə mobil telefondan daxil olur. Sayt üfüqi sürüşəndə və düymələr ekrandan kənara çıxanda ilk 5 saniyədə saytdan çıxırlar.
2. **404 Verən Ölçü Cədvəli:**
   - Geyim və ayaqqabı satışında ən böyük tərəddüd ölçüdür. Ölçü cədvəlinin xəta verməsi birbaşa sifarişdən imtina ilə nəticələnir.
3. **0.00 AZN-lik Test Məhsulu:**
   - Ana səhifədə `dsdvsdv` adlı 0 AZN-lik məhsul saytın "fırıldaq" və ya "yarımçıq" olması şübhəsini yaradır.

---

## 📊 Risk Matrisi

```
  YÜKSƏK TƏSİR, YÜKSƏK EHTİMAL
  ┌────────────────────────────────────────────────────────┐
  │ 🚨 Mobil 823px Layout Kilidi (Böyük Müştəri İtkisi)   │
  │ 🚨 Ziddiyyətli Çatdırılma Qiyməti (Kuryer Mübahisəsi)  │
  │ 🚨 İflic Anbar (Mal qəbulu və sayım işləmir)           │
  │ 🚨 Kassada Nəzarətsiz Endirim (Maliyyə Sızması)        │
  └────────────────────────────────────────────────────────┘
  YÜKSƏK TƏSİR, ORTA EHTİMAL
  ┌────────────────────────────────────────────────────────┐
  │ ⚠️ Concurrency: Eyni anda həm kassa, həm onlayn satış  │
  │ ⚠️ Tək adminin özünü demote edib sistemi bağlaması     │
  └────────────────────────────────────────────────────────┘
```
