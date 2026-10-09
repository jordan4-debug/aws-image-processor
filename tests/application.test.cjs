'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('../src/crop/node_modules/sharp');
const upload = require('../src/upload/index.js');
const crop = require('../src/crop/index.js');
async function fixture() {
  return sharp({ create: { width: 180, height: 100, channels: 3, background: '#1565c0' } }).png().toBuffer();
}
function jsonEvent(body, rawPath = '/upload') { return { rawPath, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), isBase64Encoded: false }; }
test('JSON+base64 guarda una imagen valida y devuelve clave del resultado', async () => {
  const calls = []; const handler = upload.createHandler({ bucket: 'test', s3: { send: async command => calls.push(command.input) } });
  const result = await handler(jsonEvent({ contentType: 'image/png', base64: (await fixture()).toString('base64') }));
  assert.equal(result.statusCode, 202); assert.equal(calls.length, 1);
  assert.match(calls[0].Key, /^uploads\/.+\.png$/); assert.equal(calls[0].ServerSideEncryption, 'AES256');
  assert.match(JSON.parse(result.body).processedKey, /^processed\/.+_circular\.png$/);
});
test('multipart binario de API Gateway se decodifica y guarda', async () => {
  const image = await fixture(); const boundary = 'test-boundary';
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n`), image, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  let saved; const handler = upload.createHandler({ bucket: 'test', s3: { send: async c => { saved = c.input; } } });
  const result = await handler({ rawPath: '/upload', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: body.toString('base64'), isBase64Encoded: true });
  assert.equal(result.statusCode, 202); assert.deepEqual(saved.Body, image);
});
test('rechaza base64 incorrecto, tipos falsos y carga directa demasiado grande', async () => {
  const handler = upload.createHandler({ bucket: 'test', s3: { send: async () => { throw new Error('No debe escribir'); } } });
  assert.equal((await handler(jsonEvent({ contentType: 'image/png', base64: '???=' }))).statusCode, 400);
  assert.equal((await handler(jsonEvent({ contentType: 'image/jpeg', base64: (await fixture()).toString('base64') }))).statusCode, 415);
  assert.equal((await handler(jsonEvent({ contentType: 'image/png', base64: Buffer.alloc(upload.MAX_DIRECT_BYTES + 1).toString('base64') }))).statusCode, 413);
});
test('presigned POST limita tamano, tipo, clave y cifrado sin hacer publico el bucket', async () => {
  let options;
  const handler = upload.createHandler({ bucket: 'test', s3: {}, presign: async (_s3, config) => { options = config; return { url: 'https://test.s3.amazonaws.com', fields: { key: config.Key } }; } });
  const result = await handler(jsonEvent({ contentType: 'image/png', size: 10 * 1024 * 1024 }, '/upload-url'));
  assert.equal(result.statusCode, 200); assert.equal(options.Expires, 300);
  assert.deepEqual(options.Conditions[0], ['content-length-range',1,10485760]);
  assert.equal((await handler(jsonEvent({ contentType: 'image/png', size: 10485761 }, '/upload-url'))).statusCode, 400);
});
test('recorte real produce PNG 40x40 con alpha transparente en esquinas y centro opaco', async () => {
  const result = await crop.circularPng(await fixture());
  const meta = await sharp(result).metadata(); assert.equal(meta.format, 'png'); assert.equal(meta.width, 40); assert.equal(meta.height, 40); assert.equal(meta.hasAlpha, true);
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0); assert.equal(data[(20 * info.width + 20) * info.channels + 3], 255);
});
test('procesa JPG, GIF y WebP y rechaza SVG aunque sharp pueda abrirlo', async () => {
  for (const format of ['jpeg','gif','webp']) {
    const image = await sharp(await fixture()).toFormat(format).toBuffer();
    const output = await crop.circularPng(image); assert.equal((await sharp(output).metadata()).width, 40);
  }
  await assert.rejects(crop.circularPng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>')), /Formato/);
});
test('fallos parciales reintentan solo el mensaje incorrecto y aceptan evento de prueba S3', async () => {
  const image = await fixture(); const writes = [];
  const handler = crop.createHandler({ bucket: 'test', s3: { send: async c => {
    if (c.constructor.name === 'GetObjectCommand') return { ContentLength: image.length, Body: { transformToByteArray: async () => image } };
    writes.push(c.input); return {};
  } } });
  const result = await handler({ Records: [
    { messageId: 'good', body: JSON.stringify({ Records: [{ eventSource: 'aws:s3', eventName: 'ObjectCreated:Put', s3: { bucket: { name: 'test' }, object: { key: 'uploads/a%20b.png', size: image.length } } }] }) },
    { messageId: 'bad', body: 'not-json' },
    { messageId: 'test-event', body: JSON.stringify({ Event: 's3:TestEvent' }) }
  ] });
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: 'bad' }] });
  assert.equal(writes[0].Key, 'processed/a b_circular.png'); assert.equal(writes[0].ContentType, 'image/png');
});
test('evento de otro bucket o del prefijo processed no se procesa', async () => {
  const handler = crop.createHandler({ bucket: 'test', s3: { send: async () => { throw new Error('No debe acceder'); } } });
  const result = await handler({ Records: [{ messageId: 'bad-source', body: JSON.stringify({ Records: [{ eventSource: 'aws:s3', eventName: 'ObjectCreated:Put', s3: { bucket: { name: 'another' }, object: { key: 'uploads/x.png' } } }] }) }] });
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: 'bad-source' }]);
});
