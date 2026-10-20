-- Where failure alerts go: the verified SES sender, i.e. the owner's own inbox. Never a CSV address.
SELECT value AS alert_to FROM app_settings WHERE key = 'ses_sender_email'
