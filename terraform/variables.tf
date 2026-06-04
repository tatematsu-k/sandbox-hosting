variable "project" {
  description = "Resource name prefix"
  type        = string
  default     = "sandbox-hosting"
}

variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "public_base_url" {
  description = "Public origin viewers will use (e.g. https://sandbox.example.com). May be the CloudFront default domain after first apply."
  type        = string
  default     = ""
}

variable "allowed_ips" {
  description = "List of CIDRs or single IPs (IPv4/IPv6) allowed to view published content."
  type        = list(string)
  default     = []
}

variable "log_retention_days" {
  description = "CloudWatch Log Group retention for Lambda functions"
  type        = number
  default     = 30
}

variable "lambda_memory" {
  description = "Lambda function memory (MB)"
  type        = number
  default     = 512
}

variable "lambda_timeout_seconds" {
  description = "Lambda function timeout"
  type        = number
  default     = 30
}

variable "cron_schedule_expression" {
  description = "EventBridge schedule for the TTL cron (UTC)"
  type        = string
  default     = "cron(0 3 * * ? *)"
}

variable "alarm_email" {
  description = "Optional email subscribed to error alarms. Leave empty to skip SNS topic."
  type        = string
  default     = ""
}
