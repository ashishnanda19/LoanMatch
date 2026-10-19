variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "project_name" {
  type    = string
  default = "loan-engine"
}

variable "my_ip_cidr" {
  description = "Your public IP (x.x.x.x/32). Allowed to reach the n8n UI, SSH and RDS during setup."
  type        = string

  validation {
    condition     = can(cidrhost(var.my_ip_cidr, 0)) && var.my_ip_cidr != "0.0.0.0/0"
    error_message = "my_ip_cidr must be a valid CIDR and must not be 0.0.0.0/0."
  }
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "n8n_instance_type" {
  type    = string
  default = "t3.micro"
}

variable "db_name" {
  type    = string
  default = "loanengine"
}

variable "db_username" {
  type    = string
  default = "loanadmin"
}
