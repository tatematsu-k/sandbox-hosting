locals {
  name = var.project

  ssm_prefix = "/${var.project}"

  # Render IP allowlist into a CloudFront Function-safe JS literal.
  allowed_rules_js = jsonencode([
    for entry in var.allowed_ips :
    contains(split("", entry), "/") ? {
      addr   = split("/", entry)[0]
      prefix = tonumber(split("/", entry)[1])
      } : {
      addr   = entry
      prefix = null
    }
  ])

  viewer_request_source = replace(
    file("${path.module}/../src/cloudfront/viewer-request.js"),
    "__ALLOWED_RULES__",
    local.allowed_rules_js,
  )

  api_dist_path  = "${path.module}/../dist/api"
  cron_dist_path = "${path.module}/../dist/cron"

  effective_public_base_url = (
    var.public_base_url != "" ?
    var.public_base_url :
    "https://${aws_cloudfront_distribution.cdn.domain_name}"
  )
}
