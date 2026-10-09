'use strict';
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CIRCLE = Buffer.from('<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="20" fill="white"/></svg>');
async function circularPng(buffer) {
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('Tamano de imagen no permitido.');
  const options = { animated: false, limitInputPixels: 40000000, failOn: 'error' };
  const metadata = await sharp(buffer, options).metadata();
  if (!['jpeg','png','gif','webp'].includes(metadata.format)) throw new Error('Formato de imagen no permitido.');
  return sharp(buffer, options).rotate().resize(40,40,{ fit: 'cover', position: 'centre' }).ensureAlpha()
    .composite([{ input: CIRCLE, blend: 'dest-in' }]).png().toBuffer();
}
function createHandler({ s3 = new S3Client({}), bucket = process.env.S3_BUCKET, uploadPrefix = process.env.UPLOAD_PREFIX || 'uploads/', processedPrefix = process.env.PROCESSED_PREFIX || 'processed/' } = {}) {
  return async event => {
    const batchItemFailures = [];
    for (const message of event.Records || []) {
      try {
        const notification = JSON.parse(message.body);
        if (notification.Event === 's3:TestEvent') continue;
        if (!Array.isArray(notification.Records) || !notification.Records.length) throw new Error('Mensaje sin evento S3.');
        for (const record of notification.Records) {
          if (record.eventSource !== 'aws:s3' || !record.eventName?.startsWith('ObjectCreated:')) throw new Error('Evento S3 no permitido.');
          const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
          if (record.s3.bucket.name !== bucket || !key.startsWith(uploadPrefix)) throw new Error('Bucket o prefijo fuera del alcance permitido.');
          if (record.s3.object.size > MAX_FILE_BYTES) throw new Error('Imagen supera 10 MiB.');
          const original = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          if (original.ContentLength > MAX_FILE_BYTES) throw new Error('Imagen supera 10 MiB.');
          const bytes = Buffer.from(await original.Body.transformToByteArray());
          const output = await circularPng(bytes);
          const processedKey = `${processedPrefix}${key.slice(uploadPrefix.length).replace(/\.[^.]+$/, '')}_circular.png`;
          await s3.send(new PutObjectCommand({ Bucket: bucket, Key: processedKey, Body: output, ContentType: 'image/png', ServerSideEncryption: 'AES256', Metadata: { 'source-key': key } }));
          console.log(JSON.stringify({ event: 'image_processed', sourceKey: key, processedKey, width: 40, height: 40, bytes: output.length }));
        }
      } catch (error) {
        console.error(JSON.stringify({ event: 'crop_error', messageId: message.messageId, error: error.message }));
        batchItemFailures.push({ itemIdentifier: message.messageId });
      }
    }
    return { batchItemFailures };
  };
}
exports.handler = createHandler();
exports.createHandler = createHandler;
exports.circularPng = circularPng;
