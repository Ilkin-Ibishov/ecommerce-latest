import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CAT_TRANSLATIONS = {
  smartfonlar: { az: "Smartfonlar", ru: "Смартфоны", en: "Smartphones" },
  noutbuklar: { az: "Noutbuklar", ru: "Ноутбуки", en: "Laptops" },
  televizorlar: { az: "Televizorlar", ru: "Телевизоры", en: "TVs" },
  plansetler: { az: "Planşetlər", ru: "Планшеты", en: "Tablets" },
  "agilli-saatlar": { az: "Ağıllı saatlar", ru: "Умные часы", en: "Smartwatches" },
  audio: { az: "Audio texnikası", ru: "Аудиотехника", en: "Audio" },
  "foto-kamera": { az: "Foto/Kamera", ru: "Фото/Камера", en: "Photo & Camera" },
  "oyun-avadanligi": { az: "Oyun avadanlığı", ru: "Игровое оборудование", en: "Gaming" },
  "ev-texnikasi": { az: "Ev texnikası", ru: "Бытовая техника", en: "Home Appliances" },
  aksesuarlar: { az: "Aksesuarlar", ru: "Аксессуары", en: "Accessories" },
};

const PROD_TRANSLATIONS = {
  "apple-iphone-15-pro-max-256gb": { az: "Apple iPhone 15 Pro Max 256GB", ru: "Apple iPhone 15 Pro Max 256GB", az_d: "A17 Pro çip, titan çərçivə, 48MP kamera sistemi, USB-C bağlantısı", ru_d: "Чип A17 Pro, титановый корпус, камера 48 МП, разъём USB-C" },
  "apple-iphone-15-128gb": { az: "Apple iPhone 15 128GB", ru: "Apple iPhone 15 128GB", az_d: "A16 Bionic çip, Dynamic Island, 48MP kamera, USB-C", ru_d: "Чип A16 Bionic, Dynamic Island, камера 48 МП, USB-C" },
  "samsung-galaxy-s24-ultra-256gb": { az: "Samsung Galaxy S24 Ultra 256GB", ru: "Samsung Galaxy S24 Ultra 256GB", az_d: "Snapdragon 8 Gen 3, 200MP kamera, S Pen, 6.8\" QHD+ ekran", ru_d: "Snapdragon 8 Gen 3, камера 200 МП, S Pen, экран 6.8\" QHD+" },
  "samsung-galaxy-s24-128gb": { az: "Samsung Galaxy S24 128GB", ru: "Samsung Galaxy S24 128GB", az_d: "Exynos 2400, 50MP üçlü kamera, 6.2\" FHD+ ekran, 4000 mAh", ru_d: "Exynos 2400, тройная камера 50 МП, экран 6.2\" FHD+, 4000 мАч" },
  "samsung-galaxy-a55-256gb": { az: "Samsung Galaxy A55 5G 256GB", ru: "Samsung Galaxy A55 5G 256GB", az_d: "Exynos 1480, 50MP OIS kamera, 120Hz Super AMOLED, IP67", ru_d: "Exynos 1480, камера 50 МП OIS, 120 Гц Super AMOLED, IP67" },
  "xiaomi-14-pro-512gb": { az: "Xiaomi 14 Pro 512GB", ru: "Xiaomi 14 Pro 512GB", az_d: "Snapdragon 8 Gen 3, Leica 50MP kamera, 6.73\" LTPO AMOLED, 120W şarj", ru_d: "Snapdragon 8 Gen 3, камера Leica 50 МП, 6.73\" LTPO AMOLED, зарядка 120 Вт" },
  "xiaomi-redmi-note-13-pro-128gb": { az: "Xiaomi Redmi Note 13 Pro 128GB", ru: "Xiaomi Redmi Note 13 Pro 128GB", az_d: "Dimensity 7200 Ultra, 200MP kamera, 6.67\" AMOLED, 67W şarj", ru_d: "Dimensity 7200 Ultra, камера 200 МП, 6.67\" AMOLED, зарядка 67 Вт" },
  "xiaomi-13t-pro-256gb": { az: "Xiaomi 13T Pro 256GB", ru: "Xiaomi 13T Pro 256GB", az_d: "Dimensity 9200+, Leica 50MP, 6.67\" AMOLED, 144Hz, 144W şarj", ru_d: "Dimensity 9200+, Leica 50 МП, 6.67\" AMOLED, 144 Гц, зарядка 144 Вт" },
  "huawei-p60-pro-256gb": { az: "Huawei P60 Pro 256GB", ru: "Huawei P60 Pro 256GB", az_d: "Kirin 9000S, 48MP Leica kamera, 6.67\" OLED, 88W şarj", ru_d: "Kirin 9000S, камера Leica 48 МП, 6.67\" OLED, зарядка 88 Вт" },
  "oppo-reno12-pro-256gb": { az: "OPPO Reno12 Pro 256GB", ru: "OPPO Reno12 Pro 256GB", az_d: "Dimensity 9200+, 50MP AI kamera, 6.7\" AMOLED, 80W şarj", ru_d: "Dimensity 9200+, AI камера 50 МП, 6.7\" AMOLED, зарядка 80 Вт" },
  "samsung-galaxy-a35-128gb": { az: "Samsung Galaxy A35 5G 128GB", ru: "Samsung Galaxy A35 5G 128GB", az_d: "Exynos 1380, 50MP OIS, Super AMOLED 120Hz, IP67, 5000 mAh", ru_d: "Exynos 1380, 50 МП OIS, Super AMOLED 120 Гц, IP67, 5000 мАч" },
  "xiaomi-redmi-13c-256gb": { az: "Xiaomi Redmi 13C 256GB", ru: "Xiaomi Redmi 13C 256GB", az_d: "Helio G85, 50MP kamera, 6.74\" HD+, 5000 mAh, büdcə seçimi", ru_d: "Helio G85, камера 50 МП, 6.74\" HD+, 5000 мАч, бюджетный выбор" },
  "samsung-galaxy-z-fold5-256gb": { az: "Samsung Galaxy Z Fold5 256GB", ru: "Samsung Galaxy Z Fold5 256GB", az_d: "Katlanabilir 7.6\" AMOLED, Snapdragon 8 Gen 2, S Pen uyğunluğu", ru_d: "Складной 7.6\" AMOLED, Snapdragon 8 Gen 2, поддержка S Pen" },
  "vivo-v30-pro-256gb": { az: "vivo V30 Pro 256GB", ru: "vivo V30 Pro 256GB", az_d: "Snapdragon 7 Gen 3, ZEISS 50MP, 6.78\" AMOLED, 80W şarj", ru_d: "Snapdragon 7 Gen 3, ZEISS 50 МП, 6.78\" AMOLED, зарядка 80 Вт" },
  "realme-gt6-256gb": { az: "realme GT 6 256GB", ru: "realme GT 6 256GB", az_d: "Snapdragon 8s Gen 3, 50MP Sony kamera, 6.78\" AMOLED, 120W şarj", ru_d: "Snapdragon 8s Gen 3, камера Sony 50 МП, 6.78\" AMOLED, зарядка 120 Вт" },
  "apple-macbook-air-m2-256gb": { az: "Apple MacBook Air M2 256GB", ru: "Apple MacBook Air M2 256GB", az_d: "Apple M2 çip, 8GB RAM, 13.6\" Liquid Retina, fanless dizayn, 18 saat batareya", ru_d: "Чип Apple M2, 8 ГБ RAM, 13.6\" Liquid Retina, без вентилятора, 18 часов работы" },
  "apple-macbook-pro-14-m3-512gb": { az: "Apple MacBook Pro 14\" M3 512GB", ru: "Apple MacBook Pro 14\" M3 512GB", az_d: "M3 Pro çip, 18GB RAM, 14.2\" Liquid Retina XDR, ProMotion 120Hz", ru_d: "Чип M3 Pro, 18 ГБ RAM, 14.2\" Liquid Retina XDR, ProMotion 120 Гц" },
  "lenovo-thinkpad-x1-carbon-gen12": { az: "Lenovo ThinkPad X1 Carbon Gen 12", ru: "Lenovo ThinkPad X1 Carbon Gen 12", az_d: "Intel Core Ultra 7, 32GB RAM, 1TB SSD, 14\" IPS, ultralight 1.12 kg", ru_d: "Intel Core Ultra 7, 32 ГБ RAM, 1 ТБ SSD, 14\" IPS, ультралёгкий 1.12 кг" },
  "dell-xps-15-9530-512gb": { az: "Dell XPS 15 9530 512GB", ru: "Dell XPS 15 9530 512GB", az_d: "Intel i7-13700H, 32GB DDR5, RTX 4060, 15.6\" OLED 3.5K", ru_d: "Intel i7-13700H, 32 ГБ DDR5, RTX 4060, 15.6\" OLED 3.5K" },
  "hp-pavilion-15-ew2": { az: "HP Pavilion 15 Intel i5 256GB", ru: "HP Pavilion 15 Intel i5 256GB", az_d: "Intel Core i5-1335U, 8GB RAM, 15.6\" FHD IPS, MicroEdge ekran", ru_d: "Intel Core i5-1335U, 8 ГБ RAM, 15.6\" FHD IPS, дисплей MicroEdge" },
  "asus-vivobook-15-oled-2024": { az: "ASUS VivoBook 15 OLED 512GB", ru: "ASUS VivoBook 15 OLED 512GB", az_d: "AMD Ryzen 7 7730U, 16GB RAM, 512GB SSD, 15.6\" 2.8K OLED 120Hz", ru_d: "AMD Ryzen 7 7730U, 16 ГБ RAM, 512 ГБ SSD, 15.6\" 2.8K OLED 120 Гц" },
  "acer-aspire-5-a515-2024": { az: "Acer Aspire 5 i5 256GB 2024", ru: "Acer Aspire 5 i5 256GB 2024", az_d: "Intel Core i5-1335U, 16GB RAM, 15.6\" FHD IPS, WiFi 6", ru_d: "Intel Core i5-1335U, 16 ГБ RAM, 15.6\" FHD IPS, WiFi 6" },
  "lenovo-legion-5-rtx4060-2024": { az: "Lenovo Legion 5 RTX 4060 512GB", ru: "Lenovo Legion 5 RTX 4060 512GB", az_d: "AMD Ryzen 7 7745HX, 16GB DDR5, RTX 4060, 15.6\" 165Hz oyun noutbuku", ru_d: "AMD Ryzen 7 7745HX, 16 ГБ DDR5, RTX 4060, 15.6\" 165 Гц игровой ноутбук" },
  "msi-katana-gf66-rtx4060": { az: "MSI Katana 15 RTX 4060 512GB", ru: "MSI Katana 15 RTX 4060 512GB", az_d: "Intel i7-13620H, 16GB DDR5, RTX 4060, 15.6\" FHD 144Hz", ru_d: "Intel i7-13620H, 16 ГБ DDR5, RTX 4060, 15.6\" FHD 144 Гц" },
  "hp-victus-16-rtx3050-512gb": { az: "HP Victus 16 RTX 3050 512GB", ru: "HP Victus 16 RTX 3050 512GB", az_d: "AMD Ryzen 5 7535HS, 8GB DDR5, RTX 3050, 16.1\" FHD 144Hz", ru_d: "AMD Ryzen 5 7535HS, 8 ГБ DDR5, RTX 3050, 16.1\" FHD 144 Гц" },
  "asus-zenbook-14-oled-2024": { az: "ASUS ZenBook 14 OLED 2024", ru: "ASUS ZenBook 14 OLED 2024", az_d: "Intel Core Ultra 7, 16GB LPDDR5, 512GB SSD, 14\" 2.8K OLED 120Hz", ru_d: "Intel Core Ultra 7, 16 ГБ LPDDR5, 512 ГБ SSD, 14\" 2.8K OLED 120 Гц" },
  "samsung-galaxy-book3-ultra-512gb": { az: "Samsung Galaxy Book3 Ultra 512GB", ru: "Samsung Galaxy Book3 Ultra 512GB", az_d: "Intel Core i7-13700H, 16GB RAM, RTX 4050, 16\" AMOLED 120Hz", ru_d: "Intel Core i7-13700H, 16 ГБ RAM, RTX 4050, 16\" AMOLED 120 Гц" },
  "microsoft-surface-pro-9-i5-256gb": { az: "Microsoft Surface Pro 9 i5 256GB", ru: "Microsoft Surface Pro 9 i5 256GB", az_d: "Intel Core i5-1235U, 8GB RAM, 13\" PixelSense 120Hz, çıxarıla bilən klaviatura", ru_d: "Intel Core i5-1235U, 8 ГБ RAM, 13\" PixelSense 120 Гц, съёмная клавиатура" },
  "dell-inspiron-15-i7-512gb": { az: "Dell Inspiron 15 i7 512GB", ru: "Dell Inspiron 15 i7 512GB", az_d: "Intel Core i7-1355U, 16GB RAM, 512GB SSD, 15.6\" FHD IPS", ru_d: "Intel Core i7-1355U, 16 ГБ RAM, 512 ГБ SSD, 15.6\" FHD IPS" },
  "lenovo-ideapad-gaming-3-rtx3050": { az: "Lenovo IdeaPad Gaming 3 RTX 3050", ru: "Lenovo IdeaPad Gaming 3 RTX 3050", az_d: "Ryzen 5 7535HS, 16GB DDR5, RTX 3050, 15.6\" FHD 120Hz oyun noutbuku", ru_d: "Ryzen 5 7535HS, 16 ГБ DDR5, RTX 3050, 15.6\" FHD 120 Гц игровой ноутбук" },
  "lg-c3-oled-55-2023": { az: "LG C3 55\" 4K OLED evo Smart TV", ru: "LG C3 55\" 4K OLED evo Smart TV", az_d: "α9 AI Processor Gen6, Dolby Vision IQ, webOS 23, HDMI 2.1, G-Sync", ru_d: "α9 AI Processor Gen6, Dolby Vision IQ, webOS 23, HDMI 2.1, G-Sync" },
  "samsung-qn90d-neo-qled-55": { az: "Samsung QN90D 55\" Neo QLED 4K", ru: "Samsung QN90D 55\" Neo QLED 4K", az_d: "Neo Quantum Processor 4K, Mini LED, Quantum HDR 2000, Tizen OS", ru_d: "Neo Quantum Processor 4K, Mini LED, Quantum HDR 2000, Tizen OS" },
  "sony-a95l-65-qd-oled-4k": { az: "Sony A95L 65\" QD-OLED 4K Bravia XR", ru: "Sony A95L 65\" QD-OLED 4K Bravia XR", az_d: "XR OLED Contrast Pro, Cognitive Processor XR, Google TV, Acoustic Surface", ru_d: "XR OLED Contrast Pro, Cognitive Processor XR, Google TV, Acoustic Surface" },
  "lg-b3-oled-65-4k": { az: "LG B3 65\" 4K OLED Smart TV", ru: "LG B3 65\" 4K OLED Smart TV", az_d: "α7 AI Processor Gen6, webOS 23, Dolby Vision, 120Hz, HDMI 2.1", ru_d: "α7 AI Processor Gen6, webOS 23, Dolby Vision, 120 Гц, HDMI 2.1" },
  "samsung-q60d-qled-50-4k": { az: "Samsung Q60D 50\" QLED 4K Smart TV", ru: "Samsung Q60D 50\" QLED 4K Smart TV", az_d: "Quantum Processor Lite 4K, QLED, Quantum HDR, Tizen, AirSlim", ru_d: "Quantum Processor Lite 4K, QLED, Quantum HDR, Tizen, AirSlim" },
  "xiaomi-tv-a2-65-4k": { az: "Xiaomi TV A2 65\" 4K Smart TV", ru: "Xiaomi TV A2 65\" 4K Smart TV", az_d: "Dolby Vision, HDR10+, MEMC, Android TV 11, HDMI 2.1, 30W stereo", ru_d: "Dolby Vision, HDR10+, MEMC, Android TV 11, HDMI 2.1, стерео 30 Вт" },
  "sony-x90l-55-4k-led": { az: "Sony X90L 55\" 4K Full Array LED", ru: "Sony X90L 55\" 4K Full Array LED", az_d: "XR Backlight Master Drive, Cognitive Processor XR, Google TV, 120Hz", ru_d: "XR Backlight Master Drive, Cognitive Processor XR, Google TV, 120 Гц" },
  "tcl-c745-55-qled-mini-led": { az: "TCL C745 55\" QLED Mini LED 4K", ru: "TCL C745 55\" QLED Mini LED 4K", az_d: "Mini LED QLED, AiPQ Pro, 144Hz, Dolby Vision, Google TV, AMD FreeSync", ru_d: "Mini LED QLED, AiPQ Pro, 144 Гц, Dolby Vision, Google TV, AMD FreeSync" },
  "hisense-u8k-65-mini-led-4k": { az: "Hisense U8K 65\" Mini LED ULED 4K", ru: "Hisense U8K 65\" Mini LED ULED 4K", az_d: "Hi-View Engine, 144Hz, IMAX Enhanced, Google TV, 2.1.2 Dolby Atmos", ru_d: "Hi-View Engine, 144 Гц, IMAX Enhanced, Google TV, 2.1.2 Dolby Atmos" },
  "samsung-cu7000-43-crystal-uhd": { az: "Samsung Crystal UHD 43\" 4K Smart TV", ru: "Samsung Crystal UHD 43\" 4K Smart TV", az_d: "Crystal Processor 4K, AirSlim, Tizen OS, AirPlay 2, 20W səs", ru_d: "Crystal Processor 4K, AirSlim, Tizen OS, AirPlay 2, звук 20 Вт" },
  "lg-ur8100-75-4k-uhd": { az: "LG UR8100 75\" 4K UHD Smart TV", ru: "LG UR8100 75\" 4K UHD Smart TV", az_d: "α5 Gen6 AI Processor, webOS 23, AirPlay 2, ThinQ AI, HDR10", ru_d: "α5 Gen6 AI Processor, webOS 23, AirPlay 2, ThinQ AI, HDR10" },
  "xiaomi-tv-a2-32-hd-smart": { az: "Xiaomi TV A2 32\" HD Smart TV", ru: "Xiaomi TV A2 32\" HD Smart TV", az_d: "Android TV 11, Dolby Audio, DTS-HD, MetaQ çip, HDMI, güzgü ekranı", ru_d: "Android TV 11, Dolby Audio, DTS-HD, чип MetaQ, HDMI, экранное зеркало" },
  "philips-oled908-65-ambilight": { az: "Philips OLED908 65\" Ambilight 4K", ru: "Philips OLED908 65\" Ambilight 4K", az_d: "4-tərəfli Ambilight, Bowers & Wilkins 100W, P5 AI, Google TV", ru_d: "4-стороннее Ambilight, Bowers & Wilkins 100 Вт, P5 AI, Google TV" },
  "tcl-s5400a-50-4k-android": { az: "TCL 50S5400A 50\" 4K Android TV", ru: "TCL 50S5400A 50\" 4K Android TV", az_d: "4K UHD, Dolby Atmos, Android TV 11, Google Assistant, Chromecast", ru_d: "4K UHD, Dolby Atmos, Android TV 11, Google Assistant, Chromecast" },
  "hisense-a6-50-4k-vidaa": { az: "Hisense A6 50\" 4K Smart TV VIDAA", ru: "Hisense A6 50\" 4K Smart TV VIDAA", az_d: "4K UHD, Dolby Vision, DTS Virtual X, VIDAA U6, Film+ rejimi", ru_d: "4K UHD, Dolby Vision, DTS Virtual X, VIDAA U6, режим Film+" },
  "apple-ipad-pro-13-m4-256gb": { az: "Apple iPad Pro 13\" M4 256GB WiFi", ru: "Apple iPad Pro 13\" M4 256GB WiFi", az_d: "Apple M4 çip, Ultra Retina XDR OLED tandem display, Apple Pencil Pro", ru_d: "Чип Apple M4, Ultra Retina XDR OLED tandem, Apple Pencil Pro" },
  "apple-ipad-air-11-m2-128gb": { az: "Apple iPad Air 11\" M2 128GB WiFi", ru: "Apple iPad Air 11\" M2 128GB WiFi", az_d: "Apple M2 çip, 11\" Liquid Retina, USB-C, 12MP kamera, Touch ID", ru_d: "Чип Apple M2, 11\" Liquid Retina, USB-C, камера 12 МП, Touch ID" },
  "apple-ipad-10th-gen-64gb": { az: "Apple iPad 10. nəsil 64GB WiFi", ru: "Apple iPad 10-го поколения 64GB WiFi", az_d: "A14 Bionic, 10.9\" Liquid Retina, 12MP arxa kamera, USB-C", ru_d: "A14 Bionic, 10.9\" Liquid Retina, камера 12 МП, USB-C" },
  "samsung-galaxy-tab-s9-ultra-256gb": { az: "Samsung Galaxy Tab S9 Ultra 256GB", ru: "Samsung Galaxy Tab S9 Ultra 256GB", az_d: "Snapdragon 8 Gen 2, 14.6\" AMOLED 120Hz, S Pen daxil, IP68", ru_d: "Snapdragon 8 Gen 2, 14.6\" AMOLED 120 Гц, S Pen в комплекте, IP68" },
  "samsung-galaxy-tab-s9-128gb": { az: "Samsung Galaxy Tab S9 128GB WiFi", ru: "Samsung Galaxy Tab S9 128GB WiFi", az_d: "Snapdragon 8 Gen 2, 11\" AMOLED 120Hz, S Pen daxil, IP68, DeX rejimi", ru_d: "Snapdragon 8 Gen 2, 11\" AMOLED 120 Гц, S Pen в комплекте, IP68, DeX" },
  "xiaomi-pad-6-pro-256gb": { az: "Xiaomi Pad 6 Pro 256GB", ru: "Xiaomi Pad 6 Pro 256GB", az_d: "Snapdragon 8+ Gen 1, 11\" 2.8K 144Hz, 67W turbo şarj, 8600 mAh", ru_d: "Snapdragon 8+ Gen 1, 11\" 2.8K 144 Гц, зарядка 67 Вт, 8600 мАч" },
  "huawei-matepad-pro-13-256gb": { az: "Huawei MatePad Pro 13.2\" 256GB", ru: "Huawei MatePad Pro 13.2\" 256GB", az_d: "Kirin 9000S, 13.2\" OLED 144Hz, M-Pencil, NearLink, HarmonyOS 4", ru_d: "Kirin 9000S, 13.2\" OLED 144 Гц, M-Pencil, NearLink, HarmonyOS 4" },
  "lenovo-tab-p12-pro-128gb": { az: "Lenovo Tab P12 128GB WiFi", ru: "Lenovo Tab P12 128GB WiFi", az_d: "MediaTek Dimensity 7050, 12.7\" 3K IPS, 10200 mAh, 45W", ru_d: "MediaTek Dimensity 7050, 12.7\" 3K IPS, 10200 мАч, 45 Вт" },
  "samsung-galaxy-tab-a9-plus-128gb": { az: "Samsung Galaxy Tab A9+ 128GB WiFi", ru: "Samsung Galaxy Tab A9+ 128GB WiFi", az_d: "Snapdragon 695, 11\" LCD 90Hz, 7040 mAh, çoxlu əyləncə üçün ideal", ru_d: "Snapdragon 695, 11\" LCD 90 Гц, 7040 мАч, идеально для развлечений" },
  "apple-ipad-mini-6-64gb": { az: "Apple iPad mini 6 64GB WiFi", ru: "Apple iPad mini 6 64GB WiFi", az_d: "Apple A15 Bionic, 8.3\" Liquid Retina, USB-C, 5G dəstəyi, Touch ID", ru_d: "Apple A15 Bionic, 8.3\" Liquid Retina, USB-C, поддержка 5G, Touch ID" },
  "xiaomi-pad-6-128gb": { az: "Xiaomi Pad 6 128GB WiFi", ru: "Xiaomi Pad 6 128GB WiFi", az_d: "Snapdragon 870, 11\" 2.8K 144Hz WQHD+, 8840 mAh, 33W, Dolby Atmos", ru_d: "Snapdragon 870, 11\" 2.8K 144 Гц WQHD+, 8840 мАч, 33 Вт, Dolby Atmos" },
  "oppo-pad-2-256gb": { az: "OPPO Pad 2 256GB WiFi", ru: "OPPO Pad 2 256GB WiFi", az_d: "Dimensity 9000, 11.61\" IPS 144Hz, 9510 mAh, 67W SUPERVOOC şarj", ru_d: "Dimensity 9000, 11.61\" IPS 144 Гц, 9510 мАч, зарядка SUPERVOOC 67 Вт" },
  "samsung-galaxy-tab-s6-lite-2024": { az: "Samsung Galaxy Tab S6 Lite 2024", ru: "Samsung Galaxy Tab S6 Lite 2024", az_d: "Snapdragon 720G, 10.4\" TFT 60Hz, S Pen daxil, 7040 mAh", ru_d: "Snapdragon 720G, 10.4\" TFT 60 Гц, S Pen в комплекте, 7040 мАч" },
  "huawei-matepad-11-2023-128gb": { az: "Huawei MatePad 11 2023 128GB", ru: "Huawei MatePad 11 2023 128GB", az_d: "Snapdragon 865, 10.95\" LCD 120Hz, M-Pencil uyğunluğu, 7250 mAh", ru_d: "Snapdragon 865, 10.95\" LCD 120 Гц, поддержка M-Pencil, 7250 мАч" },
  "lenovo-tab-p11-gen2-128gb": { az: "Lenovo Tab P11 Gen 2 128GB", ru: "Lenovo Tab P11 Gen 2 128GB", az_d: "MediaTek Helio G99, 11.5\" LCD 120Hz, 7700 mAh, gündəlik iş üçün ideal", ru_d: "MediaTek Helio G99, 11.5\" LCD 120 Гц, 7700 мАч, идеально для повседневной работы" },
  "apple-watch-series-9-41mm": { az: "Apple Watch Series 9 41mm GPS", ru: "Apple Watch Series 9 41mm GPS", az_d: "S9 SiP çip, Retina Always-On display, çarpışma aşkarlanması, ECG", ru_d: "Чип S9 SiP, Retina Always-On, обнаружение столкновений, ЭКГ" },
  "apple-watch-ultra-2-49mm": { az: "Apple Watch Ultra 2 49mm Titanium", ru: "Apple Watch Ultra 2 49mm Titanium", az_d: "S9 SiP, 49mm titan, 3000 nit ekran, 60 saat batareya, dual GPS", ru_d: "S9 SiP, 49мм титан, экран 3000 нит, 60 часов, двойной GPS" },
  "samsung-galaxy-watch6-44mm": { az: "Samsung Galaxy Watch6 44mm", ru: "Samsung Galaxy Watch6 44mm", az_d: "Exynos W930, BioActive Sensor, ECG, körpü komposisinə analiz, WearOS 5", ru_d: "Exynos W930, BioActive Sensor, ЭКГ, анализ состава тела, WearOS 5" },
  "samsung-galaxy-watch-classic-pro-47mm": { az: "Samsung Galaxy Watch Ultra 47mm", ru: "Samsung Galaxy Watch Ultra 47mm", az_d: "Exynos W1000, çoxsəviyyəli titan, 100m su keçirməzlik, 3nm çip", ru_d: "Exynos W1000, многослойный титан, 100м водонепроницаемость, 3нм чип" },
  "huawei-watch-gt4-46mm": { az: "Huawei Watch GT4 46mm", ru: "Huawei Watch GT4 46mm", az_d: "14 günlük batareya, ECG, SpO2, GPS, 100+ idman rejimi", ru_d: "14 дней работы, ЭКГ, SpO2, GPS, 100+ спортивных режимов" },
  "xiaomi-watch-s3-47mm": { az: "Xiaomi Watch S3 47mm", ru: "Xiaomi Watch S3 47mm", az_d: "AMOLED 60Hz, HyperOS, 15 gün batareya, 150+ idman rejimi", ru_d: "AMOLED 60 Гц, HyperOS, 15 дней работы, 150+ спортивных режимов" },
  "garmin-fenix-7-pro-solar": { az: "Garmin Fēnix 7 Pro Solar", ru: "Garmin Fēnix 7 Pro Solar", az_d: "Günəş şarjı, 22 gün batareya, çoxband GPS, xəritəçəkmə", ru_d: "Солнечная зарядка, 22 дня, мультиполосный GPS, картография" },
  "fitbit-versa-4-smartwatch": { az: "Fitbit Versa 4 Smartwatch", ru: "Fitbit Versa 4 Smartwatch", az_d: "Günlük 6 gün batareya, GPS, SpO2, ECG, Google Assistant", ru_d: "6 дней работы, GPS, SpO2, ЭКГ, Google Assistant" },
  "huawei-watch-4-pro-48mm": { az: "Huawei Watch 4 Pro 48mm", ru: "Huawei Watch 4 Pro 48mm", az_d: "eSIM, LTE, titan korpus, ECG, qan şəkəri monitorinqi", ru_d: "eSIM, LTE, титановый корпус, ЭКГ, мониторинг сахара в крови" },
  "oppo-band-3-pro": { az: "OPPO Band 3 Pro", ru: "OPPO Band 3 Pro", az_d: "1.75\" AMOLED, 14 gün, SpO2, stres, 100+ idman rejimi", ru_d: "1.75\" AMOLED, 14 дней, SpO2, стресс, 100+ спортивных режимов" },
  "xiaomi-smart-band-8-pro": { az: "Xiaomi Smart Band 8 Pro", ru: "Xiaomi Smart Band 8 Pro", az_d: "1.74\" AMOLED AOD, GPS, SpO2, 14 gün, çoxlu idman rejimi", ru_d: "1.74\" AMOLED AOD, GPS, SpO2, 14 дней, множество спортивных режимов" },
  "samsung-galaxy-watch6-classic-43mm": { az: "Samsung Galaxy Watch6 Classic 43mm", ru: "Samsung Galaxy Watch6 Classic 43mm", az_d: "Döndürülən çərçivə, Super AMOLED, Exynos W930, ECG, WearOS 5", ru_d: "Вращающийся безель, Super AMOLED, Exynos W930, ЭКГ, WearOS 5" },
  "garmin-vivomove-5-sport": { az: "Garmin Vívomove 5 Sport", ru: "Garmin Vívomove 5 Sport", az_d: "Hibrid analog+AMOLED ekran, qan oksigeni, stress, 5 günlük batareya", ru_d: "Гибридный аналог+AMOLED, насыщенность кислородом, стресс, 5 дней" },
  "huawei-band-9": { az: "Huawei Band 9", ru: "Huawei Band 9", az_d: "Ultra-nazik 10.5mm, 1.47\" AMOLED AOD, 14 gün, SpO2", ru_d: "Ультратонкий 10.5 мм, 1.47\" AMOLED AOD, 14 дней, SpO2" },
  "apple-watch-se-2-40mm-gps": { az: "Apple Watch SE (2. nəsil) 40mm", ru: "Apple Watch SE (2-го поколения) 40mm", az_d: "S8 SiP, çarpışma aşkarlanması, avariya SOS, Activity ring", ru_d: "S8 SiP, обнаружение столкновений, экстренный SOS, Activity" },
  "sony-wh-1000xm5-noise-cancelling": { az: "Sony WH-1000XM5 Wireless Headphones", ru: "Sony WH-1000XM5 Беспроводные наушники", az_d: "Sənaye lideri ANC, 30 saat batareya, çox nöqtəli Bluetooth, DSEE Extreme", ru_d: "Лидирующий ANC, 30 часов работы, многоточечный Bluetooth, DSEE Extreme" },
  "apple-airpods-pro-2nd-gen": { az: "Apple AirPods Pro (2. nəsil)", ru: "Apple AirPods Pro (2-го поколения)", az_d: "H2 çip, adaptiv ANC, Spatial Audio, IP54, 30 saat (qutu ilə), USB-C", ru_d: "Чип H2, адаптивный ANC, Spatial Audio, IP54, 30 часов (с кейсом), USB-C" },
  "samsung-galaxy-buds2-pro": { az: "Samsung Galaxy Buds2 Pro", ru: "Samsung Galaxy Buds2 Pro", az_d: "ANC 2.0, 360 Audio, IPX7, 29 saat (qutu ilə), Hi-Fi 24bit", ru_d: "ANC 2.0, 360 Audio, IPX7, 29 часов (с кейсом), Hi-Fi 24 бит" },
  "bose-quietcomfort-45-wireless": { az: "Bose QuietComfort 45 Wireless", ru: "Bose QuietComfort 45 Wireless", az_d: "WorldClass ANC, TriPort akustik quruluş, 24 saat batareya", ru_d: "WorldClass ANC, акустика TriPort, 24 часа работы" },
  "jbl-partybox-310-speaker": { az: "JBL PartyBox 310 Portable Speaker", ru: "JBL PartyBox 310 Портативная колонка", az_d: "240W, iblik işığı effektləri, IPX4, 18 saat, karaoke mikrofon giriş", ru_d: "240 Вт, световые эффекты, IPX4, 18 часов, вход для микрофона" },
  "sony-srs-xb43-extra-bass-speaker": { az: "Sony SRS-XB43 Extra Bass Speaker", ru: "Sony SRS-XB43 Extra Bass Speaker", az_d: "Extra Bass, IP67, 24 saat, Party Connect (100 dinamikə qədər)", ru_d: "Extra Bass, IP67, 24 часа, Party Connect (до 100 колонок)" },
  "jbl-tune-770nc-wireless": { az: "JBL Tune 770NC Wireless", ru: "JBL Tune 770NC Wireless", az_d: "Adaptiv ANC, 70 saat batareya, çox nöqtəli bağlantı", ru_d: "Адаптивный ANC, 70 часов работы, многоточечное подключение" },
  "xiaomi-redmi-buds-4-pro": { az: "Xiaomi Redmi Buds 4 Pro", ru: "Xiaomi Redmi Buds 4 Pro", az_d: "ANC 43dB, 43 saat (qutu ilə), 3-mic, LHDC 5.0, IP54", ru_d: "ANC 43 дБ, 43 часа (с кейсом), 3 микрофона, LHDC 5.0, IP54" },
  "huawei-freebuds-pro-3": { az: "Huawei FreeBuds Pro 3", ru: "Huawei FreeBuds Pro 3", az_d: "Triple Adaptive EQ, IntelliMorph ANC 2.0, 31 saat, Hi-Res Audio", ru_d: "Triple Adaptive EQ, IntelliMorph ANC 2.0, 31 час, Hi-Res Audio" },
  "bose-smart-soundbar-700": { az: "Bose Smart Soundbar 700", ru: "Bose Smart Soundbar 700", az_d: "Dolby Atmos, ADAPTiQ HD, Alexa + Google, Wi-Fi + Bluetooth, HDMI ARC", ru_d: "Dolby Atmos, ADAPTiQ HD, Alexa + Google, Wi-Fi + Bluetooth, HDMI ARC" },
  "samsung-hw-q990c-soundbar": { az: "Samsung HW-Q990C 11.1.4 Soundbar", ru: "Samsung HW-Q990C Саундбар 11.1.4", az_d: "11.1.4 ch, 656W, Dolby Atmos, DTS:X, SpaceFit Sound Pro", ru_d: "11.1.4 кан., 656 Вт, Dolby Atmos, DTS:X, SpaceFit Sound Pro" },
  "apple-airpods-3rd-gen-lightning": { az: "Apple AirPods (3. nəsil) MagSafe", ru: "Apple AirPods (3-го поколения) MagSafe", az_d: "Spatial Audio, adaptiv EQ, H1 çip, 30 saat (qutu ilə), IPX4", ru_d: "Spatial Audio, адаптивный EQ, чип H1, 30 часов (с кейсом), IPX4" },
  "jbl-charge-5-portable-speaker": { az: "JBL Charge 5 Portable Speaker", ru: "JBL Charge 5 Портативная колонка", az_d: "30W, IP67, 20 saat, powerbank funksiyası, PartyBoost", ru_d: "30 Вт, IP67, 20 часов, функция PowerBank, PartyBoost" },
  "samsung-galaxy-buds3-pro": { az: "Samsung Galaxy Buds3 Pro", ru: "Samsung Galaxy Buds3 Pro", az_d: "ANC 2.0, 360 Audio, Hi-Fi 24bit, IPX7, 37 saat (qutu ilə)", ru_d: "ANC 2.0, 360 Audio, Hi-Fi 24 бит, IPX7, 37 часов (с кейсом)" },
  "sony-wf-1000xm5-tws": { az: "Sony WF-1000XM5 True Wireless", ru: "Sony WF-1000XM5 True Wireless", az_d: "Sənaye lideri ANC, LDAC, 24 saat (qutu ilə), 8.4mm sürücü", ru_d: "Лидирующий ANC, LDAC, 24 часа (с кейсом), драйвер 8.4 мм" },
  "sony-alpha-a7-iv-mirrorless": { az: "Sony Alpha A7 IV Mirrorless (Gövdə)", ru: "Sony Alpha A7 IV Беззеркальная (Тело)", az_d: "33MP BSI CMOS, BIONZ XR, 4K 60fps, Real-time AF, 10fps, 5-axis IBIS", ru_d: "33 МП BSI CMOS, BIONZ XR, 4K 60 кадр/с, Real-time AF, 5-ос. IBIS" },
  "canon-eos-r6-mark-ii-body": { az: "Canon EOS R6 Mark II (Gövdə)", ru: "Canon EOS R6 Mark II (Тело)", az_d: "24.2MP CMOS, DIGIC X, 40fps RAW Burst, 4K 60fps, Dual Pixel CMOS AF II", ru_d: "24.2 МП CMOS, DIGIC X, 40 кадр/с RAW Burst, 4K 60 кадр/с" },
  "nikon-z-fc-mirrorless-body": { az: "Nikon Z fc Mirrorless (Gövdə)", ru: "Nikon Z fc Беззеркальная (Тело)", az_d: "20.9MP DX, Expeed 6, retro dizayn, 11fps, 4K UHD, Bluetooth + WiFi", ru_d: "20.9 МП DX, Expeed 6, ретро-дизайн, 11 кадр/с, 4K UHD, BT + Wi-Fi" },
  "fujifilm-x-t5-body": { az: "Fujifilm X-T5 Mirrorless (Gövdə)", ru: "Fujifilm X-T5 Беззеркальная (Тело)", az_d: "40.2MP X-Trans CMOS 5 HR, X-Processor 5, IBIS 7-stop, Film Simulation", ru_d: "40.2 МП X-Trans CMOS 5 HR, X-Processor 5, IBIS 7 ступеней, Film Simulation" },
  "sony-zv-e10-vlog-camera": { az: "Sony ZV-E10 Vlog Kamera (Gövdə)", ru: "Sony ZV-E10 Видеокамера (Тело)", az_d: "24.2MP APS-C, Real-time AF, 4K video, çevrilə bilən ekran, YouTube üçün ideal", ru_d: "24.2 МП APS-C, Real-time AF, 4K видео, поворотный экран, для YouTube" },
  "canon-powershot-g7x-mark-iii": { az: "Canon PowerShot G7 X Mark III", ru: "Canon PowerShot G7 X Mark III", az_d: "20.1MP 1\" BSI CMOS, 4K video, f/1.8, USB-C şarj, canlı yayım", ru_d: "20.1 МП 1\" BSI CMOS, 4K видео, f/1.8, USB-C зарядка, прямая трансляция" },
  "dji-osmo-action-5-pro": { az: "DJI Osmo Action 5 Pro", ru: "DJI Osmo Action 5 Pro", az_d: "4K 120fps, RockSteady 4.0, 32GB daxili yaddaş, 145min batareya", ru_d: "4K 120 кадр/с, RockSteady 4.0, 32 ГБ встроенная память, 145 мин" },
  "gopro-hero12-black": { az: "GoPro HERO12 Black", ru: "GoPro HERO12 Black", az_d: "5.3K60/4K120, HyperSmooth 6.0, 13h batareya, HDR video", ru_d: "5.3K60/4K120, HyperSmooth 6.0, 13ч работы, HDR видео" },
  "sony-alpha-a6700-body": { az: "Sony Alpha A6700 (Gövdə)", ru: "Sony Alpha A6700 (Тело)", az_d: "26MP APS-C, AI Processor, 4K 120fps, 5-axis IBIS, Real-time AF", ru_d: "26 МП APS-C, AI Processor, 4K 120 кадр/с, 5-ос. IBIS, Real-time AF" },
  "nikon-z30-vlog-body": { az: "Nikon Z30 Vlog Kamera (Gövdə)", ru: "Nikon Z30 Видеокамера (Тело)", az_d: "20.9MP APS-C, 4K 30fps, vlog dizaynı, flip ekran, 125min video", ru_d: "20.9 МП APS-C, 4K 30 кадр/с, vlog-дизайн, откидной экран, 125 мин" },
  "insta360-x4-360-camera": { az: "Insta360 X4 360° Kamera", ru: "Insta360 X4 360° Камера", az_d: "8K 360°, ActiveHDR, 135min batareya, AI qurulma, selfie çubuğu görünməz", ru_d: "8K 360°, ActiveHDR, 135 мин работы, AI редактирование" },
  "fujifilm-x-s20-body": { az: "Fujifilm X-S20 (Gövdə)", ru: "Fujifilm X-S20 (Тело)", az_d: "26.1MP X-Trans CMOS 4, 4K 60fps HQ, 6-stop IBIS, Film Simulation", ru_d: "26.1 МП X-Trans CMOS 4, 4K 60 кадр/с HQ, IBIS 6 ст., Film Simulation" },
  "sony-rx100-vii-compact": { az: "Sony RX100 VII Compact Kamera", ru: "Sony RX100 VII Компактная камера", az_d: "20.1MP 1\" CMOS, 357 nöqtəli AF, 20fps, 4K HDR, pop-up EVF", ru_d: "20.1 МП 1\" CMOS, 357-точечный AF, 20 кадр/с, 4K HDR, EVF" },
  "dji-air-3-drone-fly-more": { az: "DJI Air 3 Fly More Combo", ru: "DJI Air 3 Fly More Combo", az_d: "Dual 48MP kamera, 4K 100fps, 46min uçuş, omnidirektional maneə aşkarlanması", ru_d: "Двойная камера 48 МП, 4K 100 кадр/с, 46 мин полёта, 360° обнаружение" },
  "canon-eos-r50-18-45mm-kit": { az: "Canon EOS R50 + 18-45mm Kit", ru: "Canon EOS R50 + 18-45mm Kit", az_d: "24.2MP APS-C, Dual Pixel AF II, 4K 30fps, compact quruluş, 15fps", ru_d: "24.2 МП APS-C, Dual Pixel AF II, 4K 30 кадр/с, компактный, 15 кадр/с" },
  "sony-playstation-5-825gb": { az: "Sony PlayStation 5 825GB", ru: "Sony PlayStation 5 825GB", az_d: "AMD RDNA 2, 825GB SSD, 4K 120fps, ray tracing, DualSense haptik kontroller", ru_d: "AMD RDNA 2, 825 ГБ SSD, 4K 120 кадр/с, трассировка лучей, DualSense" },
  "microsoft-xbox-series-x-1tb": { az: "Microsoft Xbox Series X 1TB", ru: "Microsoft Xbox Series X 1TB", az_d: "12 TFLOPS, 1TB NVMe SSD, 4K 120fps, Quick Resume, Xbox Game Pass", ru_d: "12 TFLOPS, 1 ТБ NVMe SSD, 4K 120 кадр/с, Quick Resume, Xbox Game Pass" },
  "nintendo-switch-oled-model": { az: "Nintendo Switch OLED Model", ru: "Nintendo Switch OLED Model", az_d: "7\" OLED ekran, dock, Joy-Con controllers, 64GB, TV/masa/əl rejimləri", ru_d: "7\" OLED экран, докстанция, контроллеры Joy-Con, 64 ГБ, 3 режима" },
  "sony-dualsense-ps5-controller-white": { az: "Sony DualSense PS5 Controller Ağ", ru: "Sony DualSense PS5 Контроллер Белый", az_d: "Adaptiv tətikçilər, haptik vibrasiya, USB-C, 12 saat batareya", ru_d: "Адаптивные триггеры, хаптическая отдача, USB-C, 12 часов" },
  "logitech-g-pro-x-superlight2": { az: "Logitech G PRO X Superlight 2", ru: "Logitech G PRO X Superlight 2", az_d: "HERO 2 25600 DPI, 60h batareya, 61g ultra-yüngül, 4000Hz polling rate", ru_d: "HERO 2 25600 DPI, 60ч работы, 61г ультралёгкая, 4000 Гц опрос" },
  "razer-basilisk-v3-pro-wired": { az: "Razer Basilisk V3 Pro Wireless", ru: "Razer Basilisk V3 Pro Wireless", az_d: "Focus Pro 30K sensor, 90h batareya, HyperScroll Pro, Chroma RGB", ru_d: "Сенсор Focus Pro 30K, 90 ч, HyperScroll Pro, Chroma RGB" },
  "samsung-odyssey-g9-49-curved-gaming": { az: "Samsung Odyssey G9 49\" Curved Monitor", ru: "Samsung Odyssey G9 49\" Curved Monitor", az_d: "49\" 1000R Dual QHD 240Hz, HDR1000, G-Sync Compatible, QLED", ru_d: "49\" 1000R Dual QHD 240 Гц, HDR1000, G-Sync, QLED" },
  "microsoft-xbox-series-s-512gb": { az: "Microsoft Xbox Series S 512GB", ru: "Microsoft Xbox Series S 512GB", az_d: "4 TFLOPS GPU, 512GB SSD, 1440p 120fps, Xbox Game Pass uyğunluğu", ru_d: "GPU 4 TFLOPS, 512 ГБ SSD, 1440p 120 кадр/с, Xbox Game Pass" },
  "hyperx-cloud-alpha-wireless-gaming": { az: "HyperX Cloud Alpha Wireless", ru: "HyperX Cloud Alpha Wireless", az_d: "300 saat batareya, 7.1 surround, Dual Chamber əsas, PS4/PS5/PC", ru_d: "300 часов работы, 7.1 surround, Dual Chamber, PS4/PS5/PC" },
  "steam-deck-512gb-oled": { az: "Steam Deck OLED 512GB", ru: "Steam Deck OLED 512 ГБ", az_d: "7.4\" HDR OLED ekran, AMD APU Zen2+RDNA 2, SteamOS, 50Wh batareya", ru_d: "7.4\" HDR OLED, AMD APU Zen2+RDNA 2, SteamOS, 50 Вт⋅ч" },
  "razer-kishi-v2-mobile-controller": { az: "Razer Kishi V2 Mobile Controller", ru: "Razer Kishi V2 Mobile Controller", az_d: "Xbox Cloud Gaming, xStream texnologiyası, USB-C passthrough şarj", ru_d: "Xbox Cloud Gaming, xStream, USB-C сквозная зарядка" },
  "asus-rog-ally-x-512gb": { az: "ASUS ROG Ally X 512GB", ru: "ASUS ROG Ally X 512 ГБ", az_d: "AMD Ryzen Z1 Extreme, 24GB RAM, 7\" FHD 120Hz, Windows 11", ru_d: "AMD Ryzen Z1 Extreme, 24 ГБ RAM, 7\" FHD 120 Гц, Windows 11" },
  "logitech-g29-driving-force-wheel": { az: "Logitech G29 Driving Force Wheel", ru: "Logitech G29 Driving Force Wheel", az_d: "Dual-motor force feedback, 11\" dəri örtüklü sükan, pedallar daxil", ru_d: "Двухмоторная обратная связь, 11\" руль из кожи, педали в комплекте" },
  "meta-quest-3-mixed-reality": { az: "Meta Quest 3 512GB Mixed Reality", ru: "Meta Quest 3 512GB Mixed Reality", az_d: "Snapdragon XR2 Gen 2, 2064×2208/göz, 110° FOV, qarışıq reallıq", ru_d: "Snapdragon XR2 Gen 2, 2064×2208/глаз, 110° FOV, смешанная реальность" },
  "sennheiser-gsp-600-gaming-headset": { az: "Sennheiser GSP 600 Gaming Headset", ru: "Sennheiser GSP 600 Gaming Headset", az_d: "Simli, 7.1 Surround, XXL Alcantara yastıqlar, 115dB, həcm dial", ru_d: "Проводной, 7.1 Surround, XXL Alcantara подушки, 115 дБ" },
  "lg-turbowash-9kg-ai-washing-machine": { az: "LG TurboWash 9KG AI Paltaryuyan", ru: "LG TurboWash 9КГ AI Стиральная машина", az_d: "AI DD Motor, TurboWash 39dəq, ThinQ app, A enerji sinfi, buxar", ru_d: "AI DD Motor, TurboWash 39мин, ThinQ app, класс A, функция пара" },
  "samsung-bespoke-4-door-flex-refrigerator": { az: "Samsung Bespoke 4-Qapılı Soyuducu", ru: "Samsung Bespoke 4-дверный Холодильник", az_d: "FlexZone, Beverage Center, AutoFill Water Pitcher, Wi-Fi, modular panel", ru_d: "FlexZone, Beverage Center, AutoFill Water Pitcher, Wi-Fi, модульные панели" },
  "dyson-v15-detect-absolute-vacuum": { az: "Dyson V15 Detect Absolute Cordless", ru: "Dyson V15 Detect Absolute Беспроводной", az_d: "Laser tozu aşkarlanması, HEPA filtrasiya, 60dəq batareya, 230 Hava Watt", ru_d: "Лазерное обнаружение пыли, фильтрация HEPA, 60 мин батарея, 230 Вт" },
  "lg-dualcool-12000-btu-ac": { az: "LG DualCool 12000 BTU Kondisioner", ru: "LG DualCool 12000 BTU Кондиционер", az_d: "Dual Inverter Compressor, WiFi ThinQ, Plasmaster Ion, A++ enerji", ru_d: "Dual Inverter Compressor, WiFi ThinQ, Plasmaster Ion, A++" },
  "philips-air-purifier-ac2958": { az: "Philips AirPurifier 3000i Series", ru: "Philips AirPurifier 3000i Series", az_d: "HEPA filtrasiya, AeraSense sensor, 40m², WiFi, Allergen Mode", ru_d: "Фильтрация HEPA, AeraSense сенсор, 40 м², WiFi, режим Allergen" },
  "instant-pot-duo-crisp-6l": { az: "Instant Pot Duo Crisp 6L", ru: "Instant Pot Duo Crisp 6L", az_d: "11-in-1 çoxpişirici: təzyiqli bişirmə, qızartma, fırın, dehydrator", ru_d: "11-в-1 мультиварка: скороварка, фритюр, духовка, дегидратор" },
  "samsung-ww90t-ai-ecobubble-9kg": { az: "Samsung EcoBubble AI 9KG Paltaryuyan", ru: "Samsung EcoBubble AI 9КГ Стиральная машина", az_d: "AI Optimal Wash, EcoBubble, QuickDrive 39dəq, A enerji sinfi", ru_d: "AI Optimal Wash, EcoBubble, QuickDrive 39 мин, класс A" },
  "dyson-hp09-hot-cool-purifier": { az: "Dyson Hot+Cool HP09 Air Purifier", ru: "Dyson Hot+Cool HP09 Очиститель воздуха", az_d: "HEPA+karbon filtrasiya, isıtma, soyutma, hava təmizləmə, WiFi", ru_d: "Фильтрация HEPA+уголь, обогрев, охлаждение, очистка воздуха, WiFi" },
  "lg-corbot-r5t-robot-vacuum": { az: "LG CordZero R5T Robot Tozsoran", ru: "LG CordZero R5T Робот-пылесос", az_d: "LiDAR naviqasiya, 2500Pa sorma, mop funksiyası, ThinQ, 90min batareya", ru_d: "LiDAR навигация, всасывание 2500 Па, функция швабры, ThinQ, 90 мин" },
  "kitchenaid-artisan-stand-mixer-5qt": { az: "KitchenAid Artisan Stand Mixer 5Qt", ru: "KitchenAid Artisan Stand Mixer 5 кварт", az_d: "5 kvart paslanmaz polad kasa, 10 sürət, 59 aksesuar uyğunluğu, 325W", ru_d: "5 кварт нержавеющая чаша, 10 скоростей, 59 насадок, 325 Вт" },
  "philips-3200-series-espresso-machine": { az: "Philips 3200 Series Espresso Maşını", ru: "Philips 3200 Series Кофемашина", az_d: "LatteGo süd sistemi, qrinderdən fincanadək, 5 içki növü", ru_d: "Система LatteGo, от зерна до чашки, 5 видов напитков" },
  "irobot-roomba-j9-plus-combo": { az: "iRobot Roomba Combo j9+ Robot", ru: "iRobot Roomba Combo j9+ Робот", az_d: "PrecisionVision naviqasiya, mop + tozsoran, avtomatik boşaltma bazası", ru_d: "PrecisionVision навигация, швабра + пылесос, автоматическая база" },
  "samsung-mg28-convection-microwave": { az: "Samsung 28L Konveksiyon Mikrodalğa", ru: "Samsung 28L Конвекционная микроволновка", az_d: "28L, konveksiyon, grill, 900W, Slim Fry texnologiyası", ru_d: "28 л, конвекция, гриль, 900 Вт, технология Slim Fry" },
  "dyson-airwrap-multi-styler-complete": { az: "Dyson Airwrap Complete Multi-Styler", ru: "Dyson Airwrap Complete Multi-Styler", az_d: "Coanda effekti, curl + düzləşdirmə + qurutma, hərarətsiz texnologiya", ru_d: "Эффект Коанды, завивка + выпрямление + сушка, без экстремального жара" },
  "lg-quadwash-14-place-dishwasher": { az: "LG QuadWash 14 Set Qabyuyan", ru: "LG QuadWash 14 Комплектов Посудомойка", az_d: "QuadWash 4 dönər qol, TrueSteam, SmartThinQ, A enerji sinfi", ru_d: "QuadWash 4 вращающихся плеча, TrueSteam, SmartThinQ, класс A" },
  "apple-magsafe-charger-15w": { az: "Apple MagSafe Charger 1m 15W", ru: "Apple MagSafe Charger 1m 15W", az_d: "iPhone 15/14/13/12 uyğun, 15W MagSafe, maqnit lövbərləmə", ru_d: "Совместим с iPhone 15/14/13/12, 15 Вт MagSafe, магнитное крепление" },
  "anker-736-100w-gan-charger": { az: "Anker 736 Nano II 100W GaN Charger", ru: "Anker 736 Nano II 100W GaN Charger", az_d: "100W GaN II, 3 port (2× USB-C + 1× USB-A), laptop + telefon + saat", ru_d: "100 Вт GaN II, 3 порта (2× USB-C + 1× USB-A), ноутбук + телефон + часы" },
  "ugreen-usb-c-to-c-240w-cable": { az: "UGREEN USB-C to USB-C 240W Kabel 2m", ru: "UGREEN USB-C to USB-C 240W Кабель 2м", az_d: "240W 48V/5A PD 3.1, 40Gbps Thunderbolt 3 uyğunluğu, 8K video", ru_d: "240 Вт 48В/5А PD 3.1, совместимость Thunderbolt 3 40 Гбит/с, 8K видео" },
  "spigen-screen-protector-iphone-15-pro": { az: "Spigen iPhone 15 Pro EZ Fit Şüşə", ru: "Spigen iPhone 15 Pro EZ Fit Стекло", az_d: "Tempered glass 9H, tam uyğunluq, EZ Fit lövbərləmə çərçivəsi", ru_d: "Защитное стекло 9H, идеальное прилегание, рамка EZ Fit" },
  "baseus-7-in-1-usb-c-hub": { az: "Baseus 7-in-1 USB-C Hub", ru: "Baseus 7-in-1 USB-C Hub", az_d: "4K HDMI, 3× USB 3.0, SD/MicroSD, 100W PD, MacBook/laptop üçün ideal", ru_d: "4K HDMI, 3× USB 3.0, SD/MicroSD, 100 Вт PD, идеально для MacBook" },
  "ringke-fusion-case-iphone-15-pro-max": { az: "Ringke Fusion iPhone 15 Pro Max Keis", ru: "Ringke Fusion iPhone 15 Pro Max Чехол", az_d: "Şəffaf PC arxa + TPU kənar, anti-sarıtma, kamera qoruma, MagSafe uyğun", ru_d: "Прозрачный PC + TPU рамка, анти-желтизна, защита камеры, MagSafe" },
  "anker-powercore-26800-power-bank": { az: "Anker PowerCore 26800mAh PD", ru: "Anker PowerCore 26800мАч PD", az_d: "26800mAh, 87W PD çıxış, 3 port çıxış, 2 port giriş, noutbuk uyğunluğu", ru_d: "26800 мАч, 87 Вт PD выход, 3 порта выхода, 2 порта ввода" },
  "samsung-t7-portable-ssd-1tb": { az: "Samsung T7 Portable SSD 1TB", ru: "Samsung T7 Portable SSD 1 ТБ", az_d: "1050 MB/s oxuma, USB 3.2 Gen2, şifrələmə, cib ölçüsü, metal korpus", ru_d: "Чтение 1050 МБ/с, USB 3.2 Gen2, шифрование, размер с кошелёк, металл" },
  "belkin-iphone-stand-15w-magsafe": { az: "Belkin MagSafe 15W iPhone Dayağı", ru: "Belkin MagSafe 15W Подставка iPhone", az_d: "15W MagSafe, tilt dayağı, görüş istiqamətinə görə şarj", ru_d: "15 Вт MagSafe, наклонная подставка, зарядка в любом положении" },
  "logitech-mx-keys-s-wireless-keyboard": { az: "Logitech MX Keys S Wireless Keyboard", ru: "Logitech MX Keys S Беспроводная клавиатура", az_d: "Smartbacklighting, Logi Options+, 3 cihaz Bluetooth + USB, 10 gün batareya", ru_d: "Smart-подсветка, Logi Options+, Bluetooth на 3 устройства, 10 дней" },
  "logitech-mx-master-3s-wireless-mouse": { az: "Logitech MX Master 3S Wireless Mouse", ru: "Logitech MX Master 3S Беспроводная мышь", az_d: "8K DPI, MagSpeed scroll, tilt scroll, 3 cihaz, 70 gün batareya", ru_d: "8K DPI, прокрутка MagSpeed, боковой скролл, 3 устройства, 70 дней" },
  "samsung-evo-plus-256gb-microsd": { az: "Samsung EVO Plus 256GB MicroSDXC", ru: "Samsung EVO Plus 256 ГБ MicroSDXC", az_d: "160MB/s oxuma, UHS-I, U3, V30, A2, kamera/drone/telefon üçün ideal", ru_d: "Чтение 160 МБ/с, UHS-I, U3, V30, A2, для камеры/дрона/телефона" },
  "3mk-privacy-screen-filter-macbook14": { az: "3MK Privacy Screen Filter MacBook 14\"", ru: "3MK Privacy Screen Filter MacBook 14\"", az_d: "Gizlilik filtr, 60° baxış açısı, anti-yansıtma, anti-toplanma", ru_d: "Фильтр конфиденциальности, угол 60°, антибликовый, антипыльный" },
  "esr-ipad-pro-11-rebound-case": { az: "ESR iPad Pro 11\" Rebound Keis", ru: "ESR iPad Pro 11\" Rebound Чехол", az_d: "3-bucaqlı dayaq, Apple Pencil sloyu, hücrəli poliuretan dəri", ru_d: "3 угла наклона, слот Apple Pencil, ячеистый PU кожа" },
  "jbl-clip-5-mini-bluetooth-speaker": { az: "JBL Clip 5 Mini Bluetooth Speaker", ru: "JBL Clip 5 Мини Bluetooth-колонка", az_d: "12 saat, IP67, carabiner klips, JBL Pro Sound, ultra-portable, USB-C", ru_d: "12 часов, IP67, карабин-клипса, JBL Pro Sound, ультрапортативная" },
};

async function fixTranslations() {
  console.log("🔧 Fixing translations...\n");

  // Fix category translations
  console.log("📂 Fixing category translations...");
  const { data: cats } = await admin.from("categories").select("id, slug");
  for (const cat of cats ?? []) {
    const t = CAT_TRANSLATIONS[cat.slug];
    if (!t) continue;
    // Check if translations already exist correctly
    const { data: existing } = await admin.from("category_translations")
      .select("id").eq("category_id", cat.id).eq("lang_code", "az");
    if (existing?.length) {
      console.log(`  ⏭  ${cat.slug} already has AZ translation`);
      continue;
    }
    // Delete any broken translations (with null lang_code)
    await admin.from("category_translations").delete().eq("category_id", cat.id).is("lang_code", null);
    // Insert correct ones
    await admin.from("category_translations").insert([
      { category_id: cat.id, lang_code: "az", title: t.az },
      { category_id: cat.id, lang_code: "ru", title: t.ru },
      { category_id: cat.id, lang_code: "en", title: t.en },
    ]);
    console.log(`  ✅ ${cat.slug} → ${t.az}`);
  }

  // Fix product translations
  console.log("\n📦 Fixing product translations...");
  const { data: prods } = await admin.from("products").select("id, slug");
  let fixed = 0, skipped = 0;
  for (const prod of prods ?? []) {
    const t = PROD_TRANSLATIONS[prod.slug];
    if (!t) continue;
    // Check existing
    const { data: existing } = await admin.from("product_translations")
      .select("id").eq("product_id", prod.id).eq("lang_code", "az");
    if (existing?.length) { skipped++; continue; }
    // Delete null ones
    await admin.from("product_translations").delete().eq("product_id", prod.id).is("lang_code", null);
    // Insert correct translations
    await admin.from("product_translations").insert([
      { product_id: prod.id, lang_code: "az", title: t.az, description: t.az_d },
      { product_id: prod.id, lang_code: "ru", title: t.ru, description: t.ru_d },
      { product_id: prod.id, lang_code: "en", title: t.az, description: t.az_d },
    ]);
    fixed++;
  }
  console.log(`  ✅ Fixed ${fixed} products, skipped ${skipped} already-correct.`);
  console.log("\n✨ All translations fixed!");
}

fixTranslations().catch(e => { console.error(e); process.exit(1); });
