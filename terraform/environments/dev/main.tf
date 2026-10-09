terraform {
  required_version = ">= 1.6.0, < 2.0.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "local" { path = "terraform.tfstate" }
}
provider "aws" {
  region = var.aws_region
}
variable "aws_region" { type = string }
variable "lambda_runtime" { type = string }
variable "force_destroy_test_bucket" { type = bool }
variable "sns_email" {
  type    = string
  default = ""
}
module "image_processor" {
  source                    = "../../modules/image-processor"
  environment               = "dev"
  lambda_runtime            = var.lambda_runtime
  force_destroy_test_bucket = var.force_destroy_test_bucket
  sns_email                 = var.sns_email
}
output "deployment" { value = module.image_processor.deployment }
