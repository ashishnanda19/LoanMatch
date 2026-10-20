# Email delivery for Workflow C. SES starts in sandbox mode: it can only send to verified
# addresses, which is exactly what we want here (test inboxes only, never real customers).
# Terraform creates each identity; AWS then emails a verification link to that address and
# the identity stays "pending" until the link is clicked.

resource "aws_ses_email_identity" "sender" {
  email = var.ses_sender_email
}

resource "aws_ses_email_identity" "test_recipient" {
  for_each = toset(var.test_recipient_emails)
  email    = each.value
}

# n8n's AWS SES node authenticates with an access key (it cannot use the EC2 instance role),
# so Workflow C gets its own IAM user that can do one thing: send mail as the sender address.
resource "aws_iam_user" "n8n_ses" {
  name = "${var.project_name}-n8n-ses"
}

data "aws_iam_policy_document" "n8n_ses" {
  statement {
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [aws_ses_email_identity.sender.arn]

    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.ses_sender_email]
    }
  }
}

resource "aws_iam_user_policy" "n8n_ses" {
  name   = "send-match-notifications"
  user   = aws_iam_user.n8n_ses.name
  policy = data.aws_iam_policy_document.n8n_ses.json
}

resource "aws_iam_access_key" "n8n_ses" {
  user = aws_iam_user.n8n_ses.name
}
