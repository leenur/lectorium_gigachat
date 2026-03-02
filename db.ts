import Database from 'better-sqlite3';

// Use in-memory database for Netlify/Serverless compatibility
// Note: Data will be lost on server restart or function cold start.
// For production, use an external database like Supabase, Turso, or Neon.
let db: any;

try {
  db = new Database(':memory:');
  console.log("[DB] Initialized in-memory SQLite database.");
} catch (error) {
  console.error("[DB] Failed to initialize better-sqlite3, falling back to JS in-memory mock.", error);
  
  // Simple in-memory mock for better-sqlite3 API
  const store: any = {
    users: [],
    notes: [],
    questions: [],
    attendance_sessions: [],
    attendance_records: [],
    pdfs: [],
    active_quizzes: [],
    quiz_responses: []
  };

  db = {
    exec: (sql: string) => {
      console.log("[DB Mock] Executing SQL:", sql.substring(0, 50) + "...");
      // Basic table creation is ignored as we use JS objects
    },
    prepare: (sql: string) => {
      const statement = {
        run: (...args: any[]) => {
          console.log("[DB Mock] Run:", sql, args);
          if (sql.includes('INSERT INTO users')) {
            const id = store.users.length + 1;
            store.users.push({ id, name: args[0], group_id: args[1], role: args[2], created_at: new Date().toISOString() });
            return { lastInsertRowid: id };
          }
          if (sql.includes('INSERT INTO notes')) {
            const id = store.notes.length + 1;
            store.notes.push({ id, content: args[0], created_at: new Date().toISOString() });
            return { lastInsertRowid: id };
          }
          if (sql.includes('INSERT INTO pdfs')) {
            const id = store.pdfs.length + 1;
            store.pdfs.push({ id, data: args[0], created_at: new Date().toISOString() });
            return { lastInsertRowid: id };
          }
          return { lastInsertRowid: 0 };
        },
        get: (...args: any[]) => {
          console.log("[DB Mock] Get:", sql, args);
          if (sql.includes('SELECT * FROM users WHERE name = ? AND role = ?')) {
            return store.users.find((u: any) => u.name === args[0] && u.role === args[1]);
          }
          if (sql.includes('SELECT content FROM notes ORDER BY id DESC LIMIT 1')) {
            return store.notes[store.notes.length - 1];
          }
          if (sql.includes('SELECT data FROM pdfs ORDER BY id DESC LIMIT 1')) {
            return store.pdfs[store.pdfs.length - 1];
          }
          return undefined;
        },
        all: (...args: any[]) => {
          console.log("[DB Mock] All:", sql, args);
          return [];
        }
      };
      return statement;
    }
  };
}

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    group_id TEXT,
    role TEXT NOT NULL CHECK(role IN ('student', 'lecturer')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    user_id INTEGER,
    user_name TEXT,
    group_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES attendance_sessions(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS pdfs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS active_quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data JSON NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quiz_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER,
    user_id INTEGER,
    user_name TEXT,
    score INTEGER,
    total INTEGER,
    answers JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(quiz_id) REFERENCES active_quizzes(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

export default db;
