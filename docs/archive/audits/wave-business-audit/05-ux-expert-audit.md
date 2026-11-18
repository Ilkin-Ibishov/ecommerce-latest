# 🎨 Baş UX/UI və Dizayn Sistemi (Senior UX/UI Expert) Black-Box Auditi

**Hədəf:** `http://localhost:3000` (Vitrin + Admin)  
**Rol:** Baş UX/UI və Dizayn Sistemi Memarı (Senior UX/UI & Design System Architect)  
**Metod:** 100% Black-Box İnteraktiv Brauzer Testi, DOM analizi və Hevristik Qiymətləndirmə  
**Tarix:** 2026-11-13  

---

## 1. Nielsen Norman 10 İstifadəyə Yararlılıq Evristikası üzrə Qiymətləndirmə

| Evristika | Vəziyyət | Canlı Testdə Aşkarlanan Problem və Uyğunsuzluq |
|---|---|---|
| **#1: Sistemin Vəziyyətinin Görünməsi (Visibility of Status)** | ⚠️ ZƏİF | • **Səbət Drawer-i Bağlanmır**: "Sifariş ver" klikləndikdə arxa planda `/az/checkout` açılsa da, səbət açıq qalır və istifadəçidə səhifənin dəyişib-dəyişmədiyi çaşqınlıq yaradır.<br>• **Kassada Axtarış Qeyri-müəyyənliyi**: POS terminalında axtarış yazarkən heç bir spinner/loading indikatoru çıxmır. |
| **#2: Sistem ilə Real Dünya Uyğunluğu (Match Real World)** | ❌ UĞURSUZ | • **Kassada Qalıq (Change) Yoxdur**: Real mağazada kassir müştərinin verdiyi nağd pulu (məs: 50 AZN) yazıb qalığı (15 AZN) ekranda görməlidir. Burada kassir qalığı beynində hesablamalıdır.<br>• **Xam Məlumatlar Görünür**: Stok siqnallarında insan adı əvəzinə daxili sistem timestamp-ları çıxır (`Test məhsulu 1794384736239-9c8a8g`). |
| **#3: İstifadəçi Nəzarəti və Azadlığı (User Control)** | ⚠️ NÖQSANLI | • **Dillər Arasında Məlumat İtkisi**: Checkout səhifəsində ad, nömrə və ünvanı yazdıqdan sonra dil dəyişdirildikdə bütün form sıfırlanır.<br>• **Mobildə Sticky Naviqasiya**: Yuxarı və aşağı panellər ekranı sıxışdırır və yuxarı qayıtmaq üçün "scroll-to-top" düyməsi yoxdur. |
| **#4: Ardıcıllıq və Standartlar (Consistency)** | ❌ UĞURSUZ | • **Təkrarlanan İkiqat Breadcrumb**: Məhsul səhifəsində iki eyni breadcrumb xətti üst-üstə çıxır.<br>• **Dil Hibridləşməsi**: Azərbaycan interfeysində ingiliscə (`This month`, `Add to wishlist`), türkcə (`İsteğe bağlı`) və xam açarlar (`Admin.Nav.reservations`) qarışıb.<br>• **Cədvəl Başlıqlarının Toqquşması**: Kassa satış tarixçəsində sütun başlıqları toqquşur (`MəbləğStatus`). |
| **#5: Xətaların Qarşısının Alınması (Error Prevention)** | ❌ KRİTİK | • **Kassada Nəzarətsiz Endirim**: Kassir istənilən məhsula heç bir menecer təsdiqi olmadan ixtiyari böyük endirim yaza bilər.<br>• **Admin Özünü Kilidləyə Bilər**: Tək admin özünü işçi statusuna endirib mağazanı adminsiz qoya bilər. |
| **#6: Xatırlamaq Əvəzinə Tanımaq (Recognition)** | ⚠️ ZƏİF | • Satış tamamlandıqdan sonra səbət təmizlənsə də, axtarış inputu əvvəlki mətni saxlayır və növbəti müştəri üçün əllə silinməlidir. |
| **#7: İstifadə Çevikliyi və Sürəti (Flexibility)** | ⚠️ ZƏİF | • POS terminalı sırf maus yönümlüdür. Retail kassa üçün tələb olunan `F-keys` (F2=Ödə, ESC=İmtina) və klaviatura ilə sürətli naviqasiya yoxdur. |
| **#8: Estetik və Minimalist Dizayn (Aesthetic)** | ⚠️ ORTA | • Ana səhifədə "Günün təklifi" kimi 0.00 AZN-lik `dsdvsdv` test məhsulu çıxır.<br>• Zəmanət kartlarındakı mətnlər nöqtələrlə yarımçıq kəsilir. |
| **#9: Xətaları Diaqnoz Etmək və Bərpa Olunmaq (Error Recovery)**| ❌ UĞURSUZ | • Qəbzlər və Təchizatçılar API-də problem olanda səhifə xətanı bildirmək əvəzinə səssizcə "Heç bir qəbz tapılmadı" deyir.<br>• Sifariş təklifləri səhifəsi 500 xətası verdikdə xəta mesajı əvəzinə sonsuz shimmer yüklənməsində ilişir. |
| **#10: Kömək və Sənədləşmə (Help & Documentation)** | ❌ UĞURSUZ | • "Ölçü cədvəli" (Size Guide) linki 404 səhifəsinə aparır. |

---

## 2. Dizayn Sistemi və Vizual İyerarxiya

1. **Rənglər və Tokenlər:**
   - Admin paneli sarı/kəhrəba (`#e7b008`, `rgb(245, 158, 11)`) rəngini brend kimi istifadə etsə də, mətn və çərçivələrdə Slate, Gray və Zinc rəngləri arasında nizamsız keçidlər var.
   - Deaktiv kuponlar üçün istifadə edilən neytral boz rəng status yox, sanki düymənin işləməməsi (disabled) təəssüratını yaradır.
2. **Kontrast və Oxunma (WCAG AA):**
   - Məhsul səhifəsindəki "Çatdırılma və Qaytarılma" qutusunda çox açıq mavi fonda açıq firuzəyi mətn istifadə edilib (kontrast nisbəti < 3.2:1, WCAG AA tələbini pozur).
3. **Dağıdıcı (Destructive) Əməliyyatların Fərqləndirilməsi:**
   - Kuponlar və istifadəçi siyahısında silmə (zibil qutusu) ikonu redaktə ikonları ilə eyni ölçüdə və rəngdədir. Qırmızı rəng fərqi olmadığı üçün təsadüfi silmə riski yüksəkdir.
4. **Şrift Ölçüləri:**
   - Başlıqlar `text-3xl font-bold`-dan birbaşa `text-xs uppercase`-ə tullanır. Aralıq alt başlıqlar çatışmır.

---

## 3. Mobil Responsivlik və Layout Arxitekturası

* **823px Üfüqi Kilid (Kritik Bloker):**
  - Smartfon ölçüsündə (`390x844`) səhifə konteyneri **`823px` enində kilidli qalır** və üfüqi sürüşmə yaranır.
  - Səbəb: Sticky header və bildiriş zolağında `overflow-x: hidden` və ya responsive flex konteynerin olmamasıdır.
* **Mobil Tətbiq Paneli (Bottom Bar) Örtülməsi:**
  - Aşağıdakı sabit naviqasiya paneli (`Ana səhifə`, `Kataloq`, `Səbət`, `Hesab`) checkout düymələrini və qiymət xülasələrini örtür.
* **Toxunma Hədəfləri (Touch Targets):**
  - Say dəyişmə düymələri (`+` və `-`) 28x28px ölçüsündədir (Apple və Android standartı ən azı **48x48px** tələb edir).
