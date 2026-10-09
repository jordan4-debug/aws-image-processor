'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('../src/crop/node_modules/sharp');
const environment = process.argv[2] || 'dev';
const mode = process.argv[3] || 'json';
if (!['dev','qa','prod'].includes(environment) || !['json','multipart','presigned','large'].includes(mode)) throw new Error('Uso: node scripts/demo.cjs dev|qa|prod json|multipart|presigned|large');
const directory = path.resolve(__dirname, '..', 'evidence', environment);
const deployment = JSON.parse(fs.readFileSync(path.join(directory, 'deployment.json'), 'utf8'));
const s3 = new S3Client({ region: deployment.region });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function padPng(image, bytes) {
  // Chunk ancillary tEXt valido antes de IEND: PNG real de exactamente 10 MiB.
  const data = Buffer.alloc(bytes - image.length - 12, 65);
  Buffer.from('Comment\0').copy(data);
  const typeAndData = Buffer.concat([Buffer.from('tEXt'), data]);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([image.subarray(0, -12), header, typeAndData, checksum, image.subarray(-12)]);
}
(async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#1565c0"/><circle cx="160" cy="90" r="60" fill="#ffb300"/><circle cx="145" cy="80" r="8" fill="#17324d"/><circle cx="175" cy="80" r="8" fill="#17324d"/><path d="M135 105 Q160 130 185 105" fill="none" stroke="#17324d" stroke-width="8"/></svg>');
  let image = await sharp(svg).png().toBuffer();
  if (mode === 'large') image = padPng(image, 10 * 1024 * 1024);
  const filename = `${mode}-original.png`;
  fs.writeFileSync(path.join(directory, filename), image);
  let response;
  if (mode === 'json') response = await fetch(deployment.upload_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename, contentType: 'image/png', base64: image.toString('base64') }) });
  else if (mode === 'multipart') {
    const form = new FormData(); form.append('file', new Blob([image], { type: 'image/png' }), filename);
    response = await fetch(deployment.upload_url, { method: 'POST', body: form });
  } else {
    const signedResponse = await fetch(deployment.presigned_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename, contentType: 'image/png', size: image.length }) });
    if (!signedResponse.ok) throw new Error(`Presign HTTP ${signedResponse.status}: ${await signedResponse.text()}`);
    const signed = await signedResponse.json(); const form = new FormData();
    for (const [name,value] of Object.entries(signed.fields)) form.append(name, value);
    form.append('file', new Blob([image], { type: 'image/png' }), filename);
    const s3Response = await fetch(signed.url, { method: 'POST', body: form });
    if (!s3Response.ok) throw new Error(`S3 HTTP ${s3Response.status}: ${await s3Response.text()}`);
    response = { ok: true, status: s3Response.status, json: async () => ({ key: signed.key, processedKey: signed.processedKey }) };
  }
  if (!response.ok) throw new Error(`Upload HTTP ${response.status}: ${await response.text()}`);
  const accepted = await response.json();
  let result;
  for (let attempt = 0; attempt < 90; attempt++) {
    try { result = await s3.send(new GetObjectCommand({ Bucket: deployment.bucket, Key: accepted.processedKey })); break; }
    catch (error) { if (!['NoSuchKey','NotFound'].includes(error.name)) throw error; await sleep(2000); }
  }
  if (!result) throw new Error('No se encontro el resultado despues de 180 segundos.');
  const png = Buffer.from(await result.Body.transformToByteArray());
  const metadata = await sharp(png).metadata();
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 40); assert.equal(metadata.height, 40); assert.equal(metadata.hasAlpha, true); assert.equal(data[3], 0);
  assert.equal(data[(20 * info.width + 20) * info.channels + 3], 255);
  fs.writeFileSync(path.join(directory, `${mode}-processed.png`), png);
  const report = { checkedAt: new Date().toISOString(), environment, region: deployment.region, accountId: deployment.account_id, mode, inputBytes: image.length, status: response.status, ...accepted, output: { format: metadata.format, width: metadata.width, height: metadata.height, alpha: true, cornerAlpha: data[3] }, passed: true };
  fs.writeFileSync(path.join(directory, `demo-${mode}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
