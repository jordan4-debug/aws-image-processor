'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const busboy = require('busboy');
const { v4: uuid } = require('uuid');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DIRECT_BYTES = 4 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function sniff(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString())) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null;
}
function validateType(type) {
  if (!TYPES[type]) throw new HttpError(415, 'Formato permitido: jpg, png, gif o webp.');
}
function validateFile(file) {
  validateType(file.contentType);
  if (!file.buffer.length) throw new HttpError(400, 'La imagen esta vacia.');
  if (file.buffer.length > MAX_DIRECT_BYTES) throw new HttpError(413, 'Carga directa: maximo 4 MiB. Para hasta 10 MiB utiliza POST /upload-url.');
  if (sniff(file.buffer) !== file.contentType) throw new HttpError(415, 'El contenido no coincide con el tipo de imagen declarado.');
  return file;
}
function jsonBody(event) {
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '');
  } catch { throw new HttpError(400, 'JSON invalido.'); }
}
function parseMultipart(event, headers) {
  return new Promise((resolve, reject) => {
    let parser;
    try { parser = busboy({ headers, limits: { fileSize: MAX_DIRECT_BYTES, files: 1, fields: 5, parts: 6 } }); }
    catch { return reject(new HttpError(400, 'multipart/form-data invalido o sin boundary.')); }
    let file; let failure;
    parser.on('file', (name, stream, info) => {
      const chunks = [];
      if (name !== 'file') failure = new HttpError(400, 'El campo del archivo debe llamarse file.');
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('limit', () => { failure = new HttpError(413, 'Carga directa: maximo 4 MiB. Utiliza POST /upload-url.'); });
      stream.on('error', reject);
      stream.on('end', () => { file = { buffer: Buffer.concat(chunks), contentType: info.mimeType, filename: info.filename }; });
    });
    for (const eventName of ['filesLimit', 'fieldsLimit', 'partsLimit']) parser.on(eventName, () => { failure = new HttpError(400, 'Envie un solo archivo.'); });
    parser.on('error', () => reject(new HttpError(400, 'Carga multipart incompleta.')));
    parser.on('close', () => failure ? reject(failure) : file ? resolve(file) : reject(new HttpError(400, 'Falta el archivo file.')));
    parser.end(Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8'));
  });
}
function createHandler({ s3 = new S3Client({}), presign = createPresignedPost, bucket = process.env.S3_BUCKET, prefix = process.env.UPLOAD_PREFIX || 'uploads/' } = {}) {
  return async event => {
    const reply = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      if (!bucket) throw new Error('S3_BUCKET no configurado.');
      const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(), v]));
      const route = event.rawPath || event.requestContext?.http?.path || '/upload';
      let file; let contentType;
      if (route === '/upload-url') {
        const request = jsonBody(event);
        contentType = request.contentType;
        validateType(contentType);
        if (!Number.isInteger(request.size) || request.size <= 0 || request.size > MAX_FILE_BYTES) throw new HttpError(400, 'size debe ser un entero entre 1 y 10485760 bytes.');
        const key = `${prefix}${uuid()}.${TYPES[contentType]}`;
        const signed = await presign(s3, { Bucket: bucket, Key: key, Expires: 300,
          Fields: { 'Content-Type': contentType, 'x-amz-server-side-encryption': 'AES256' },
          Conditions: [['content-length-range', 1, MAX_FILE_BYTES], ['eq', '$Content-Type', contentType], ['eq', '$x-amz-server-side-encryption', 'AES256']] });
        return reply(200, { ...signed, key, processedKey: `processed/${key.slice(prefix.length).replace(/\.[^.]+$/, '')}_circular.png`, expiresIn: 300, maxBytes: MAX_FILE_BYTES });
      }
      if (route !== '/upload') throw new HttpError(404, 'Ruta no encontrada.');
      if ((headers['content-type'] || '').startsWith('multipart/form-data')) file = await parseMultipart(event, headers);
      else if ((headers['content-type'] || '').startsWith('application/json')) {
        const request = jsonBody(event);
        if (typeof request.base64 !== 'string' || !request.base64.length || request.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.base64)) throw new HttpError(400, 'base64 invalido; use base64 puro, sin data URL.');
        file = { buffer: Buffer.from(request.base64, 'base64'), contentType: request.contentType, filename: request.filename };
      } else throw new HttpError(415, 'Use multipart/form-data o application/json.');
      validateFile(file);
      const key = `${prefix}${uuid()}.${TYPES[file.contentType]}`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.buffer, ContentType: file.contentType, ServerSideEncryption: 'AES256' }));
      console.log(JSON.stringify({ event: 'upload_saved', key, bytes: file.buffer.length }));
      return reply(202, { message: 'Imagen recibida; procesamiento asincrono.', key, processedKey: `processed/${key.slice(prefix.length).replace(/\.[^.]+$/, '')}_circular.png` });
    } catch (error) {
      console.error(JSON.stringify({ event: 'upload_error', error: error.message }));
      return reply(error.status || 500, { error: error.status ? error.message : 'Error interno al recibir la imagen.' });
    }
  };
}
exports.handler = createHandler();
exports.createHandler = createHandler;
exports.sniff = sniff;
exports.MAX_DIRECT_BYTES = MAX_DIRECT_BYTES;
exports.MAX_FILE_BYTES = MAX_FILE_BYTES;
