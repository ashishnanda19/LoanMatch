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

variable "ses_sender_email" {
  description = "Verified SES sender (From) address for match notifications."
  type        = string
}

variable "test_recipient_emails" {
  description = "Test inboxes (e.g. you+one@gmail.com). SES sandbox only delivers to verified addresses, and the workflow only ever mails these - never the addresses in the uploaded CSV."
  type        = list(string)

  validation {
    condition     = length(var.test_recipient_emails) > 0
    error_message = "Provide at least one test recipient address."
  }
}
