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
  results.awsChecks.alarm = { absent:true };
  // Use the authenticated AWS CLI for services not needed by the application SDK.
  function cli(arguments_, expectedErrors = []) {
    const response = spawnSync('aws', [...arguments_, '--region', region, '--output', 'json', '--no-cli-pager'], { encoding:'utf8' });
    if (response.error) throw response.error;
    if (response.status !== 0) {
      const code = response.stderr.match(/\(([^)]+)\) when calling/)?.[1];
      if (!expectedErrors.includes(code)) throw new Error(response.stderr.trim());
      return null;
    }
    return JSON.parse(response.stdout);
  }
  for (const functionName of [config.upload_function, config.crop_function]) {
    const role = cli(['iam','get-role','--role-name',`${functionName}-lambda-role`], ['NoSuchEntity']);
    if (role) throw new Error('Un rol Lambda del proyecto todavia existe.');
  }
  results.awsChecks.iamRoles = { absent:true };
  const apiId = new URL(config.api_url).hostname.split('.')[0];
  if (cli(['apigatewayv2','get-api','--api-id',apiId], ['NotFoundException'])) throw new Error('La API todavia existe.');
  results.awsChecks.api = { absent:true };
  if (cli(['sns','get-topic-attributes','--topic-arn',config.sns_topic_arn], ['NotFound'])) throw new Error('El topico SNS todavia existe.');
  results.awsChecks.snsTopic = { absent:true };
  for (const name of config.log_groups) {
    const response = cli(['logs','describe-log-groups','--log-group-name-prefix',name]);
    if (response.logGroups.some(group => group.logGroupName === name)) throw new Error('Un grupo de logs todavia existe.');
  }
  results.awsChecks.logGroups = { absent:true };
  const endpoints = cli(['ec2','describe-vpc-endpoints','--filters',`Name=vpc-id,Values=${config.vpc_id}`]);
  if (endpoints.VpcEndpoints.length) throw new Error('Quedan endpoints de la VPC.');
  results.awsChecks.endpoints = { absent:true };
  const nats = cli(['ec2','describe-nat-gateways','--filter',`Name=vpc-id,Values=${config.vpc_id}`]);
  if (nats.NatGateways.some(nat => nat.State !== 'deleted')) throw new Error('Un NAT Gateway no termino de eliminarse.');
  results.awsChecks.natGateways = { absent:true, retainedDeletedRecords:nats.NatGateways.length };
  const before = JSON.parse(fs.readFileSync(path.join(directory,'aws-evidence.json'),'utf8'));
  const allocations = before.natGateways.NatGateways.flatMap(nat => nat.NatGatewayAddresses.map(address => address.AllocationId)).filter(Boolean);
  for (const allocationId of allocations) {
    if (cli(['ec2','describe-addresses','--allocation-ids',allocationId], ['InvalidAllocationID.NotFound'])) throw new Error('Una IP publica del proyecto sigue asignada.');
  }
  results.awsChecks.publicIps = { absent:true, checkedAllocations:allocations.length };
  results.passed = true;
  fs.writeFileSync(path.join(directory,'destroy-verification.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
})().catch(error => { console.error(error); process.exitCode = 1; });
