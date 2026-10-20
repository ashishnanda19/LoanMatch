# Event-driven ingestion:
#   browser -> API Gateway -> get-upload-url Lambda -> presigned POST
#   browser -> S3 (direct upload, no size/timeout limits from API Gateway)
#   S3 ObjectCreated -> parse-csv Lambda -> RDS -> n8n webhook

# ------------------------------------------------------------------ S3 bucket
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project_name}-uploads-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "expire-uploads"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = 30 }
  }
}

# Browser uploads go straight to S3, so the bucket needs CORS for POST.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = ["*"] # the signed policy, not the origin, is what authorises an upload
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# ------------------------------------------------------------------------ IAM
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# get-upload-url: can only sign uploads under uploads/. No DB, no VPC.
resource "aws_iam_role" "get_upload_url" {
  name               = "${var.project_name}-get-upload-url"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "get_upload_url_logs" {
  role       = aws_iam_role.get_upload_url.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "get_upload_url_s3" {
  name = "sign-uploads"
  role = aws_iam_role.get_upload_url.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.uploads.arn}/uploads/*"
    }]
  })
}

# parse-csv: read uploads, plus the ENI permissions needed to run inside the VPC.
resource "aws_iam_role" "parse_csv" {
  name               = "${var.project_name}-parse-csv"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "parse_csv_vpc" {
  role       = aws_iam_role.parse_csv.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "parse_csv_s3" {
  name = "read-uploads"
  role = aws_iam_role.parse_csv.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "${aws_s3_bucket.uploads.arn}/uploads/*"
    }]
  })
}

# ------------------------------------------------------------------ Lambdas
# Run scripts/build_lambdas.sh first: it assembles build/<name>/ incl. dependencies.
data "archive_file" "get_upload_url" {
  type        = "zip"
  source_dir  = "${path.module}/../build/get_upload_url"
  output_path = "${path.module}/../build/get_upload_url.zip"
}

data "archive_file" "parse_csv" {
  type        = "zip"
  source_dir  = "${path.module}/../build/parse_csv"
  output_path = "${path.module}/../build/parse_csv.zip"
}

resource "aws_cloudwatch_log_group" "get_upload_url" {
  name              = "/aws/lambda/${var.project_name}-get-upload-url"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "parse_csv" {
  name              = "/aws/lambda/${var.project_name}-parse-csv"
  retention_in_days = 14
}

# Shared secret for n8n's webhooks (Header Auth). Same value goes to the parse-csv Lambda (below) and,
# via scripts/n8n_webhook_credential.sh, into an n8n credential.
resource "random_password" "webhook_secret" {
  length  = 40
  special = false
}

resource "aws_lambda_function" "get_upload_url" {
  function_name    = "${var.project_name}-get-upload-url"
  role             = aws_iam_role.get_upload_url.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.get_upload_url.output_path
  source_code_hash = data.archive_file.get_upload_url.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      UPLOAD_BUCKET    = aws_s3_bucket.uploads.bucket
      MAX_UPLOAD_BYTES = tostring(100 * 1024 * 1024)
      API_KEY          = random_password.api_key.result
    }
  }

  depends_on = [aws_cloudwatch_log_group.get_upload_url, aws_iam_role_policy_attachment.get_upload_url_logs]
}

resource "aws_lambda_function" "parse_csv" {
  function_name    = "${var.project_name}-parse-csv"
  role             = aws_iam_role.parse_csv.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.parse_csv.output_path
  source_code_hash = data.archive_file.parse_csv.output_base64sha256
  timeout          = 300
  memory_size      = 512

  vpc_config {
    subnet_ids         = data.aws_subnets.default.ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_HOST            = aws_db_instance.main.address
      DB_PORT            = "5432"
      DB_NAME            = var.db_name
      DB_USER            = var.db_username
      DB_PASSWORD        = random_password.db.result
      N8N_WEBHOOK_URL    = "http://${aws_instance.n8n.private_ip}:5678/webhook/batch-ready"
      N8N_WEBHOOK_SECRET = random_password.webhook_secret.result
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.parse_csv,
    aws_iam_role_policy_attachment.parse_csv_vpc,
    aws_vpc_endpoint.s3,
  ]
}

# ------------------------------------------------------------- S3 -> parse-csv
resource "aws_lambda_permission" "s3_invoke_parse_csv" {
  statement_id   = "AllowS3Invoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.parse_csv.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.uploads.arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.parse_csv.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/"
    filter_suffix       = ".csv"
  }

  depends_on = [aws_lambda_permission.s3_invoke_parse_csv]
}

# ------------------------------------------------------------- API Gateway
resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "x-api-key"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "get_upload_url" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_upload_url.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_upload_url" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /upload-url"
  target    = "integrations/${aws_apigatewayv2_integration.get_upload_url.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  # Cheap abuse guard: the endpoint only hands out short-lived, size-capped upload URLs.
  default_route_settings {
    throttling_burst_limit = 40
    throttling_rate_limit  = 20
  }
}

resource "aws_lambda_permission" "apigw_invoke_get_upload_url" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}


# ------------------------------------------------------------- web API (read side of the UI)
# Shared access key for everything that can reveal a person or start the pipeline (x-api-key header).
resource "random_password" "api_key" {
  length  = 32
  special = false
}

resource "aws_iam_role" "api" {
  name               = "${var.project_name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "api_vpc" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../build/api"
  output_path = "${path.module}/../build/api.zip"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.project_name}-api"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project_name}-api"
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 15
  memory_size      = 256

  vpc_config {
    subnet_ids         = data.aws_subnets.default.ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_HOST     = aws_db_instance.main.address
      DB_PORT     = "5432"
      DB_NAME     = var.db_name
      DB_USER     = var.db_username
      DB_PASSWORD = random_password.db.result
      API_KEY     = random_password.api_key.result
    }
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy_attachment.api_vpc]
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  for_each  = toset(["GET /summary", "GET /lenders", "GET /users", "GET /users/{id}", "POST /match"])
  api_id    = aws_apigatewayv2_api.main.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_lambda_permission" "apigw_invoke_api" {
  statement_id  = "AllowApiGatewayInvokeApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
