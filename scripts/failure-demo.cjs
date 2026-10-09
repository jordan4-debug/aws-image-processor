'use strict';
const fs = require('node:fs'); const path = require('node:path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const environment = process.argv[2] || 'dev';
if (!['dev','qa','prod'].includes(environment)) throw new Error('Entorno invalido.');
const directory = path.resolve(__dirname,'..','evidence',environment);
const config = JSON.parse(fs.readFileSync(path.join(directory,'deployment.json'),'utf8'));
(async () => {
  const key = `uploads/failure-demo-${Date.now()}.png`;
  await new S3Client({region:config.region}).send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:Buffer.from('Archivo de prueba intencionalmente invalido.'),ContentType:'image/png',ServerSideEncryption:'AES256'}));
  const report = { uploadedAt: new Date().toISOString(),environment,key,purpose:'Prueba controlada del flujo de errores. Esperar aproximadamente 18 minutos con visibility timeout de 360 s antes de verificar la DLQ y alarma.' };
  fs.writeFileSync(path.join(directory,'failure-injected.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(error => { console.error(error); process.exitCode = 1; });
