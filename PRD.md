# PRD - Teamball

**Game sepak bola oper-operan 2D top-down untuk web, deploy di Vercel.**
Working title: **Teamball** · Versi PRD: 0.1 (2026-10-24) · Status: Draft

---

## 1. Ringkasan

Teamball adalah game sepak bola **2D top-down** yang berfokus pada **oper-operan (passing)**, dengan rasa main ala PES / eFootball / FIFA tapi disederhanakan dan dibuat arcade. Satu pemain mengontrol satu tim (auto-switch pemain terdekat seperti PES), melawan AI. Match bisa dimainkan dalam format **2v2, 5v5, atau 11v11** dengan ukuran lapangan yang menyesuaikan format. **Minimap (radar)** selalu tampil di bawah layar seperti PES/FIFA.

Game berjalan 100% di browser (client-side), di-deploy sebagai static site di **Vercel** supaya gampang di-manage: push ke GitHub → auto deploy → dapat link buat share ke teman.

### Falsafah desain
1. **Passing dulu** - kepuasan utama adalah tiki-taka: operan yang bersih, through ball yang pas, dan satu-dua. Shooting & goal tetap ada, tapi build-up adalah intinya.
2. **Baca-musuh, bukan react-check** - AI harus terasa seperti tim: menjaga formasi, menekan di saat tepat, dan bisa dibohongi dengan pergerakan.
3. **Kontrol sederhana, kedalaman di timing & keputusan** - tombol sedikit, tapi arah + power + timing pass menentukan kualitas.
4. **Cepat dimainkan** - dari buka link sampai kickoff < 10 detik. Durasi half pendek (2-4 menit).

---

## 2. Tujuan & Non-Tujuan

### Tujuan (v1.0)
- Match lengkap vs AI: kickoff → 2 half → full-time + statistik.
- 3 mode: **2v2, 5v5, 11v11** dengan ukuran lapangan, gawang, dan aturan yang proporsional.
- Mekanik ala PES: short pass, through ball, long ball/cross, shoot dengan power gauge, sprint, switching pemain, tackle.
- Minimap/radar di bawah tengah layar.
- Kontrol keyboard + gamepad (Gamepad API, mapping ala PES).
- 60 fps di browser desktop, deploy static di Vercel.

### Non-Tujuan (sengaja tidak dikerjakan di v1.0)
- ❌ Multiplayer online real-time (dibahas di §10 sebagai fase lanjutan - Vercel tidak cocok untuk WebSocket server persisten).
- ❌ Mode karier/turnamen/liga.
- ❌ Karakter 3D atau isometrik kompleks - tetap 2D.
- ❌ Tim/liga real (pakai tim preset fiktif).
- ❌ Mobile touch (post-1.0, virtual joystick).
- ❌ Kartu merah/kuning, VAR, free kick penuh (fouls disederhanakan).

---

## 3. Mode & Ukuran Lapangan

Semua mode memakai mesin & mekanik yang sama; yang berbeda hanya **konfigurasi** (lapangan, jumlah pemain, aturan, durasi, zoom kamera).

| Mode | Pemain per tim | Lapangan (meter) | Gawang | Aturan khusus | Durasi default |
|------|----------------|------------------|--------|----------------|----------------|
| **2v2** | 2 outfield, tanpa kiper | 24 × 14 | kecil, lebar 2,5 m | tanpa offside; semua restart = kick-in | 2 × 2 menit |
| **5v5** | 4 outfield + 1 kiper (futsal) | 40 × 20 | 3 × 2 m | tanpa offside; kick-in; aturan kiper sederhana | 2 × 2 menit |
| **11v11** | 10 outfield + 1 kiper | 105 × 68 | 7,32 × 2,44 m | offside (toggle, default ON); corner, goal kick, kick-in (throw-in disederhanakan) | 2 × 3 menit |

Catatan:
- Satuan dunia = **meter**; render mengkonversi meter → pixel via zoom kamera per mode.
- Durasi half & difficulty bisa diubah di menu (durasi 2-6 menit).
- Statistik dicatat sama untuk semua mode (jumlah pass justru jadi stat utama, lihat §4.6).

---

## 4. Gameplay

### 4.1 Perspektif & kamera
- View **top-down** dengan lapangan orientasi horizontal (main kiri ↔ kanan seperti siaran TV).
- Kamera mengikuti bola dengan **look-ahead** (offset ke arah gerak bola) dan smooth lerp; zoom berbeda per mode (2v2 paling zoom-in, 11v11 paling jauh).
- **Minimap/radar** di bawah-tengah layar: seluruh lapangan, dot per pemain (warna tim, pemain aktif di-highlight + segitiga), dot bola (putih), dan indikasi area pandang kamera. Bisa di-toggle on/off di settings.

### 4.2 Kontrol (keyboard, default)

| Aksi | Tombol | Padanan gamepad (ala PES) |
|------|--------|---------------------------|
| Gerak | WASD / arrow keys | Left stick |
| Sprint | Shift | RT / R2 |
| Short pass / (lawan: tekan pemain bawa bola) | **Space** (tap = oper pendek, tahan = power) | A / Cross |
| Through ball (operan ke ruang kosong) | **E** | Y / Triangle |
| Long ball / cross (lob) | **Q** (tahan = power) | X / Square |
| Shoot (tahan = power gauge) | **F** | B / Circle |
| Ganti pemain (manual, saat bertahan) | **Tab** | LB / L1 |
| Tekan pemain bola (secondary press) | **Ctrl** | RB / R1 |
| Pause / menu | **Esc** | Start |

- Gamepad didukung via **Gamepad API** dengan mapping standar di atas; rebindable UI menyusul (v1.1+).
- Kontrol kontekstual ala PES: tombol yang sama berfungsi beda saat tim kita menguasai bola vs bertahan (mis. F = shoot saat menyerang, F = standing tackle saat bertahan).

### 4.3 Bola, dribble & fisika
- Bola adalah **entitas fisik bebas** (tidak menempel di pemain): posisi (x, y) + tinggi z (untuk lob/cross), kecepatan, friksi permukaan, pantulan.
- Dribble: pemain "menyentuh" bola - bola didorong sedikit ke depan tiap beberapa langkah (touch spacing), jadi bisa direbut lawan di sela sentuhan. Sprint = touch lebih jauh (rawan direbut).
- Tidak pakai physics engine eksternal: cukup collision lingkaran (pemain-bola, pemain-pemain terpisah), friksi, dan parabola sederhana untuk bola udara. Deterministik penuh (§6.3).

### 4.4 Passing (inti game)
1. **Short pass (Space)** - operan tanah ke rekan di arah yang dipegang (assisted: sistem memilih rekan terbaik dalam kerucut arah input; kalau tidak ada, oper ke ruang). Power (tahan tombol) menentukan kecepatan/lead operan.
2. **Through ball (E)** - operan ke **ruang kosong** di belakang garis pertahanan, mengarah ke laju rekan yang berlari (lead pass), bukan ke posisi rekan sekarang.
3. **Long ball / cross (Q)** - lob dengan parabola z; dipakai untuk oper jauh dan umpan silang ke kotak penalti. Header/volley saat menerima disederhanakan jadi "kontak bola udara dengan akurasi menurun" (animasi header menyusul).
4. **One-two / wall pass** - pass + auto-run (v1.1, bukan MVP).
5. **Kualitas penerima**: first-touch dipengaruhi kecepatan bola + atribut pemain sederhana (passing/pace/stamina per pemain, range kecil antar pemain preset).

### 4.5 Bertahan & switching
- **Auto-switch**: saat lawan menguasai bola, kontrol otomatis pindah ke pemain terdekat bola (dengan cooldown biar tidak flicker). Manual: Tab untuk cycle.
- Pemain yang tidak dikontrol dikendalikan AI (menjaga posisi formasi, press, cover).
- **Tackle**: standing tackle (tombol press + dekat bola = coba merebut bola, sukses tergantung sudut & jarak). Slide tackle + sistem foul menyusul v1.1; MVP: tackle selalu "bersih" (arcade).
- Kiper otomatis (tidak bisa dikontrol): positioning di sumbu gawang, reflex save dengan radius reaksi, keluar menyongsong bola umpan silang sederhana.

### 4.6 Match flow & statistik
- Alur: Menu utama → pilih mode → pilih tim (8 tim preset: nama + warna + atribut ringan) & difficulty (Easy/Normal/Hard) → kickoff → half-time → full-time.
- Event: kickoff, gol (reset kickoff), bola keluar → **kick-in** (semua mode, penyederhanaan dari throw-in), corner & goal kick (11v11 & 5v5), offside (11v11, toggle).
- Jam match berjalan **real-time sesuai durasi yang dipilih** (bukan 45 menit sim).
- **Statistik full-time**: possession %, pass attempted/completed + akurasi %, **pass streak terpanjang** (stat unggulan karena ini game operan), shots, on-target, skor.
- Replay gol: disimpan via deterministic sim (fitur v1.1; arsitektur sudah mendukung, §6.3).

### 4.7 AI
- **Formasi preset**: 11v11 (4-3-3, 4-4-2, 3-5-2), 5v5 (1-2-1 futsal), 2v2 (duo). Tim pemain & AI sama-sama bisa ganti formasi di pause menu.
- Tiap pemain punya **anchor posisi** dari formasi; posisi target = anchor digeser elastis mengikuti posisi bola + fase (menyerang: melebar & naik; bertahan: memadat & turun; transisi: reaksi tertunda sesuai difficulty).
- Keputusan pemain AI pengguna bola: evaluasi opsi (operan aman, through, dribble, shoot) dengan skor berbasis risiko/ruang - dikalikan "error rate" sesuai difficulty.
- Bertahan: pemain terdekat press, kedua menutup jalur operan, garis belakang jaga garis (step up untuk offside trap saat 11v11).
- Kiper: state machine (positioning / dive / claim / distribute).

---

## 5. Visual & Audio

### Visual (2D, sesuai permintaan)
- Karakter: **sprite 2D top-down** (badan + jersey warna tim, arah hadap, animasi lari 4-8 frame atau rotasi), indikator **segitiga warna tim** di atas pemain aktif.
- Bola: sprite + **bayangan terpisah** yang mengecil saat bola di udara (kode z), rotasi/efek guling.
- Lapangan: garis-garis resmi per mode (lingkaran tengah, kotak penalti, titik penalti, area futsal quarter-circle), tekstur rumput halus (futsal: indoor court), variasi tint per mode.
- Stadium ringan di tepi lapangan + crowd block untuk 11v11 (kosmetik).
- MVP pakai **placeholder prosedural** (lingkaran jersey + arah) supaya gameplay bisa dikerjakan paralel; sprite sheet final menyusul (flat vector style, bukan pixel art - keputusan §11).
- Game feel: partikel kecil saat kick/tackle, trail bola saat operan cepat, screen shake tipis saat gol, flash HUD.

### Audio (v1.0 minimal, WebAudio)
- SFX: kick, whistle, crowd ambience loop, cheer saat gol (asset bebas lisensi / generated).

---

## 6. Stack Teknologi & Arsitektur

### 6.1 Keputusan stack (v1.0)

| Layer | Pilihan | Alasan |
|-------|---------|--------|
| Bahasa | **TypeScript (strict)** | Iterasi tuning gameplay itu 80% kerjaan di game ini; TS = loop tercepat |
| Build | **Vite** | Standar, cepat, output static - plug-and-play ke Vercel |
| Render | **PixiJS v8** (WebGL/WebGPU, fallback canvas) | Scene graph, sprite batching, filter - cocok untuk radar & banyak sprite; API TS-native |
| Sim/fisika/AI | **Custom, tanpa engine** | Bola + 22 pemain terlalu ringan buat engine fisika; kontrol penuh atas "rasa" passing |
| Test | **Vitest** untuk core sim (deterministik → mudah diuji) | |
| Audio | WebAudio (howler.js kalau perlu) | |
| Deploy | **Vercel static** (output `dist/`) | Sesuai keinginan: gampang di-manage, auto-deploy dari GitHub |

### 6.2 Bagaimana dengan Rust?
Rust **dipertimbangkan serius** dan jalurnya disiapkan, tapi **bukan untuk core v1.0**:

- **Kenapa TS dulu**: tantangan game ini bukan performa (22 pemain @ 60 Hz sangat ringan bahkan untuk JS), tapi **rasa main & AI** - butuh iterasi cepat tuning konstanta dan behavior. Rust/WASM menambah toolchain ganda (wasm-pack, binding, sourcemap) untuk gain yang tidak terasa pemain.
- **Jalur Rust tetap terbuka (by design)**: seluruh logika game hidup di modul `core/` yang **murni** - input → state → state, tanpa DOM/render (§6.3). Modul ini bisa di-port ke Rust → WASM kapan pun tanpa menyentuh render/UI, dengan contract yang sama.
- **Pemicu pindah ke Rust**: (a) mau rollback netcode untuk multiplayer online, (b) mau headless training/bot massal di server, (c) simulasi mau naik kompleksitas besar.
- **Alternatif full-Rust (Bevy → WASM)** dinilai dan ditunda: bundle lebih besar, pipeline aset & tuning lebih lambat, UI/DOM integration lebih canggung - keunggulan ECS/Bevy tidak dibutuhkan untuk top-down 2D dengan puluhan entitas.

### 6.3 Arsitektur inti: deterministic fixed-timestep

```
teamball/
  PRD.md
  src/
    core/        # SIMULASI MURNI - tanpa DOM, tanpa Pixi (portable ke Rust/WASM)
      state.ts       # struktur world-state (bisa di-serialize)
      physics.ts     # gerak, collision, bola z, friksi
      rules.ts       # kickoff, out, gol, offside, jam match
      ai/            # formasi, anchor, keputusan, kiper, difficulty
      actions.ts     # input → aksi (pass/through/lob/shoot/switch)
      constants.ts   # SEMUA tuning di satu tempat (kecepatan, power, radius, dsb.)
    engine/      # loop, fixed timestep accumulator, input abstraction (keyboard + Gamepad API)
    render/      # Pixi: field, players, ball, camera, radar/minimap, partikel
    ui/          # menu, HUD, scoreboard, stats, pause
    main.ts
```

- Simulasi jalan **fixed 60 Hz** dengan accumulator; render di rAF dengan **interpolasi** antar tick → halus di 60/120/144 Hz monitor.
- `step(state, inputs, dt) -> state` murni deterministik (random ber-seed, tanpa Date.now) → memungkinkan: **unit test gameplay**, **replay gol**, dan **rollback netcode** kalau nanti online.
- Snapshot state bisa diserialisasi → pause/resume, replay, dan debugging murah.

### 6.4 Performance budget
- 60 fps stabil desktop mid-range; frame sim < 2 ms.
- Initial bundle < 1 MB gz (tanpa audio), load & kickoff < 3 detik di koneksi 10 Mbps.
- Lighthouse Performance ≥ 90.

---

## 7. Deploy (Vercel)

- Repo GitHub → connect ke Vercel → framework preset **Vite** → output `dist/`.
- Static murni untuk v1.0 - tidak butuh server/function.
- Cache header immutable untuk `/assets/*`; SPA single-page (tanpa router) jadi tidak butuh rewrite khusus.
- Preview deployment otomatis per PR (gratis, built-in) - enak untuk playtest link sementara.
- Kalau nanti butuh backend ringan (leaderboard, telemetry): **Vercel Edge/Serverless Functions + Vercel KV** sudah cukup, tanpa pindah infra.

---

## 8. Roadmap

| Versi | Isi | Definition of Done |
|-------|-----|--------------------|
| **v0.1 - Walking skeleton** | Lapangan 11v11, 1 pemain gerak (WASD), dorong bola, oper ke rekan statis, kamera ikut bola, radar stub | Bisa jalan-jalan & oper di browser, 60 fps |
| **v0.2 - Bola & mode** | Passing ber-power + through + lob, shooting + gawang + kiper dasar, kickoff & restart, 3 mode + config ukuran lapangan, switching pemain | Match 11v11 vs AI dummy (berdiri) bisa gol & restart |
| **v0.3 - AI & match penuh** | AI formasi + press + keputusan, difficulty, offside toggle, jam & half, HUD lengkap + radar final, layar statistik | Match penuh vs AI Normal terasa "ada lawan" |
| **v0.4 - Feel & polish** | Sprite final + animasi, partikel/juice, SFX & crowd, gamepad mapping UI, settings (durasi, offside, sound), pause menu | Match enak dimainkan 3x berturut-turut |
| **v1.0 - Launch** | Bugfix, perf pass, deploy Vercel + domain, playtest eksternal | Live di Vercel, teman bisa main dari link |
| **v1.1** | One-two, slide tackle + foul sederhana, replay gol, rebind kontrol, toggle Bahasa Indonesia/EN, local 2-player (1 keyboard / keyboard+pad) | |
| **Post-1.0** | Multiplayer online (§10), mobile touch, editor tim, turnamen lokal | |

---

## 9. Risiko & Mitigasi

| Risiko | Mitigasi |
|--------|----------|
| "Rasa" passing ala PES susah dicapai | Semua tuning di `constants.ts` terpusat; playtest loop tiap versi; prioritas feel > fitur |
| AI terasa bodoh/tidak menyenangkan | Mulai dari anchor-formasi elastis (sederhana & efektif), tingkatkan bertahap; difficulty = error rate, bukan kecurangan fisik |
| Scope creep (multiplayer, mobile, liga) | Non-goals dipaku di §2; multiplayer hanya setelah 1.0 |
| Vercel ≠ server game real-time | By design: v1.0 full client-side; opsi online sudah dipetakan di §10 |

---

## 10. Catatan multiplayer (fase lanjutan, bukan v1.0)

Vercel (serverless) tidak menjalankan WebSocket server persisten untuk game real-time, jadi opsi online setelah 1.0:

1. **Local 2P dulu (v1.1, murah)** - 1 keyboard atau keyboard + gamepad, split kontrol tim. Zero infra.
2. **P2P WebRTC + rollback** (direkomendasikan untuk 1v1/lobby kecil) - deterministik core (§6.3) sudah siap untuk rollback; signaling via Vercel Edge Function (ringan, sesuai limit).
3. **PartyKit / Colyseus di host eksternal** - kalau mau room/lobby banyak pemain; front-end tetap di Vercel.

---

## 11. Keputusan terbuka (butuh kata final)

1. **Gaya art**: flat vector modern (rekomendasi) vs pixel art retro.
2. **Bahasa UI**: EN default + toggle ID (rekomendasi), atau ID saja.
3. **Stamina bar pemain** (sprint terbatas): masuk v0.4 atau dipotong demi kesederhanaan?
4. **Nama game**: "Teamball" tetap, atau cari nama lain sebelum 1.0?

---

*Dokumen ini living - update tiap fase. Baseline konstanta tuning (kecepatan pemain, power pass, radius AI) dikelola di `src/core/constants.ts` saat implementasi dimulai.*
