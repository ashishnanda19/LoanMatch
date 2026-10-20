// n8n Code node: "Notification summary"
const outcomes = $('Record send outcome').all().map((i) => i.json);
const sent = outcomes.filter((o) => o.sent);
return [{
  json: {
    emails_sent: sent.length,
    emails_failed: outcomes.length - sent.length,
    matches_marked_notified: sent.reduce((n, o) => n + o.match_ids.length, 0),
    recipients: sent.map((o) => o.to),
    failures: outcomes.filter((o) => !o.sent).map((o) => ({ user_id: o.user_id, error: o.error })),
    finished_at: new Date().toISOString(),
  },
}];
