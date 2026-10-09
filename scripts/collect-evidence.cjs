'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { S3Client, GetBucketVersioningCommand, GetBucketEncryptionCommand, GetPublicAccessBlockCommand, GetBucketLifecycleConfigurationCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { LambdaClient, GetFunctionConfigurationCommand, ListEventSourceMappingsCommand } = require('@aws-sdk/client-lambda');
const { CloudWatchClient, DescribeAlarmsCommand } = require('@aws-sdk/client-cloudwatch');
const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeNatGatewaysCommand, DescribeVpcEndpointsCommand, DescribeSecurityGroupsCommand } = require('@aws-sdk/client-ec2');
const environment = process.argv[2] || 'dev';
if (!['dev','qa','prod'].includes(environment)) throw new Error('Entorno invalido.');
const directory = path.resolve(__dirname, '..', 'evidence', environment);
const config = JSON.parse(fs.readFileSync(path.join(directory, 'deployment.json'), 'utf8'));
const region = config.region;
const s3 = new S3Client({region}); const sqs = new SQSClient({region}); const lambda = new LambdaClient({region}); const logs = new CloudWatchLogsClient({region}); const ec2 = new EC2Client({region});
function cli(arguments_) {
  const response = spawnSync('aws', [...arguments_, '--region', region, '--output', 'json', '--no-cli-pager'], { encoding:'utf8' });
  if (response.error) throw response.error;
  if (response.status !== 0) throw new Error(response.stderr.trim());
  return JSON.parse(response.stdout);
}
(async () => {
  const results = { checkedAt: new Date().toISOString(), environment, deployment: config };
  const checks = [
    ['identity', () => new STSClient({region}).send(new GetCallerIdentityCommand({}))],
    ['versioning', () => s3.send(new GetBucketVersioningCommand({Bucket:config.bucket}))],
    ['encryption', () => s3.send(new GetBucketEncryptionCommand({Bucket:config.bucket}))],
    ['privacy', () => s3.send(new GetPublicAccessBlockCommand({Bucket:config.bucket}))],
    ['lifecycle', () => s3.send(new GetBucketLifecycleConfigurationCommand({Bucket:config.bucket}))],
    ['objects', () => s3.send(new ListObjectsV2Command({Bucket:config.bucket}))],
    ['queue', () => sqs.send(new GetQueueAttributesCommand({QueueUrl:config.queue_url,AttributeNames:['All']}))],
    ['dlq', () => sqs.send(new GetQueueAttributesCommand({QueueUrl:config.dlq_url,AttributeNames:['All']}))],
    ['uploadLambda', () => lambda.send(new GetFunctionConfigurationCommand({FunctionName:config.upload_function}))],
    ['cropLambda', () => lambda.send(new GetFunctionConfigurationCommand({FunctionName:config.crop_function}))],
    ['trigger', () => lambda.send(new ListEventSourceMappingsCommand({FunctionName:config.crop_function}))],
    ['alarm', () => new CloudWatchClient({region}).send(new DescribeAlarmsCommand({AlarmNames:[config.alarm_name]}))],
    ['vpc', () => ec2.send(new DescribeVpcsCommand({VpcIds:[config.vpc_id]}))],
    ['subnets', () => ec2.send(new DescribeSubnetsCommand({Filters:[{Name:'vpc-id',Values:[config.vpc_id]}]}))],
    ['natGateways', () => ec2.send(new DescribeNatGatewaysCommand({NatGatewayIds:config.nat_gateway_ids}))],
    ['endpoints', () => ec2.send(new DescribeVpcEndpointsCommand({VpcEndpointIds:config.vpc_endpoints}))],
    ['securityGroups', () => ec2.send(new DescribeSecurityGroupsCommand({Filters:[{Name:'vpc-id',Values:[config.vpc_id]}]}))]
  ];
  for (const [name,run] of checks) results[name] = await run();
  const apiId = new URL(config.api_url).hostname.split('.')[0];
  results.api = cli(['apigatewayv2','get-api','--api-id',apiId]);
  results.apiRoutes = cli(['apigatewayv2','get-routes','--api-id',apiId]);
  results.apiStage = cli(['apigatewayv2','get-stage','--api-id',apiId,'--stage-name','$default']);
  results.apiIntegrations = cli(['apigatewayv2','get-integrations','--api-id',apiId]);
  results.bucketNotification = cli(['s3api','get-bucket-notification-configuration','--bucket',config.bucket]);
  results.sns = cli(['sns','get-topic-attributes','--topic-arn',config.sns_topic_arn]);
  results.uploadRolePolicy = cli(['iam','get-role-policy','--role-name',`${config.upload_function}-lambda-role`,'--policy-name','write-uploads-only']);
  results.cropRolePolicy = cli(['iam','get-role-policy','--role-name',`${config.crop_function}-lambda-role`,'--policy-name','read-upload-write-processed-consume-queue']);
  results.logConfiguration = [];
  for (const name of config.log_groups) results.logConfiguration.push(...cli(['logs','describe-log-groups','--log-group-name-prefix',name]).logGroups.filter(group => group.logGroupName === name));
  results.logs = {};
  for (const logGroupName of config.log_groups) {
    try { results.logs[logGroupName] = await logs.send(new FilterLogEventsCommand({ logGroupName, startTime: Date.now() - 3600000, limit: 100 })); }
    catch (error) { results.logs[logGroupName] = { error: error.name }; }
  }
  const clean = JSON.parse(JSON.stringify(results, (key,value) => key === '$metadata' ? undefined : value));
  fs.writeFileSync(path.join(directory,'aws-evidence.json'), JSON.stringify(clean,null,2));
  console.log(`Evidencia AWS guardada para ${environment}; cuenta ${clean.identity.Account}; ${clean.objects.KeyCount} objetos.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
