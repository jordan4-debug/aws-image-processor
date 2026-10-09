resource "aws_cloudwatch_log_group" "upload" {
  name              = "/aws/lambda/${local.name}-upload"
  retention_in_days = 14
  tags              = local.tags
}
resource "aws_cloudwatch_log_group" "crop" {
  name              = "/aws/lambda/${local.name}-crop"
  retention_in_days = 14
  tags              = local.tags
}
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = 14
  tags              = local.tags
}
resource "aws_lambda_function" "upload" {
  function_name    = "${local.name}-upload"
  role             = aws_iam_role.upload.arn
  runtime          = var.lambda_runtime
  handler          = "index.handler"
  architectures    = ["x86_64"]
  filename         = abspath("${path.module}/../../../.build/upload.zip")
  source_code_hash = filebase64sha256("${path.module}/../../../.build/upload.zip")
  memory_size      = 256
  timeout          = 30
  environment {
    variables = { S3_BUCKET = aws_s3_bucket.images.id, UPLOAD_PREFIX = "uploads/" }
  }
  vpc_config {
    subnet_ids         = [for subnet in aws_subnet.private : subnet.id]
    security_group_ids = [aws_security_group.upload.id]
  }
  depends_on = [aws_iam_role_policy_attachment.basic, aws_iam_role_policy_attachment.vpc, aws_iam_role_policy.upload, aws_cloudwatch_log_group.upload, aws_vpc_endpoint.s3, aws_vpc_security_group_egress_rule.s3]
  tags       = local.tags
}
resource "aws_lambda_function" "crop" {
  function_name    = "${local.name}-crop"
  role             = aws_iam_role.crop.arn
  runtime          = var.lambda_runtime
  handler          = "index.handler"
  architectures    = ["x86_64"]
  filename         = abspath("${path.module}/../../../.build/crop.zip")
  source_code_hash = filebase64sha256("${path.module}/../../../.build/crop.zip")
  memory_size      = 512
  timeout          = 60
  environment {
    variables = { S3_BUCKET = aws_s3_bucket.images.id, UPLOAD_PREFIX = "uploads/", PROCESSED_PREFIX = "processed/" }
  }
  vpc_config {
    subnet_ids         = [for subnet in aws_subnet.private : subnet.id]
    security_group_ids = [aws_security_group.crop.id]
  }
  depends_on = [aws_iam_role_policy_attachment.basic, aws_iam_role_policy_attachment.vpc, aws_iam_role_policy.crop, aws_cloudwatch_log_group.crop, aws_vpc_endpoint.s3, aws_vpc_security_group_egress_rule.s3]
  tags       = local.tags
}
resource "aws_lambda_event_source_mapping" "crop" {
  event_source_arn        = aws_sqs_queue.main.arn
  function_name           = aws_lambda_function.crop.arn
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]
  scaling_config { maximum_concurrency = 2 }
}
resource "aws_apigatewayv2_api" "upload" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = var.cors_origins
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 300
  }
  tags = local.tags
}
resource "aws_apigatewayv2_integration" "upload" {
  api_id                 = aws_apigatewayv2_api.upload.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.upload.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}
resource "aws_apigatewayv2_route" "upload" {
  api_id    = aws_apigatewayv2_api.upload.id
  route_key = "POST /upload"
  target    = "integrations/${aws_apigatewayv2_integration.upload.id}"
}
resource "aws_apigatewayv2_route" "presigned" {
  count     = var.enable_presigned_upload ? 1 : 0
  api_id    = aws_apigatewayv2_api.upload.id
  route_key = "POST /upload-url"
  target    = "integrations/${aws_apigatewayv2_integration.upload.id}"
}
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.upload.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_rate_limit  = 10000
    throttling_burst_limit = 5000
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format          = jsonencode({ requestId = "$context.requestId", sourceIp = "$context.identity.sourceIp", requestTime = "$context.requestTime", httpMethod = "$context.httpMethod", routeKey = "$context.routeKey", status = "$context.status", responseLength = "$context.responseLength", integrationError = "$context.integrationErrorMessage" })
  }
  tags = local.tags
}
resource "aws_lambda_permission" "api" {
  statement_id  = "AllowOnlyProjectApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.upload.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.upload.execution_arn}/*/POST/*"
}
resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
  tags = local.tags
}
resource "aws_sns_topic_subscription" "email" {
  count     = var.sns_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.sns_email
}
resource "aws_cloudwatch_metric_alarm" "dlq" {
  alarm_name          = "${local.name}-dlq-messages-alarm"
  alarm_description   = "Al menos un mensaje visible en la DLQ del procesador de imagenes"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  period              = 60
  statistic           = "Maximum"
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  alarm_actions       = [aws_sns_topic.alarms.arn]
  tags                = local.tags
}
