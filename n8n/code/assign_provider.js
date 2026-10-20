// n8n Code node: "Assign provider"
// Spreads lenders over BOTH providers so their separate free-tier quotas add up. Gemini flash-lite
// allows many more requests per minute than Groq allows tokens per minute, so Gemini takes two
// of every three lenders and Groq one. (n8n runs the two branches one after the other, so the
// gain comes from the faster pacing the Gemini quota allows, not from simultaneous calls.)
return $input.all().map((item, i) => ({ json: { ...item.json, provider: i % 3 === 0 ? 'groq' : 'gemini' } }));
