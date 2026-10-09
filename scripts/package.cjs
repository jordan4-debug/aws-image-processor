'use strict';
const fs = require('node:fs'); const path = require('node:path'); const archiver = require('archiver');
const root = path.resolve(__dirname,'..');
const includeBuild = process.argv.includes('--cloudshell');
const target = path.resolve(root,'..',includeBuild ? 'image-processor-cloudshell.zip' : 'image-processor-source.zip');
(async () => {
  const output = fs.createWriteStream(target); const zip = archiver('zip',{zlib:{level:9}});
  const done = new Promise((resolve,reject) => { output.on('close',resolve); output.on('error',reject); zip.on('error',reject); });
  zip.pipe(output);
  zip.glob('**/*',{cwd:root,dot:true,ignore:['**/node_modules/**','**/.terraform/**','.build/**','.git/**','evidence/*/**','**/*.tfstate*','**/*.tfplan','**/*.plan.json','**/crash.log']});
  if (includeBuild) for (const name of ['upload','crop']) zip.file(path.join(root,'.build',`${name}.zip`),{name:`.build/${name}.zip`});
  await zip.finalize(); await done;
  console.log(`${target} (${zip.pointer()} bytes)`);
})().catch(error => {console.error(error);process.exitCode=1;});
