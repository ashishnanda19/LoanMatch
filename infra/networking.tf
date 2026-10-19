# Uses the account's default VPC (public subnets) to avoid NAT gateway cost (~$30/mo).
# Lambda in the VPC has no internet, so it reaches S3 through a free gateway
# endpoint, RDS and n8n over private IPs. Nothing else is reachable from it.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

data "aws_route_tables" "default" {
  vpc_id = data.aws_vpc.default.id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = data.aws_vpc.default.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = data.aws_route_tables.default.ids
}

# --- security groups (rules are separate resources to avoid dependency cycles) ---

resource "aws_security_group" "lambda" {
  name        = "${var.project_name}-lambda"
  description = "parse-csv Lambda"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds"
  description = "PostgreSQL"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_security_group" "n8n" {
  name        = "${var.project_name}-n8n"
  description = "n8n host"
  vpc_id      = data.aws_vpc.default.id
}

# Lambda egress: only what it needs.
resource "aws_vpc_security_group_egress_rule" "lambda_to_rds" {
  security_group_id            = aws_security_group.lambda.id
  referenced_security_group_id = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_n8n" {
  security_group_id            = aws_security_group.lambda.id
  referenced_security_group_id = aws_security_group.n8n.id
  ip_protocol                  = "tcp"
  from_port                    = 5678
  to_port                      = 5678
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_s3" {
  security_group_id = aws_security_group.lambda.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# RDS ingress: Lambda, n8n, and your laptop (for running migrations / psql).
resource "aws_vpc_security_group_ingress_rule" "rds_from_lambda" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_n8n" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.n8n.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_me" {
  security_group_id = aws_security_group.rds.id
  cidr_ipv4         = var.my_ip_cidr
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
}

# n8n ingress: Lambda webhook calls (private), and the editor UI + SSH from your IP only.
resource "aws_vpc_security_group_ingress_rule" "n8n_from_lambda" {
  security_group_id            = aws_security_group.n8n.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = 5678
  to_port                      = 5678
}

resource "aws_vpc_security_group_ingress_rule" "n8n_ui_from_me" {
  security_group_id = aws_security_group.n8n.id
  cidr_ipv4         = var.my_ip_cidr
  ip_protocol       = "tcp"
  from_port         = 5678
  to_port           = 5678
}

resource "aws_vpc_security_group_ingress_rule" "n8n_ssh_from_me" {
  security_group_id = aws_security_group.n8n.id
  cidr_ipv4         = var.my_ip_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

# n8n must reach the internet (crawl sites, LLM APIs, SES, pull images).
resource "aws_vpc_security_group_egress_rule" "n8n_all" {
  security_group_id = aws_security_group.n8n.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
