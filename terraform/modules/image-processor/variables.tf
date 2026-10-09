variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "qa", "prod"], var.environment)
    error_message = "environment debe ser dev, qa o prod."
  }
}
variable "project" {
  type    = string
  default = "image-processor"
}
variable "lambda_runtime" {
  type    = string
  default = "nodejs20.x"
  validation {
    condition     = contains(["nodejs20.x", "nodejs22.x", "nodejs24.x"], var.lambda_runtime)
    error_message = "Runtime permitido: nodejs20.x, nodejs22.x o nodejs24.x."
  }
}
variable "enable_presigned_upload" {
  type    = bool
  default = true
}
variable "force_destroy_test_bucket" {
  type    = bool
  default = false
}
variable "sns_email" {
  type    = string
  default = ""
}
variable "cors_origins" {
  type    = list(string)
  default = ["*"]
}
