locals {
  lambda_trust = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role" "upload" {
  name               = "${local.name}-upload-lambda-role"
  assume_role_policy = local.lambda_trust
  tags               = local.tags
}
resource "aws_iam_role" "crop" {
  name               = "${local.name}-crop-lambda-role"
  assume_role_policy = local.lambda_trust
  tags               = local.tags
}
resource "aws_iam_role_policy_attachment" "basic" {
  for_each   = { upload = aws_iam_role.upload.name, crop = aws_iam_role.crop.name }
  role       = each.value
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_iam_role_policy_attachment" "vpc" {
  for_each   = { upload = aws_iam_role.upload.name, crop = aws_iam_role.crop.name }
  role       = each.value
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}
resource "aws_iam_role_policy" "upload" {
  name = "write-uploads-only"
  role = aws_iam_role.upload.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.images.arn}/uploads/*"
  }] })
}
resource "aws_iam_role_policy" "crop" {
  name = "read-upload-write-processed-consume-queue"
  role = aws_iam_role.crop.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.images.arn}/uploads/*" },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.images.arn}/processed/*" },
    { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"], Resource = aws_sqs_queue.main.arn }
  ] })
}
