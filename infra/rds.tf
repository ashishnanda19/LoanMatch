# The master password is generated here, never typed or committed. It lands in
# Terraform state (gitignored) and in the parse-csv Lambda's env vars.
# Production upgrade: Secrets Manager + an interface VPC endpoint (~$7/mo).
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp2"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  # Public endpoint so you can run migrations from your laptop, but the security
  # group only admits your IP, the Lambda and the n8n host.
  publicly_accessible = true

  backup_retention_period    = 1
  skip_final_snapshot        = true # assignment/demo stack; flip for anything real
  deletion_protection        = false
  auto_minor_version_upgrade = true
  apply_immediately          = true

  lifecycle {
    ignore_changes = [engine_version] # AWS resolves "16" to a full minor version
  }
}
