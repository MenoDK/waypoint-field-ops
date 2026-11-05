/* Indonesian overlay. Text only: the keys mirror the shape of content.js, and anything missing falls back to English. */
(window.SITE_I18N ||= {}).id = {
  title: 'waypoint-field-ops · backend armada untuk ponsel yang kehilangan sinyal',
  loading: {
    context: 'Operasi armada',
    title: 'Melacak lokasi armada',
    text: 'Membaca posisi terakhir, router jalan, dan jam.',
    foot: 'Demo lokal · ponsel simulasi di mesin ini',
  },
  lab: { cta: 'Masuk ke lab' },
  hero: {
    eyebrow: 'Operasi lapangan · tahan tanpa koneksi, jujur tentang apa yang diketahuinya',
    lead: 'Ketahui di mana setiap kendaraan berada',
    soft: 'dan seberapa yakin Anda.',
    text: 'Backend armada untuk ponsel yang melewati terowongan, mengirim posisi satu jam sekaligus, dan kadang jamnya salah. Bacaan diperiksa dan disimpan hanya sekali, ETA menyebutkan cara menghitungnya, keheningan memicu peringatan, dan antrean tidak pernah menaikkan orang lebih banyak daripada daya tampung kendaraan. Ponsel simulasi menjelajahi wilayah rekaan di laptop Anda.',
    primary: { label: 'Buka lab' },
    secondary: { label: 'Lihat cara kerjanya' },
    pilot: 'Berjalan di laptop Anda · ponsel dan router jalan adalah simulasi, tanpa akun',
    proof: [
      { a: 'Posisi disimpan sekali saja', b: 'sebanyak apa pun dikirim' },
      { a: 'Setiap jaminan punya tes', b: 'yang berusaha merusaknya' },
    ],
    top: ['WAYPOINT', 'Posisi yang bisa Anda pertanggungjawabkan.'],
    status: {
      small: 'Peringatan terakhir',
      strong: 'Tidak ada sinyal selama 4 mnt. Dibuka oleh worker, ditutup oleh posisi berikutnya.',
    },
  },
  principles: {
    lead: ['Dibuat untuk', 'zona tanpa sinyal.'],
    items: [
      [null, 'Simpan sekali'],
      [null, 'Sebut metodenya'],
      [null, 'Peringatan saat hening'],
      [null, 'Hitung orang'],
    ],
  },
  tour: {
    eyebrow: 'Tur seluruh sistem',
    title: ['Lima hal yang salah', 'di jalan.'],
    text: 'Pilih satu tab. Keluaran di bawah direkam dari aplikasi yang berjalan dengan data fiktif; sebuah tes gagal jika keluaran itu tidak lagi benar.',
    tag: 'Keluaran terekam',
    tabs: [
      {
        label: 'Ingest',
        title: 'Satu jam di terowongan tiba sebagai satu batch, dan disimpan sekali.',
        text: 'Satu bacaan tanpa fix GPS atau dengan jam yang salah ditolak sendiri; yang baik dalam batch yang sama tetap disimpan. Mengirim ulang batch tidak mengubah apa pun, dan bacaan lama tidak pernah menggerakkan kendaraan mundur.',
      },
      {
        label: 'Kedatangan',
        title: 'Tiba butuh dua fix yang baik, dan dicatat sekali.',
        text: 'Satu fix di dalam radius bisa saja goyangan GPS. Fix yang mengakui sendiri margin kesalahannya terlalu lebar untuk dihitung. Kedatangan dicap dengan pembaruan bersyarat, sehingga dua batch yang bersamaan tidak bisa sama-sama mengklaimnya.',
      },
      {
        label: 'Peringatan',
        title: 'Keheningan memicu peringatan. Satu posisi menutupnya.',
        text: 'Peringatan adalah keadaan, bukan peristiwa: indeks unik parsial hanya mengizinkan satu peringatan terbuka per kendaraan dan jenis, dan evaluator terjadwal merekonsiliasinya. Menjalankannya dua kali, atau di tiga worker, memberi jawaban yang sama.',
      },
      {
        label: 'Antrean',
        title: 'Unit tidak pernah menaikkan lebih banyak orang daripada muatannya.',
        text: 'Kapasitas menghitung orang. Satu aturan menentukan berapa orang yang boleh dipanggil, baik untuk “panggil lima berikutnya” maupun “panggil yang ini”, dan baris unit dikunci selama itu.',
      },
      {
        label: 'Batasan',
        title: 'Perjalanan armada lain tidak ada. Router yang buruk tidak dipercaya.',
        text: 'Semuanya dibatasi oleh armada di dalam token, sehingga id armada lain menjawab 404, bukan 403. Respons router yang bermusuhan ditolak dan ETA menyatakan bahwa ia kembali ke garis lurus.',
      },
    ],
    modulesTitle: 'Semua yang ada di dalam kotak.',
    modulesNote: 'Masing-masing punya berkas tes dan tempat di lab',
    modules: [
      [
        null,
        'Riwayat hanya-tambah',
        'Partisi harian, primary key berupa pengemudi dan waktu penangkapan, ON CONFLICT DO NOTHING, dan retensi dengan membuang partisi alih-alih menghapus baris.',
      ],
      [
        null,
        'Upsert posisi terbaru',
        'Penangkapan yang lebih baru menang, yang lebih lama tetap di riwayat tetapi tidak menggerakkan kendaraan, dan waktu terakhir ia benar-benar bergerak dicatat terpisah.',
      ],
      [
        null,
        'ETA dengan metode',
        'Jalan atau garis lurus, kecepatan terukur atau bawaan, dan jawabannya menyebutkan yang mana. Circuit breaker dan cache berada di depan router.',
      ],
      [
        null,
        'Peringatan sebagai keadaan',
        'Tanpa sinyal, berhenti lama, hampir tiba. Evaluator terjadwal merekonsiliasinya dengan fakta; indeks unik parsial menjaga satu yang terbuka untuk masing-masing.',
      ],
      [
        null,
        'Antrean sadar kapasitas',
        'Satu aturan penerimaan untuk kedua cara memanggil, FOR UPDATE pada unit, dan peringatan saat jumlah orang di atas melebihi batas.',
      ],
      [
        null,
        'Real-time lewat basis data',
        'pg_notify di dalam transaksi, koneksi LISTEN khusus yang tersambung ulang, dan room yang diambil dari token terverifikasi, tidak pernah dari pesan.',
      ],
    ],
    transparency: {
      strong: 'Jujur soal demonya.',
      text: 'Ponsel dan router jalan adalah program simulasi yang berbicara dengan API asli lewat HTTP; tidak ada yang di sini pernah dijalankan dengan perangkat nyata atau mesin routing sungguhan. Wilayahnya rekaan. Daftar keterbatasan di README lengkap.',
    },
  },
  challenges: {
    eyebrow: 'Bagian yang sulit',
    title: ['Ayo,', 'coba rusak.'],
    text: 'Ini tujuh hal yang mudah diklaim dan sulit dilakukan dengan benar. Masing-masing punya resep, apa yang seharusnya Anda lihat, dan tombol yang membuka lab tepat di tab itu.',
    items: [
      {
        label: 'Lewati terowongan',
        title: 'Putuskan satu ponsel dari jaringan, biarkan tetap berjalan, lalu kembalikan.',
        text: 'Ponsel kehilangan sinyal. Server tidak boleh kehilangan satu jam itu.',
      },
      {
        label: 'Kirim batch buruk',
        title: 'Campur bacaan baik dengan null island, jam dari masa depan, dan bacaan lama.',
        text: 'Satu bacaan buruk tidak boleh merugikan sisanya.',
      },
      {
        label: 'Berdiri di garis',
        title: 'Buat ponsel bergoyang di tepi tujuan.',
        text: 'Tiba adalah keputusan, bukan koordinat.',
      },
      {
        label: 'Diam',
        title: 'Putus sinyal ponsel dan tunggu peringatannya.',
        text: 'Tidak ada yang melaporkan bahwa ia berhenti melapor.',
      },
      {
        label: 'Overbook van',
        title: 'Panggil lebih banyak orang daripada muatan unit, dengan dua cara berbeda.',
        text: 'Aturan kapasitas yang hanya dipatuhi satu jalur bukanlah aturan.',
      },
      {
        label: 'Rusak router',
        title: 'Buat router jalan berbohong, macet, dan menghilang.',
        text: 'Ketergantungan yang bukan milik Anda adalah masukan, bukan fakta.',
      },
      {
        label: 'Intip armada lain',
        title: 'Minta satu armada untuk perjalanan, socket, dan lembar milik armada lain.',
        text: 'Isolasi yang diperiksa bisa terlupa. Isolasi struktural tidak.',
      },
    ],
  },
  run: {
    eyebrow: 'Jalankan dalam semenit',
    title: ['Satu perintah.', 'Satu armada di localhost.'],
    text: 'Anda butuh Docker. Tidak ada kunci API, tidak ada akun yang harus dibuat, dan tidak ada yang keluar dari mesin Anda.',
    steps: [
      [null, 'Klon', 'git clone, lalu masuk ke folder.'],
      [
        null,
        'Mulai',
        'make demo membangun image, memigrasi basis data, dan menjalankan API, worker, serta lapangan simulasi, dengan pemeriksaan kesehatan.',
      ],
      [
        null,
        'Buka',
        'http://localhost:8400 adalah halaman ini. Tekan “Masuk ke lab”: kendaraan sudah bergerak.',
      ],
      [null, 'Rusak', 'Gunakan bagian sulit di atas, atau jalankan make e2e untuk rangkaian tes browser.'],
    ],
  },
  under: {
    eyebrow: 'Di balik layar',
    title: ['Permukaan kecil,', 'tepian serius.'],
    text: 'Kode yang menarik sengaja dibuat pendek. Keputusan di baliknya ditulis bersama alternatif yang kalah.',
    stackTitle: 'Dibangun dengan apa',
    proofTitle: 'Apa yang diukur, dan catatan di baliknya',
    numbers: [
      [null, 'tes: 215 unit dan 151 terhadap PostGIS asli dengan aplikasi yang mendengarkan'],
      [null, 'aturan yang sengaja dirusak tertangkap oleh tes, tidak ada yang lolos'],
      [null, 'catatan keputusan, masing-masing dengan alternatif yang ditolak'],
      [null, 'galat di bawah tsc --strict'],
    ],
    decisions: [
      [
        'Periksa setiap bacaan, bukan permintaannya',
        'ADR 0002: mengapa satu koordinat buruk tidak boleh merugikan 299 lainnya.',
      ],
      [
        'Riwayat yang hanya bisa ditambah',
        'ADR 0003: partisi, penulisan idempoten, dan retensi tanpa DELETE.',
      ],
      ['Peringatan adalah keadaan', 'ADR 0004: mengapa rekonsiliator mengalahkan penangan peristiwa.'],
      ['Satu aturan penerimaan', 'ADR 0005: bagaimana kapasitas tetap benar saat panggilan bersamaan.'],
      ['ETA yang menyebut metodenya', 'ADR 0006: cadangan yang jujur dan router yang tidak dipercaya.'],
      ['Real-time lewat basis data', 'ADR 0007: pg_notify dalam transaksi dan room dari token.'],
      ['Lab yang tidak bisa mencapai produksi', 'ADR 0008: tiga lapis menjaga sakelar tetap di tempatnya.'],
      [
        'Perjalanan lewat tabel, tautan lewat tanda tangan',
        'ADR 0009: transisi compare-and-set dan tautan yang membawa izinnya sendiri.',
      ],
      [
        'Batasan lewat rancangan',
        'ADR 0010: armada dari token, tolak secara bawaan, peran basis data yang kecil.',
      ],
    ],
    measuredOn: 'Diukur pada 2026-11-05. Angka berasal dari perintah di README, bukan dari ingatan.',
    future: [
      ['Mesin routing sungguhan', 'di balik adapter terjaga yang sama, dengan data lalu lintasnya sendiri.'],
      ['Push untuk pengemudi', 'menggantikan polling, lewat room yang sama.'],
      ['Retensi per armada', 'karena berapa lama posisi boleh disimpan adalah ketentuan kontrak.'],
    ],
  },
  about: {
    why: 'Waypoint adalah sisi operasi lapangan dari pekerjaan saya: ponsel yang tidak bisa diandalkan untuk selalu daring, berjam benar, atau mengirim sesuatu hanya sekali, namun menyuplai layar tempat orang mengambil keputusan. Ide-idenya datang dari sistem yang pernah saya bangun dan operasikan; kode di repositori ini ditulis baru dan sudah diuji.',
  },
  faq: [
    [
      'Apakah ada pendaftaran sungguhan?',
      'Tidak, dengan sengaja. Demo ini punya dua armada rekaan, masing-masing dengan seorang dispatcher dan beberapa pengemudi; lab memasukkan Anda sebagai salah satu dari mereka. Login sungguhan (scrypt, pembatasan percobaan, JWT yang dipatok) ada di API dan sudah diuji.',
    ],
    [
      'Mengapa PostGIS dan bukan sekadar kolom lintang dan bujur?',
      'Jarak, radius, dan jejak adalah masalah geografi. PostGIS menanganinya dengan benar pada bola, mengindeksnya, dan menjaga pemeriksaan geofence di satu tempat.',
    ],
    [
      'Mengapa riwayat dipartisi per hari?',
      'Karena cara termurah untuk melupakan data pribadi sesuai jadwal adalah membuang sebuah partisi. Peran aplikasi bahkan tidak bisa DELETE dari riwayat; sebuah fungsi terkendali yang membuang partisi.',
    ],
    [
      'Bagaimana jika dua worker mengevaluasi peringatan bersamaan?',
      'Tidak ada yang rusak. Evaluator membandingkan fakta dengan peringatan yang terbuka dan indeks unik parsial mencegah duplikat, sehingga satu worker atau tiga memberi hasil yang sama.',
    ],
    [
      'Bisakah mode lab sampai ke produksi?',
      'Tidak. Konfigurasi menolak LAB_MODE dan kata sandi demo saat NODE_ENV adalah production, sebuah tes mengunci hal itu, dan rute lab menjawab 404 kecuali lab menyala, serta menolak Host yang bukan lokal.',
    ],
    [
      'Apakah sudah siap produksi?',
      'Dibangun dan diuji dengan standar itu: tipe ketat, tes dengan basis data asli, pemeriksaan mutasi. Belum pernah memikul lalu lintas nyata, dan apa yang kurang tercantum di keterbatasan README.',
    ],
  ],
  closing: {
    eyebrow: 'Giliran Anda',
    title: ['Coba buat server percaya', 'pada posisi yang seharusnya tidak ia percayai.'],
    button: 'Buka lab',
    fine: 'Hanya lokal · data fiktif · tidak ada yang dikirim ke mana pun',
  },
};
