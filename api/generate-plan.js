// Vercel serverless function — same logic as the old Express route,
// just exported as a single handler instead of an app.post().

const GEMINI_MODEL = "gemini-2.0-flash";

function buildPrompt({ examDate, hoursPerDay, topics }) {
  const today = new Date().toISOString().split("T")[0];
  const topicLines = topics
    .map((t) => `- ${t.name} (confidence: ${t.confidence})`)
    .join("\n");

  return `You are a study planning assistant for a student preparing for an exam.

Today's date: ${today}
Exam date: ${examDate}
Hours available per day: ${hoursPerDay}

Topics to cover:
${topicLines}

Build a day-by-day study schedule from today until the exam date (inclusive).
Rules:
- Prioritize topics marked "weak" — give them more sessions and revisit them more than once.
- Topics marked "strong" need only a light single review, not repeated sessions.
- Spread topics out for spaced repetition rather than clumping one topic into one block.
- Include at least one light day or short review-only day if the timeline allows it.
- Do not exceed the stated hours available per day.
- The final 1-2 days before the exam should be light review / recap only, not new material.

Return ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:

{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "label": "Day 1",
      "isExamDay": false,
      "totalHours": 3,
      "sessions": [
        { "topic": "Topic name", "confidence": "weak", "hours": 1.5, "focus": "short note on what to do in this session" }
      ]
    }
  ],
  "summary": "one short encouraging sentence about the overall plan"
}`;
}

module.exports = async function handler(req, res) {
  // Basic CORS so the static frontend can call this from any origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { examDate, hoursPerDay, topics } = req.body;

    if (!examDate || !hoursPerDay || !Array.isArray(topics) || topics.length === 0) {
      return res.status(400).json({ error: "Missing examDate, hoursPerDay, or topics." });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it in Vercel project settings." });
    }

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = buildPrompt({ examDate, hoursPerDay, topics });

    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      return res.status(502).json({ error: "Gemini API request failed.", details: errText });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(502).json({ error: "Gemini returned an empty response." });
    }

    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const plan = JSON.parse(cleaned);

    return res.status(200).json(plan);
  } catch (err) {
    console.error("Error generating plan:", err);
    return res.status(500).json({ error: "Something went wrong generating the plan.", details: err.message });
  }
};