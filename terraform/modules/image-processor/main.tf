terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}
locals {
  name   = "${var.project}-${var.environment}"
  bucket = "${local.name}-images-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.region}"
  zones  = slice(data.aws_availability_zones.available.names, 0, 2)
  slots  = { a = 0, b = 1 }
  tags   = { Project = var.project, Environment = var.environment, ManagedBy = "Terraform" }
}
