'use strict';
const fs = require('node:fs'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { LambdaClient, GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');
const { EC2Client, DescribeVpcsCommand } = require('@aws-sdk/client-ec2');
const { CloudWatchClient, DescribeAlarmsCommand } = require('@aws-sdk/client-cloudwatch');
const environment = process.argv[2] || 'dev';
if (!['dev','qa','prod'].includes(environment)) throw new Error('Entorno invalido.');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'evidence', environment);
const config = JSON.parse(fs.readFileSync(path.join(directory, 'deployment.json'), 'utf8'));
const region = config.region;
(async () => {
  const state = spawnSync('terraform', [`-chdir=${path.join(root,'terraform','environments',environment)}`, 'state', 'list'], { encoding:'utf8' });
  if (state.status !== 0 || state.stdout.trim()) throw new Error('No se pudo confirmar un estado Terraform vacio.');
  const results = { checkedAt: new Date().toISOString(), environment, terraformStateEmpty: true, awsChecks: {} };
  const s3 = new S3Client({region}); const sqs = new SQSClient({region}); const lambda = new LambdaClient({region});
  const checks = [
    ['bucket', () => s3.send(new HeadBucketCommand({Bucket:config.bucket})), error => error.$metadata?.httpStatusCode === 404],
    ['uploadLambda', () => lambda.send(new GetFunctionConfigurationCommand({FunctionName:config.upload_function})), error => error.name === 'ResourceNotFoundException'],
    ['cropLambda', () => lambda.send(new GetFunctionConfigurationCommand({FunctionName:config.crop_function})), error => error.name === 'ResourceNotFoundException'],
    ['queue', () => sqs.send(new GetQueueAttributesCommand({QueueUrl:config.queue_url,AttributeNames:['QueueArn']})), error => ['QueueDoesNotExist','AWS.SimpleQueueService.NonExistentQueue'].includes(error.name)],
    ['dlq', () => sqs.send(new GetQueueAttributesCommand({QueueUrl:config.dlq_url,AttributeNames:['QueueArn']})), error => ['QueueDoesNotExist','AWS.SimpleQueueService.NonExistentQueue'].includes(error.name)],
    ['vpc', () => new EC2Client({region}).send(new DescribeVpcsCommand({VpcIds:[config.vpc_id]})), error => error.name === 'InvalidVpcID.NotFound']
  ];
  for (const [name, run, expectedError] of checks) {
    try { await run(); throw new Error(`El recurso ${name} todavia existe.`); }
    catch (error) { if (!expectedError(error)) throw error; results.awsChecks[name] = { absent: true, response: error.name }; }
  }
  const alarm = await new CloudWatchClient({region}).send(new DescribeAlarmsCommand({AlarmNames:[config.alarm_name]}));
  if (alarm.MetricAlarms?.length) throw new Error('La alarma todavia existe.');
  results.awsChecks.alarm = { absent:true }; results.passed = true;
  fs.writeFileSync(path.join(directory,'destroy-verification.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
})().catch(error => { console.error(error); process.exitCode = 1; });
