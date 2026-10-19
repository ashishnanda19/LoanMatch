variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "project_name" {
  type    = string
  default = "loan-engine"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "my_ip_cidr" {
  description = "Your public IP (x.x.x.x/32). Allowed to reach the n8n UI and RDS during setup."
  type        = string
}

variable "ec2_key_pair_name" {
  description = "Existing EC2 key pair for SSH access to the n8n host."
  type        = string
}
