# Root module. Resources are split by concern across files added in later phases:
#   networking.tf  - VPC lookup/subnets, security groups        (Phase 1/2)
#   rds.tf         - RDS PostgreSQL                             (Phase 1)
#   ingestion.tf   - S3 bucket, Lambdas, API Gateway, IAM       (Phase 1)
#   n8n_ec2.tf     - EC2 host running n8n via docker compose    (Phase 2)

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
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
