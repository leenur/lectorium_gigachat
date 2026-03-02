import "dotenv/config";
import express from "express";
import { createServer } from "http";
// import { createServer as createViteServer } from "vite";
import db from "./db";
import { GigaChatService } from "./src/services/gigachat";
import fs from "fs";
import os from "os";
import path from "path";

const app = express();
const httpServer = createServer(app);
const PORT = 3000;

let attendanceActive = false;
let currentAttendanceSessionId: number | null = null;

// Middleware for JSON
app.use(express.json({ limit: '50mb' }));

// Helper to get GigaChat API Key dynamically
const getGigaChatApiKey = () => {
  const key = process.env.GIGACHAT_API_KEY ? process.env.GIGACHAT_API_KEY.trim() : "";
  // Remove any quotes that might have been added in Netlify UI
  return key.replace(/['"]/g, '');
};

// Initialize GigaChat Service with a getter to ensure it always uses the latest key
const getAiService = () => {
  const key = getGigaChatApiKey();
  return new GigaChatService(key);
};

// Debug API Key on startup (will show in Netlify logs)
console.log("GigaChat API Key Status:", getGigaChatApiKey() ? "Present" : "Missing");
if (getGigaChatApiKey()) {
  console.log("GigaChat API Key Length:", getGigaChatApiKey().length);
}
const scope = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
console.log("GigaChat Scope:", scope);

// Logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// In-memory state for polling (replaces socket.io)
// Note: This state is ephemeral in serverless environments!
const activeUsers = new Map<number, { name: string, role: string, lastSeen: number, feedback?: number }>();
const feedbackStats = {
  total: 0,
  sum: 0,
  average: 50
};

const recalculateFeedback = () => {
    let sum = 0;
    let count = 0;
    for (const user of activeUsers.values()) {
        if (user.role === 'student' && user.feedback !== undefined) {
            sum += user.feedback;
            count++;
        }
    }
    feedbackStats.total = count;
    feedbackStats.sum = sum;
    feedbackStats.average = count > 0 ? Math.round(sum / count) : 50;
};

// Clean up inactive users
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, user] of activeUsers) {
        if (now - user.lastSeen > 30000) { // 30s timeout
            activeUsers.delete(id);
            changed = true;
        }
    }
    if (changed) recalculateFeedback();
}, 5000);

// Polling Endpoints

// Heartbeat / Update State
app.post("/api/heartbeat", (req, res) => {
    const { id, name, role, feedback } = req.body;
    if (id) {
        const existing = activeUsers.get(id) || { name, role, lastSeen: 0, feedback: undefined };
        existing.lastSeen = Date.now();
        if (feedback !== undefined) existing.feedback = feedback;
        activeUsers.set(id, existing);
        recalculateFeedback();
    }
    res.json({ success: true });
});

// Get Global State (Polling)
app.get("/api/state", (req, res) => {
    const questions = db.prepare('SELECT * FROM questions ORDER BY created_at DESC LIMIT 50').all();
    const activeQuiz = db.prepare('SELECT id, data FROM active_quizzes ORDER BY id DESC LIMIT 1').get() as { id: number, data: string } | undefined;
    const latestNote = db.prepare('SELECT content FROM notes ORDER BY id DESC LIMIT 1').get() as { content: string } | undefined;
    
    let attendanceCount = 0;
    if (attendanceActive && currentAttendanceSessionId) {
        const countStmt = db.prepare('SELECT COUNT(*) as count FROM attendance_records WHERE session_id = ?');
        const count = countStmt.get(currentAttendanceSessionId) as { count: number };
        attendanceCount = count.count;
    }

    res.json({
        feedbackStats,
        questions,
        activeQuiz: activeQuiz ? { id: activeQuiz.id, questions: JSON.parse(activeQuiz.data) } : null,
        notes: latestNote ? latestNote.content : "",
        attendance: {
            active: attendanceActive,
            count: attendanceCount
        },
        activeUsersCount: activeUsers.size
    });
});

app.post("/api/questions", (req, res) => {
    const { userId, userName, content } = req.body;
    if (userId && content) {
        const stmt = db.prepare('INSERT INTO questions (user_id, user_name, content) VALUES (?, ?, ?)');
        stmt.run(userId, userName, content);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "Missing data" });
    }
});

app.post("/api/attendance/submit", (req, res) => {
    const { userId, userName, groupId } = req.body;
    if (userId && attendanceActive && currentAttendanceSessionId) {
        try {
            const stmt = db.prepare('INSERT INTO attendance_records (session_id, user_id, user_name, group_id) VALUES (?, ?, ?, ?)');
            stmt.run(currentAttendanceSessionId, userId, userName, groupId);
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, message: "Already submitted" });
        }
    } else {
        res.status(400).json({ error: "Attendance not active or missing data" });
    }
});

// AI Health Check
app.get("/api/health/ai", async (req, res) => {
  const currentApiKey = getGigaChatApiKey();
  if (!currentApiKey) {
    res.status(500).json({ status: "error", message: "API Key missing or invalid configuration. Please set GIGACHAT_API_KEY in your environment variables." });
    return;
  }
  try {
    const aiService = getAiService();
    const response = await aiService.chat([{ role: 'user', content: 'Test connection' }]);
    res.json({ status: "ok", message: "GigaChat API is working", response: response.choices[0].message.content });
  } catch (error: any) {
    console.error("AI Health Check Error:", error);
    res.status(500).json({ 
      status: "error", 
      message: error.message || "Unknown error",
      details: error 
    });
  }
});

// Login / Register
app.post("/api/login", (req, res) => {
  const { name, group_id, role, password } = req.body;
  
  if (role === 'lecturer') {
    // Simple hardcoded check for demo purposes, or just allow it
    if (password !== 'admin') {
       res.status(401).json({ error: "Invalid password" });
       return;
    }
  }

  // Check if user exists or create
  let user = db.prepare('SELECT * FROM users WHERE name = ? AND role = ?').get(name, role) as any;
  
  if (!user) {
    const stmt = db.prepare('INSERT INTO users (name, group_id, role) VALUES (?, ?, ?)');
    const info = stmt.run(name, group_id || '', role);
    user = { id: info.lastInsertRowid, name, group_id, role };
  }

  res.json(user);
});

// Notes
app.post("/api/notes", (req, res) => {
  try {
    console.log("Received notes update:", req.body);
    const { content } = req.body;
    if (content === undefined || content === null) {
        res.status(400).json({ error: "Content is required" });
        return;
    }
    const stmt = db.prepare('INSERT INTO notes (content) VALUES (?)');
    stmt.run(content);
    res.json({ success: true });
  } catch (error) {
    console.error("Error saving notes:", error);
    res.status(500).json({ error: "Failed to save notes" });
  }
});

app.get("/api/notes", (req, res) => {
  const note = db.prepare('SELECT content FROM notes ORDER BY id DESC LIMIT 1').get();
  res.json(note || { content: "" });
});

// Import PDF using AI
app.post("/api/notes/import-pdf", async (req, res) => {
  const { pdfBase64 } = req.body;
  const currentApiKey = getGigaChatApiKey();
  if (!currentApiKey) {
     res.status(500).json({ error: "GigaChat API Key not configured. Please set GIGACHAT_API_KEY in your environment variables." });
     return;
  }
  
  try {
    const aiService = getAiService();
    // Save PDF to DB
    const stmt = db.prepare('INSERT INTO pdfs (data) VALUES (?)');
    stmt.run(pdfBase64);
    
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
        throw new Error("Invalid PDF data");
    }

    const prompt = "Convert this PDF document into well-structured Markdown lecture notes. Preserve all key information, headings, and lists. Do not include any conversational text, just the notes.";
    const response = await aiService.analyzePdf(pdfBase64, prompt);
    const markdown = response.choices[0].message.content;
    
    if (!markdown) {
        throw new Error("Empty response from AI");
    }
    
    // Save notes to DB
    const noteStmt = db.prepare('INSERT INTO notes (content) VALUES (?)');
    noteStmt.run(markdown);
    
    res.json({ content: markdown });
  } catch (error: any) {
    console.error("AI PDF Import Error:", error);
    res.status(500).json({ error: error.message || "Failed to process PDF" });
  }
});

app.get("/api/pdf/latest", (req, res) => {
  const pdf = db.prepare('SELECT data FROM pdfs ORDER BY id DESC LIMIT 1').get() as { data: string };
  if (!pdf) {
    res.status(404).send("No PDF found");
    return;
  }
  const img = Buffer.from(pdf.data, 'base64');
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': img.length
  });
  res.end(img);
});

// Generate Quiz from PDF (Lecturer triggered)
app.post("/api/quiz/generate", async (req, res) => {
  const { startPage, endPage } = req.body;
  
  const pdfRecord = db.prepare('SELECT data FROM pdfs ORDER BY id DESC LIMIT 1').get() as { data: string };
  if (!pdfRecord) {
    res.status(400).json({ error: "No PDF uploaded" });
    return;
  }

  const currentApiKey = getGigaChatApiKey();
  if (!currentApiKey) {
     res.status(500).json({ error: "GigaChat API Key not configured. Please set GIGACHAT_API_KEY in your environment variables." });
     return;
  }

  try {
    const aiService = getAiService();
    const prompt = `Create a short quiz (3 questions) based on the content of the attached PDF, specifically focusing on pages ${startPage} to ${endPage}.
    Return ONLY a JSON array of objects with this structure:
    [
      {
        "question": "Question text",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctIndex": 0
      }
    ]
    `;
    
    const response = await aiService.analyzePdf(pdfRecord.data, prompt);
    
    const content = response.choices[0].message.content;
    // Extract JSON from response (GigaChat might return markdown code block)
    const jsonMatch = content.match(/\[.*\]/s);
    const quizData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    
    // Save active quiz
    const stmt = db.prepare('INSERT INTO active_quizzes (data) VALUES (?)');
    const info = stmt.run(JSON.stringify(quizData));
    const quizId = info.lastInsertRowid;
    
    res.json({ id: quizId, quiz: quizData });
  } catch (error) {
    console.error("AI Quiz Error:", error);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

app.post("/api/quiz/publish", (req, res) => {
    const { quiz } = req.body;
    if (!quiz) {
        res.status(400).json({ error: "Quiz data required" });
        return;
    }
    
    // Save active quiz
    const stmt = db.prepare('INSERT INTO active_quizzes (data) VALUES (?)');
    const info = stmt.run(JSON.stringify(quiz));
    const quizId = info.lastInsertRowid;
    
    res.json({ success: true, id: quizId });
});

app.get("/api/quiz/active", (req, res) => {
    const quiz = db.prepare('SELECT id, data FROM active_quizzes ORDER BY id DESC LIMIT 1').get() as { id: number, data: string };
    res.json(quiz ? { id: quiz.id, questions: JSON.parse(quiz.data) } : null);
});

app.post("/api/quiz/submit", (req, res) => {
  const { quizId, userId, userName, score, total, answers } = req.body;
  
  try {
    const stmt = db.prepare('INSERT INTO quiz_responses (quiz_id, user_id, user_name, score, total, answers) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(quizId, userId, userName, score, total, JSON.stringify(answers));
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error submitting quiz:", error);
    res.status(500).json({ error: "Failed to submit quiz" });
  }
});

app.get("/api/quiz/results/:quizId", (req, res) => {
  const { quizId } = req.params;
  const results = db.prepare('SELECT * FROM quiz_responses WHERE quiz_id = ? ORDER BY created_at DESC').all(quizId);
  res.json(results);
});

// AI Features
app.post("/api/ai/summarize", async (req, res) => {
  const { content } = req.body;
  const currentApiKey = getGigaChatApiKey();
  if (!currentApiKey) {
     res.status(500).json({ error: "GigaChat API Key not configured. Please set GIGACHAT_API_KEY in your environment variables." });
     return;
  }
  
  try {
    const aiService = getAiService();
    const response = await aiService.chat([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: `Summarize the following lecture notes in Russian. Keep it concise and structured:\n\n${content}` }
    ]);
    res.json({ summary: response.choices[0].message.content });
  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: "Failed to generate summary" });
  }
});

app.post("/api/ai/quiz", async (req, res) => {
  const { content } = req.body;
  const currentApiKey = getGigaChatApiKey();
  if (!currentApiKey) {
     res.status(500).json({ error: "GigaChat API Key not configured. Please set GIGACHAT_API_KEY in your environment variables." });
     return;
  }

  try {
    const aiService = getAiService();
    const prompt = `Create a short quiz (3 questions) based on these lecture notes in Russian. 
    Return ONLY a JSON array of objects with this structure:
    [
      {
        "question": "Question text",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctIndex": 0
      }
    ]
    Notes: ${content}`;
    
    const response = await aiService.chat([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: prompt }
    ]);
    
    const responseContent = response.choices[0].message.content;
    const jsonMatch = responseContent.match(/\[.*\]/s);
    const quizData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(responseContent);
    
    res.json({ quiz: quizData });
  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

// Attendance Control
app.post("/api/attendance/start", (req, res) => {
  attendanceActive = true;
  const stmt = db.prepare('INSERT INTO attendance_sessions DEFAULT VALUES');
  const info = stmt.run();
  currentAttendanceSessionId = info.lastInsertRowid as number;
  
  // Close after 5 seconds
  setTimeout(() => {
    attendanceActive = false;
  }, 5000);

  res.json({ success: true });
});

app.get("/api/questions", (req, res) => {
    const questions = db.prepare('SELECT * FROM questions ORDER BY created_at DESC LIMIT 50').all();
    res.json(questions);
});


// Summarize PDF using inlineData (now text extraction)
app.post("/api/ai/summarize-pdf", async (req, res) => {
  const { pdfBase64, prompt } = req.body;
  
  const currentApiKey = getGigaChatApiKey();
  if (!currentApiKey) {
     res.status(500).json({ error: "GigaChat API Key not configured. Please set GIGACHAT_API_KEY in your environment variables." });
     return;
  }

  if (!pdfBase64) {
      res.status(400).json({ error: "PDF data is required" });
      return;
  }
  
  try {
    const aiService = getAiService();
    const response = await aiService.analyzePdf(pdfBase64, prompt || "Summarize this document");
    res.json({ summary: response.choices[0].message.content });
  } catch (error: any) {
    console.error("AI PDF Summarize Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate summary" });
  }
});

// New endpoint for full analysis (Summary + Quiz)
app.post("/api/ai/analyze-pdf", async (req, res) => {
  const { pdfBase64 } = req.body;
  
  const currentApiKey = getGigaChatApiKey();
  if (!currentApiKey) {
     res.status(500).json({ error: "GigaChat API Key not configured. Please set GIGACHAT_API_KEY in your environment variables." });
     return;
  }

  if (!pdfBase64) {
      res.status(400).json({ error: "PDF data is required" });
      return;
  }
  
  try {
    const aiService = getAiService();
    const prompt = `
    Analyze the attached PDF document content.
    1. Provide a comprehensive summary of the document in Russian.
    2. Create a quiz with 5 multiple-choice questions based on the document's content. The questions and options must be in Russian.
 
    Return the response in JSON format with the following structure:
    {
      "summary": "The summary text in Russian",
      "quiz": [
        {
          "question": "Question text",
          "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
          "correctIndex": 0 // Index of the correct option (0-3)
        }
      ]
    }
    `;

    const response = await aiService.analyzePdf(pdfBase64, prompt);
    
    const content = response.choices[0].message.content;
    let result;
    try {
      const jsonMatch = content.match(/\{.*\}/s);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse AI response as JSON:", content);
      result = {
        summary: content,
        quiz: []
      };
    }
    
    res.json(result);
  } catch (error: any) {
    console.error("AI PDF Analyze Error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze PDF" });
  }
});


async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for Netlify Functions (serverless-http)
export { app };

if (process.env.NODE_ENV !== 'production') {
    startServer();
}
