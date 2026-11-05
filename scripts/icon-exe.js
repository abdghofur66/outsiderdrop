// Tempel ikon + info versi OutsiderDev ke base Node Windows sebelum dikemas pkg.
// pkg memakai berkas "built-*" tanpa cek hash, jadi base yang sudah diberi ikon disimpan dengan nama itu.
const { need } = require('@yao-pkg/pkg-fetch');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
(async () => {
  const fetched = await need({ nodeRange: 'node22', platform: 'win', arch: 'x64' });
  const built = path.join(path.dirname(fetched), path.basename(fetched).replace(/^fetched-/, 'built-'));
  const ver = process.env.APP_VERSION || '1.0.0';
  execFileSync(process.execPath, [path.join(__dirname, '..', 'node_modules', 'resedit-cli', 'dist', 'cli.js'),
    '--in', fetched, '--out', built, '--ignore-signed',
    '--icon', '1,' + path.join(__dirname, '..', 'build', 'icon.ico'),
    '--product-name', 'OutsiderDrop', '--company-name', 'OutsiderDev',
    '--file-description', 'OutsiderDrop - kirim file & pesan tanpa internet',
    '--original-filename', 'outsiderdrop.exe',
    '--file-version', ver + '.0', '--product-version', ver + '.0'], { stdio: 'inherit' });
  fs.unlinkSync(fetched);
  console.log('Ikon OutsiderDev ditempel ke', path.basename(built));
})().catch(e => { console.error(e); process.exit(1); });
