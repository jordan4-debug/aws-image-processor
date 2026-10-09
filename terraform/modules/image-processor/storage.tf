resource "aws_s3_bucket" "images" {
  bucket        = local.bucket
  force_destroy = var.force_destroy_test_bucket
  tags          = local.tags
}
resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "images" {
  bucket = aws_s3_bucket.images.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "images" {
  bucket = aws_s3_bucket.images.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "images" {
  bucket = aws_s3_bucket.images.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "tls" {
  bucket = aws_s3_bucket.images.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.images.arn, "${aws_s3_bucket.images.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
resource "aws_s3_bucket_lifecycle_configuration" "images" {
  bucket     = aws_s3_bucket.images.id
  depends_on = [aws_s3_bucket_versioning.images]
  rule {
    id     = "uploads-30-days"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = 30 }
    noncurrent_version_expiration { noncurrent_days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
  rule {
    id     = "processed-90-days"
    status = "Enabled"
    filter { prefix = "processed/" }
    expiration { days = 90 }
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
  rule {
    id     = "remove-expired-markers"
    status = "Enabled"
    filter {}
    expiration { expired_object_delete_marker = true }
  }
}
resource "aws_s3_bucket_cors_configuration" "images" {
  count  = var.enable_presigned_upload ? 1 : 0
  bucket = aws_s3_bucket.images.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST"]
    allowed_origins = var.cors_origins
    max_age_seconds = 300
  }
}
resource "aws_sqs_queue" "dlq" {
  name                      = "${local.name}-image-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}
resource "aws_sqs_queue" "main" {
  name                       = "${local.name}-image-queue"
  visibility_timeout_seconds = 360
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 3 })
  tags                       = local.tags
}
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url            = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = [aws_sqs_queue.main.arn] })
}
resource "aws_sqs_queue_policy" "s3_notification" {
  queue_url = aws_sqs_queue.main.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "AllowOnlyImagesBucket", Effect = "Allow", Principal = { Service = "s3.amazonaws.com" },
    Action    = "sqs:SendMessage", Resource = aws_sqs_queue.main.arn,
    Condition = { ArnEquals = { "aws:SourceArn" = aws_s3_bucket.images.arn }, StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
  }] })
}
resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.images.id
  queue {
    queue_arn     = aws_sqs_queue.main.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "uploads/"
  }
  depends_on = [aws_sqs_queue_policy.s3_notification, aws_lambda_event_source_mapping.crop]
}
