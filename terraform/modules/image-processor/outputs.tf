output "deployment" {
  value = {
    environment     = var.environment
    project         = var.project
    region          = data.aws_region.current.region
    account_id      = data.aws_caller_identity.current.account_id
    bucket          = aws_s3_bucket.images.id
    api_url         = aws_apigatewayv2_api.upload.api_endpoint
    upload_url      = "${aws_apigatewayv2_api.upload.api_endpoint}/upload"
    presigned_url   = var.enable_presigned_upload ? "${aws_apigatewayv2_api.upload.api_endpoint}/upload-url" : null
    upload_function = aws_lambda_function.upload.function_name
    crop_function   = aws_lambda_function.crop.function_name
    queue_url       = aws_sqs_queue.main.id
    dlq_url         = aws_sqs_queue.dlq.id
    alarm_name      = aws_cloudwatch_metric_alarm.dlq.alarm_name
    sns_topic_arn   = aws_sns_topic.alarms.arn
    vpc_id          = aws_vpc.main.id
    private_subnets = [for subnet in aws_subnet.private : subnet.id]
    nat_gateway_ids = [for nat in aws_nat_gateway.main : nat.id]
    vpc_endpoints   = [aws_vpc_endpoint.s3.id, aws_vpc_endpoint.sqs.id]
    lambda_runtime  = var.lambda_runtime
    log_groups      = [aws_cloudwatch_log_group.upload.name, aws_cloudwatch_log_group.crop.name, aws_cloudwatch_log_group.api.name]
  }
}
