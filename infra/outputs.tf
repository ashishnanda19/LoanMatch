output "api_url" {
  description = "Base URL of the upload API (POST /upload-url)."
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "upload_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

output "db_host" {
  value = aws_db_instance.main.address
}

output "db_name" {
  value = var.db_name
}

output "db_user" {
  value = var.db_username
}

output "db_password" {
  value     = random_password.db.result
  sensitive = true
}

output "n8n_url" {
  description = "n8n editor (reachable only from my_ip_cidr)."
  value       = "http://${aws_eip.n8n.public_ip}:5678"
}

output "n8n_public_ip" {
  value = aws_eip.n8n.public_ip
}

output "n8n_private_ip" {
  value = aws_instance.n8n.private_ip
}

output "n8n_webhook_url_for_lambda" {
  value = "http://${aws_instance.n8n.private_ip}:5678/webhook/batch-ready"
}

output "n8n_ssh" {
  value = "ssh -i ${var.project_name}-n8n.pem ec2-user@${aws_eip.n8n.public_ip}"
}

output "ses_sender_email" {
  value = var.ses_sender_email
}

output "ses_access_key_id" {
  description = "Access key of the send-only SES IAM user (load into n8n with scripts/n8n_ses_credential.sh)."
  value       = aws_iam_access_key.n8n_ses.id
}

output "ses_secret_access_key" {
  value     = aws_iam_access_key.n8n_ses.secret
  sensitive = true
}
