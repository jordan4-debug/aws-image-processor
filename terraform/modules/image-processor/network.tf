resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = "${local.name}-vpc" })
}
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name}-igw" })
}
resource "aws_subnet" "public" {
  for_each          = local.slots
  vpc_id            = aws_vpc.main.id
  availability_zone = local.zones[each.value]
  cidr_block        = cidrsubnet("10.0.0.0/16", 8, each.value + 1)
  tags              = merge(local.tags, { Name = "${local.name}-public-${each.key}" })
}
resource "aws_subnet" "private" {
  for_each          = local.slots
  vpc_id            = aws_vpc.main.id
  availability_zone = local.zones[each.value]
  cidr_block        = cidrsubnet("10.0.0.0/16", 8, each.value + 11)
  tags              = merge(local.tags, { Name = "${local.name}-private-${each.key}" })
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name}-public" })
}
resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}
resource "aws_route_table_association" "public" {
  for_each       = local.slots
  subnet_id      = aws_subnet.public[each.key].id
  route_table_id = aws_route_table.public.id
}
resource "aws_eip" "nat" {
  for_each = local.slots
  domain   = "vpc"
  tags     = merge(local.tags, { Name = "${local.name}-nat-${each.key}" })
}
resource "aws_nat_gateway" "main" {
  for_each      = local.slots
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id
  depends_on    = [aws_internet_gateway.main]
  tags          = merge(local.tags, { Name = "${local.name}-nat-${each.key}" })
}
resource "aws_route_table" "private" {
  for_each = local.slots
  vpc_id   = aws_vpc.main.id
  tags     = merge(local.tags, { Name = "${local.name}-private-${each.key}" })
}
resource "aws_route" "private_internet" {
  for_each               = local.slots
  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[each.key].id
}
resource "aws_route_table_association" "private" {
  for_each       = local.slots
  subnet_id      = aws_subnet.private[each.key].id
  route_table_id = aws_route_table.private[each.key].id
}
resource "aws_security_group" "upload" {
  name        = "${local.name}-sg-upload-lambda"
  description = "Sin ingreso; HTTPS solo a S3 y endpoint SQS"
  vpc_id      = aws_vpc.main.id
  tags        = local.tags
  # Lambda needs its execution role until the ENIs using this group are removed.
  depends_on = [aws_iam_role_policy_attachment.vpc]
}
resource "aws_security_group" "crop" {
  name        = "${local.name}-sg-crop-lambda"
  description = "Sin ingreso; HTTPS solo a S3 y endpoint SQS"
  vpc_id      = aws_vpc.main.id
  tags        = local.tags
  depends_on  = [aws_iam_role_policy_attachment.vpc]
}
resource "aws_security_group" "sqs_endpoint" {
  name        = "${local.name}-sg-vpce-sqs"
  description = "HTTPS desde las dos funciones Lambda"
  vpc_id      = aws_vpc.main.id
  tags        = local.tags
}
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for rt in aws_route_table.private : rt.id]
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow", Principal = "*", Action = ["s3:GetObject", "s3:PutObject"],
    Resource = ["${aws_s3_bucket.images.arn}/uploads/*", "${aws_s3_bucket.images.arn}/processed/*"]
  }] })
  tags = merge(local.tags, { Name = "${local.name}-s3" })
}
resource "aws_vpc_endpoint" "sqs" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.sqs"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [for subnet in aws_subnet.private : subnet.id]
  security_group_ids  = [aws_security_group.sqs_endpoint.id]
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = "*", Resource = aws_sqs_queue.main.arn,
    Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"]
  }] })
  tags = merge(local.tags, { Name = "${local.name}-sqs" })
}
resource "aws_vpc_security_group_egress_rule" "s3" {
  for_each          = { upload = aws_security_group.upload.id, crop = aws_security_group.crop.id }
  security_group_id = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
}
resource "aws_vpc_security_group_egress_rule" "sqs" {
  for_each                     = { upload = aws_security_group.upload.id, crop = aws_security_group.crop.id }
  security_group_id            = each.value
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = aws_security_group.sqs_endpoint.id
}
resource "aws_vpc_security_group_ingress_rule" "sqs" {
  for_each                     = { upload = aws_security_group.upload.id, crop = aws_security_group.crop.id }
  security_group_id            = aws_security_group.sqs_endpoint.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = each.value
}
