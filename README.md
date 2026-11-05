# OutsiderDrop

Kirim file (sampai ukuran GB) dan pesan langsung antarperangkat: Android, iPhone, Windows, Mac, Linux.
Murni lokal: semua perangkat di WiFi/hotspot yang sama, tanpa internet dan tanpa kuota.

## Cara pakai (satu jaringan, tanpa internet)
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

## Fitur
- Kirim file dan **folder** (isi subfolder ikut, struktur tetap) lewat drag & drop, tombol, atau tempel.
- Di perangkat lain (HP, Safari, Firefox) file masuk ditampung dulu lalu disimpan dengan tombol **Simpan**.

## Catatan
- File sangat besar (beberapa GB) ditampung sementara oleh browser penerima sebelum disimpan; pastikan ruang penyimpanan cukup. Chrome/Edge di laptop paling lancar untuk file GB.
- Riwayat pesan disimpan di perangkat masing-masing (bisa dihapus dengan tombol **Hapus riwayat**).
