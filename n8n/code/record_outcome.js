// n8n Code node: "Record send outcome"  (runs once, right after the SES node)
// Pairs every SES result with the email it belongs to and flags success. With
// onError=continueRegularOutput a failed send arrives as an item with an `error` field, so a
// failure never stops the other users' emails and never marks anything as notified.
// The AWS SES node returns the XML response as JSON: {SendEmailResponse:{SendEmailResult:{MessageId}}}.
const messageId = (j) => (j && j.SendEmailResponse && j.SendEmailResponse.SendEmailResult &&
  j.SendEmailResponse.SendEmailResult.MessageId) || (j && j.MessageId) || null;

return $input.all().map((item, i) => {
  const mail = $('Build email').itemMatching(i).json;
  const failed = !!(item.json && item.json.error) || !messageId(item.json);
  return {
    json: {
      user_id: mail.user_id,
      to: mail.to,
      match_ids: mail.match_ids,
      match_ids_json: JSON.stringify(mail.match_ids),
      sent: !failed,
      message_id: failed ? null : messageId(item.json),
      error: failed ? JSON.stringify((item.json && item.json.error) || item.json).slice(0, 300) : null,
    },
  };
});
