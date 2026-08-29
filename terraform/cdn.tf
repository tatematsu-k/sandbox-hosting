resource "aws_cloudfront_origin_access_control" "content" {
  name                              = "${local.name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "viewer_request" {
  name    = "${local.name}-viewer-request"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = local.viewer_request_source
  comment = "IP allowlist + index resolution for ${local.name}"
}

resource "aws_cloudfront_response_headers_policy" "secure" {
  name = "${local.name}-secure-headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    content_security_policy {
      content_security_policy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none';"
      override                = true
    }
  }
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name} viewer distribution"
  http_version    = "http2and3"
  # PriceClass_200 includes Tokyo/Singapore/Seoul edges — important for ap-northeast-1 viewers.
  price_class = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.content.bucket_regional_domain_name
    origin_id                = "s3-content"
    origin_access_control_id = aws_cloudfront_origin_access_control.content.id
  }

  default_cache_behavior {
    target_origin_id           = "s3-content"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.secure.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_request.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  # Avoid caching S3's 403 (objects that don't exist under OAC) or 404 errors, so a
  # site published right after a stale error was seen becomes visible immediately.
  # NOTE: overriding response_code to remap 403->404 would require pairing it with
  # response_page_path (a custom error page CloudFront must serve) per the AWS API;
  # without one, CloudFront rejects the distribution. Left as pass-through for now.
  custom_error_response {
    error_code            = 403
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    error_caching_min_ttl = 0
  }
}

data "aws_iam_policy_document" "content_bucket_policy" {
  statement {
    sid       = "AllowCloudFrontReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.content.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.cdn.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "content" {
  bucket = aws_s3_bucket.content.id
  policy = data.aws_iam_policy_document.content_bucket_policy.json
}
