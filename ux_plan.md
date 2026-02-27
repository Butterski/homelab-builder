# Dokumentacja Redesignu UI/UX: Homelab Builder
**Cel:** Przejście z surowego, inżynieryjnego wyglądu na nowoczesny, luksusowy interfejs w stylu Web3 Pro-Tool (tzw. "Solid & Precise"). 
**Główna zasada:** ZERO glassmorphismu. Skupiamy się na matowych powierzchniach, ostrych detalach, mikroskopijnych ramkach i doskonałej typografii.

## 1. Węzły / Karty Urządzeń (Nodes)
Obecne, grube i jaskrawe obramowania należy całkowicie usunąć. Karta ma wyglądać jak precyzyjnie wycięty kawałek ciemnego metalu.
* **Tło:** Jednolity, nieprzezroczysty i bardzo ciemny grafit/czerń (np. `#111113` lub `#18181B`).
* **Obramowanie (Border):** Ekstremalnie cienka, 1-pikselowa ramka w kolorze bardzo delikatnej szarości (np. `rgba(255, 255, 255, 0.08)` lub `#27272A`).
* **Wskaźnik statusu:** Zamiast obrysowywać całą kartę kolorem, zastosuj tylko jeden z poniższych akcentów:
    * Cienki (2px) pasek koloru (np. zielony dla działającego, czerwony dla błędu) wyłącznie na górnej krawędzi karty (`border-top`).
    * Świecąca, mała kropka (LED dot) obok nazwy urządzenia.
* **Cienie:** Brak klasycznych cieni (Drop Shadow) podnoszących element. Karta ma leżeć "płasko".

## 2. Przestrzeń Robocza i Oświetlenie (Canvas & Lighting)
* **Tło aplikacji (Background):** Bardzo głęboki odcień (np. `#0B0B0E`), unikamy absolutnej czerni (`#000000`).
* **Siatka (Grid):** Punkty siatki muszą mieć drastycznie zmniejszoną widoczność (opacity na poziomie 5-8%). Mają stanowić ledwo zauważalną teksturę.
* **Oświetlenie (Spotlight Effect):** Zamiast cieni na kartach, wygeneruj delikatny, promienisty gradient (Radial Gradient) na tle roboczym, dokładnie *pod* aktywnymi węzłami. Karta powinna wyglądać, jakby rzucała na płótno własne, bardzo rozmyte światło w kolorze swojego statusu.

## 3. Połączenia i Routing (Circuit Board Style)
Obecne ukośne, kropkowane linie należy zastąpić precyzyjnym routingiem.
* **Styl linii (Orthogonal Routing):** Linie mogą załamywać się **tylko pod kątem prostym** (90 stopni).
* **Narożniki:** Załamania linii muszą być zaokrąglone (corner radius ok. 8px - 12px), co przypomina ścieżki na nowoczesnej płycie głównej.
* **Wygląd linii:** Linia bazowa powinna być ciągła, cienka (1px lub 2px) i ciemnoszara (`#3F3F46`).
* **Animacja przepływu (Data Flow):** Na liniach bazowych nałóż animowane, jasne segmenty (dashes), które płynnie przesuwają się w kierunku przepływu danych.

## 4. Układ i Panele Boczne (Layout & UI Controls)
* **Flat & Bordered:** Panele boczne i górny pasek narzędzi (np. "Library", "Resource Usage") muszą być całkowicie płaskie.
* **Separacja:** Oddziel panele od płótna (canvas) wyłącznie ostrą, jednopikselową linią (`border-right`, `border-bottom` w kolorze np. `#27272A`). Nie używaj tu żadnych cieni (box-shadow).

## 5. Typografia
Hierarchia tekstu musi opierać się na drastycznym kontraście.
* **Etykiety (Labels):** Teksty takie jak "IP:", "Cores:" powinny być małe (np. 11-12px), w kolorze zgaszonej szarości (`#A1A1AA`) i napisane nowoczesnym, geometrycznym fontem bezszeryfowym (np. *Inter*, *Geist* lub *Plus Jakarta Sans*).
* **Wartości (Values):** Dane techniczne (np. `192.168.1.108`) muszą być jasnobiałe (`#FAFAFA`) i napisane krojem typu monospaced (np. *JetBrains Mono* lub *Fira Code*). To nada interfejsowi technicznego, hackerskiego sznytu w wydaniu premium.