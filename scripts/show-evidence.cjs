'use strict';
// Display a compact view of recorded real evidence for screenshots.
const fs = require('node:fs');
const path = require('node:path');
const env = process.argv[2];
const section = process.argv[3];
if (!['dev','qa','prod'].includes(env) || !['infrastructure','verification','monitoring','destroy'].includes(section)) throw new Error('Uso: node scripts/show-evidence.cjs dev|qa|prod infrastructure|verification|monitoring|destroy');
const directory = path.resolve(__dirname,'..','evidence',env);
const read = name => JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const config = read('deployment.json');
console.log(`EVIDENCIAS REALES ${env.toUpperCase()} | Cuenta ${config.account_id} | ${config.region}`);
if (section === 'infrastructure') {
  const a = read('aws-evidence.json');
  console.log(fs.readFileSync(path.join(directory,'apply.log'),'utf8').split('\n').find(x=>x.includes('Apply complete!')));
  console.log(`Consulta AWS: ${a.checkedAt}`);
  console.log(`API: ${config.api_url}`);
  if (a.apiRoutes) console.log(`Rutas: ${a.apiRoutes.Items.map(r=>r.RouteKey).join(', ')} | autodeploy=${a.apiStage.AutoDeploy}`);
  console.log(`S3: ${config.bucket} | versionado=${a.versioning.Status}`);
  console.log(`VPC: ${config.vpc_id} | ${a.vpc.Vpcs[0].CidrBlock}`);
  for (const s of a.subnets.Subnets) console.log(`Subred ${s.AvailabilityZone} ${s.CidrBlock} ${s.SubnetId}`);
  for (const n of a.natGateways.NatGateways) console.log(`NAT ${n.NatGatewayId} ${n.State}`);
  for (const e of a.endpoints.VpcEndpoints) console.log(`Endpoint ${e.VpcEndpointType} ${e.VpcEndpointId} ${e.State}`);
  for (const l of [a.uploadLambda,a.cropLambda]) console.log(`Lambda ${l.FunctionName}: ${l.State}, ${l.Runtime}, ${l.MemorySize} MB, ${l.Timeout} s`);
} else if (section === 'verification') {
  for (const mode of ['json','multipart','presigned','large']) {
    const r = read(`demo-${mode}.json`);
    console.log(`${mode}: passed=${r.passed} | HTTP=${r.status} | bytes=${r.inputBytes}`);
    console.log(`  ${r.output.format} ${r.output.width}x${r.output.height} | alfa esquina=${r.output.cornerAlpha} | ${r.checkedAt}`);
    console.log(`  salida: ${r.processedKey}`);
  }
} else if (section === 'monitoring') {
  const a=read('aws-evidence.json');
  const q=a.queue.Attributes;
  console.log(`SQS: visibility=${q.VisibilityTimeout} s; retention=${q.MessageRetentionPeriod} s; polling=${q.ReceiveMessageWaitTimeSeconds} s`);
  console.log(`Redrive: ${q.RedrivePolicy}`);
  console.log(`DLQ: retention=${a.dlq.Attributes.MessageRetentionPeriod} s; visible=${a.dlq.Attributes.ApproximateNumberOfMessages}`);
  const alarm=a.alarm.MetricAlarms[0];
  console.log(`Alarma: ${alarm.AlarmName} | estado=${alarm.StateValue}`);
  console.log(`Metrica: ${alarm.MetricName} > ${alarm.Threshold} | periodo=${alarm.Period} s`);
  console.log(`Accion SNS: ${alarm.AlarmActions.join(', ')}`);
  const events=a.logs[`/aws/lambda/${config.crop_function}`]?.events || [];
  console.log('CloudWatch: mensajes reales de procesamiento (hasta dos):');
  for (const e of events.filter(e=>e.message.includes('image_processed')).slice(0,2)) console.log(e.message.trim());
} else {
  const r=read('destroy-verification.json');
  console.log(fs.readFileSync(path.join(directory,'destroy.log'),'utf8').split('\n').find(x=>x.includes('Destroy complete!')));
  console.log(`Verificado: ${r.checkedAt} | estado Terraform vacio=${r.terraformStateEmpty}`);
  for (const [resource,result] of Object.entries(r.awsChecks)) console.log(`${resource}: ausente=${result.absent}${result.response ? ' ('+result.response+')' : ''}`);
  console.log(`Limpieza completa: passed=${r.passed}`);
}
