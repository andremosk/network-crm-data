module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: { message: "Method not allowed" } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return response.status(200).json({
      error: {
        message:
          "ANTHROPIC_API_KEY is not set in Vercel. Add it in Project Settings > Environment Variables, then redeploy."
      }
    });
  }

  let body = request.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return response.status(400).json({ error: { message: "Invalid JSON request body." } });
    }
  }
  let anthropicBody = body;

  // Backward compatibility for the older demo endpoint shape.
  if (!body.messages && body.contact) {
    const contact = body.contact || {};
    anthropicBody = {
      model: "claude-3-5-haiku-latest",
      max_tokens: 350,
      messages: [
        {
          role: "user",
          content: `You are helping with a networking CRM demo. Write 3 concise outreach/coaching bullets for this contact. Do not invent private facts.

Name: ${contact.name || "Unknown"}
Company: ${contact.company || "Unknown"}
Role: ${contact.position || "Unknown"}
Status: ${contact.status || "Unknown"}
Notes: ${contact.notes || "None"}`
        }
      ]
    };
  }

  if (!anthropicBody.messages) {
    return response.status(400).json({ error: { message: "Missing Anthropic messages payload." } });
  }

  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(anthropicBody)
    });

    const text = await anthropicResponse.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: text || "Anthropic returned a non-JSON response." } };
    }

    return response.status(anthropicResponse.ok ? 200 : anthropicResponse.status).json(data);
  } catch (error) {
    return response.status(500).json({ error: { message: error.message || "AI request failed." } });
  }
};
