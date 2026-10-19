# Root module. Resources are split by concern:
#   networking.tf  - default-VPC lookups, security groups, S3 gateway endpoint
#   rds.tf         - RDS PostgreSQL
#   ingestion.tf   - S3 upload bucket, Lambdas, API Gateway, IAM
#   n8n_ec2.tf     - EC2 host running n8n via docker compose

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    tls     = { source = "hashicorp/tls", version = "~> 4.0" }
    local   = { source = "hashicorp/local", version = "~> 2.5" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
