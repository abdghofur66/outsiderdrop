# OutsiderDrop

Kirim file (sampai ukuran GB) dan pesan langsung antarperangkat: Android, iPhone, Windows, Mac, Linux.
File mengalir langsung perangkat ke perangkat (WebRTC), tidak disimpan di server.

## Mode 1: Online (lintas jaringan, Cloudflare)
Butuh akun Cloudflare (gratis) dan Node.js di laptop.

```
npm install -g wrangler
wrangler login
wrangler deploy
```
Hasilnya alamat seperti `https://outsiderdrop.<akun>.workers.dev`.
Bisa dipasang ke subdomain, misalnya `drop.outsiderdev.com` (Workers > Settings > Domains & Routes).

Cara pakai: buka di dua perangkat, satu pilih **Buat ruang baru**, yang lain masukkan kode atau pindai QR dari tombol **Undang**.

## Mode 2: Lokal / satu jaringan (tanpa internet) — UTAMA
Satu perangkat jadi **host**, sisanya cukup **klien lewat browser** (tanpa pasang apa pun):
pindai QR dari host atau buka alamatnya, misal `http://192.168.43.1:8080`.

### Semua kombinasi langsung (satu lompatan)
Aplikasi laptop (exe/Mac/Linux) dan APK Android sama-sama punya pilihan **Jadi Host** atau **Gabung**.
Host otomatis terlihat di daftar "Gabung" perangkat lain (pencarian di jaringan lokal), tanpa ketik alamat.
Kiriman ke perangkat yang memakai aplikasi (APK / exe / Mac / Linux) langsung ke perangkat itu, tidak lewat host.
Hanya penerima yang memakai browser biasa (mis. iPhone) yang menerima lewat host.

### Host di laptop (tanpa pasang Node.js)
- Windows: klik dua kali `outsiderdrop.exe`. Saat Windows Firewall bertanya, pilih **Izinkan** (jaringan privat).
- Mac: `outsiderdrop-macos-arm64` (M1/M2/M3) atau `-x64` (Intel). Pertama kali, buka Terminal:
  `chmod +x outsiderdrop-macos-arm64 && codesign --sign - outsiderdrop-macos-arm64 && ./outsiderdrop-macos-arm64`
- Linux: `chmod +x outsiderdrop-linux-x64 && ./outsiderdrop-linux-x64`

Jendela akan menampilkan QR + alamat, dan browser host terbuka otomatis.
File yang diterima **browser di laptop host** langsung ditulis ke folder `OutsiderDrop` di dalam folder **Downloads Windows yang sebenarnya**
(ikut bila Downloads sudah dipindah ke drive lain). Tombol **Ganti folder** di aplikasi untuk memilih folder lain; pilihan disimpan di `~/.outsiderdrop.json`.
Punya Node.js? Bisa juga `node server-lokal.js`.

### Host / klien di HP Android (APK)
Buka aplikasi OutsiderDrop:
- **Mulai sebagai Host**: nyalakan hotspot (data boleh mati) atau sambung WiFi, lalu perangkat lain pindai QR dari tombol **Undang**.
- **Gabung**: pindai QR host atau ketik alamatnya.
File masuk di aplikasi langsung tersimpan ke `Download/OutsiderDrop`.

Kode Android ada di folder `android/`. APK dan file host laptop dibuat otomatis oleh GitHub Actions
(`.github/workflows/android.yml`) setiap push ke branch `main`, hasilnya muncul di menu **Releases** repo.

### Host Android tanpa APK (Termux)
```
pkg install nodejs
cd ~/outsiderdrop && node server-lokal.js
```

## Server TURN (agar beda jaringan selalu tersambung)
Tanpa TURN, sebagian kecil jaringan (seluler/kantor yang ketat) bisa gagal tersambung langsung.
1. Dashboard Cloudflare > **Realtime** > **TURN Server** > buat TURN key.
2. Simpan sebagai secret:
```
wrangler secret put TURN_KEY_ID
wrangler secret put TURN_KEY_API_TOKEN
```
3. `wrangler deploy` ulang. Aplikasi otomatis memakai TURN hanya bila sambungan langsung tidak bisa.
Kuota gratis Cloudflare TURN 1.000 GB/bulan (cek ketentuan terbaru di dashboard).

## Fitur
- Kirim file dan **folder** (isi subfolder ikut, struktur tetap) lewat drag & drop, tombol, atau tempel.
- **Simpan langsung ke folder** (Chrome/Edge di laptop, mode online/HTTPS atau localhost): pilih folder sekali, file masuk ditulis langsung ke disk. Ini cara paling aman untuk file GB.
- Di perangkat lain (HP, Safari, Firefox) file masuk ditampung dulu lalu disimpan dengan tombol **Simpan**.

## Catatan
- File sangat besar (beberapa GB) ditampung sementara oleh browser penerima sebelum disimpan; pastikan ruang penyimpanan cukup. Chrome/Edge di laptop paling lancar untuk file GB.
- Riwayat pesan disimpan di perangkat masing-masing (bisa dihapus dengan tombol **Hapus riwayat**).
- Jika dua perangkat beda jaringan gagal tersambung (jaringan kantor/seluler ketat), perlu server TURN (lihat saran).
