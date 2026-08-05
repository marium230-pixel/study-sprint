// StudySprint backend — takes student input, asks Gemini for a structured
// day-by-day study plan, and returns clean JSON the frontend can render.

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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

app.post("/api/generate-plan", async (req, res) => {
  try {
    const { examDate, hoursPerDay, topics } = req.body;

    if (!examDate || !hoursPerDay || !Array.isArray(topics) || topics.length === 0) {
      return res.status(400).json({ error: "Missing examDate, hoursPerDay, or topics." });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it to backend/.env" });
    }

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

    res.json(plan);
  } catch (err) {
    console.error("Error generating plan:", err);
    res.status(500).json({ error: "Something went wrong generating the plan.", details: err.message });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Serve the frontend for any non-API route (so refreshes on / work correctly)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`StudySprint backend running on http://localhost:${PORT}`));
