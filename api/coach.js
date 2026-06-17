module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return response.status(200).json({
      text:
        "Demo mode: add ANTHROPIC_API_KEY in Vercel to generate live coaching. Suggested angle: lead with a specific business problem, ask for one tactical lesson, and keep the follow-up short."
    });
  }

  let body = {};
  try {
    body = request.body || {};
  } catch {
    return response.status(400).json({ error: "Invalid request body" });
  }

  const contact = body.contact || {};
  const prompt = `You are helping with a networking CRM demo. Write 3 concise outreach/coaching bullets for this contact. Do not invent private facts.

Name: ${contact.name || "Unknown"}
Company: ${contact.company || "Unknown"}
Role: ${contact.position || "Unknown"}
Status: ${contact.status || "Unknown"}
Notes: ${contact.notes || "None"}`;

  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 350,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      return response.status(502).json({
        error: "Anthropic request failed",
        detail: errorText.slice(0, 400)
      });
    }

    const data = await anthropicResponse.json();
    const text = data.content?.map((part) => part.text || "").join("\n").trim();
    return response.status(200).json({ text: text || "No coaching generated." });
  } catch (error) {
    return response.status(500).json({ error: "AI request failed", detail: error.message });
  }
};
