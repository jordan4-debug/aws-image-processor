'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const archiver = require('archiver');
const root = path.resolve(__dirname, '..');
function npm(args, cwd) {
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const result = fs.existsSync(npmCli)
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`npm fallo en ${cwd}`);
}
function zip(source, destination) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject); archive.on('error', reject);
    archive.pipe(output); archive.directory(source, false); archive.finalize();
  });
}
(async () => {
  fs.mkdirSync(path.join(root, '.build'), { recursive: true });
  for (const name of ['upload','crop']) {
    const staging = path.join(root, '.build', `staging-${name}`);
    // No eliminaciones recursivas: las compilaciones actualizan solo esta carpeta conocida.
    fs.mkdirSync(staging, { recursive: true });
    for (const file of ['index.js','package.json','package-lock.json']) fs.copyFileSync(path.join(root, 'src', name, file), path.join(staging, file));
    npm(['ci','--omit=dev','--include=optional','--os=linux','--cpu=x64','--libc=glibc','--no-audit','--no-fund'], staging);
    if (name === 'crop') {
      for (const dependency of ['sharp-linux-x64','sharp-libvips-linux-x64']) {
        if (!fs.existsSync(path.join(staging, 'node_modules', '@img', dependency, 'package.json'))) throw new Error(`Falta binario Linux ${dependency}; revisar optionalDependencies del lockfile.`);
      }
    }
    const bytes = await zip(staging, path.join(root, '.build', `${name}.zip`));
    if (bytes > 50 * 1024 * 1024) throw new Error('Paquete excede 50 MiB de carga directa Lambda.');
    console.log(`${name}.zip: ${bytes} bytes (Linux x64/glibc)`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
