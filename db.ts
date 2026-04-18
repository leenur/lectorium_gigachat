// Use in-memory database for Netlify/Serverless compatibility
// Note: Data will be lost on server restart or function cold start.
// For production, use an external database like Supabase, Turso, or Neon.
let db: any;

try {
  // Try to load better-sqlite3 dynamically
  // This prevents the app from crashing at startup if the binary is missing or incompatible (common in Vercel)
  // Instead of createRequire, simply try to require directly if available, or ignore
  const Database = require('better-sqlite3');
  db = new Database(':memory:');
  console.log("[DB] Initialized in-memory SQLite database.");
} catch (error) {
  console.error("[DB] Failed to initialize better-sqlite3, falling back to JS in-memory mock.", error);
  
  // Simple in-memory mock for better-sqlite3 API
  const store: Record<string, any[]> = {
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
    },
    prepare: (sql: string) => {
      return {
        run: (...args: any[]) => {
          console.log("[DB Mock] Run:", sql, args);
          const tableNameMatch = sql.match(/INSERT INTO (\w+)/i);
          if (tableNameMatch && store[tableNameMatch[1]]) {
            const tableName = tableNameMatch[1];
            const id = store[tableName].length + 1;
            
            const row: any = { id, created_at: new Date().toISOString() };
            if (tableName === 'users') {
                row.name = args[0]; row.group_id = args[1]; row.role = args[2];
            } else if (tableName === 'notes') {
                row.content = args[0];
            } else if (tableName === 'questions') {
                row.text = args[0]; row.author_name = args[1];
            } else if (tableName === 'attendance_sessions') {
                // no args
            } else if (tableName === 'attendance_records') {
                row.session_id = args[0]; row.student_name = args[1];
            } else if (tableName === 'pdfs') {
                row.name = args[0]; row.data = args[1];
            } else if (tableName === 'active_quizzes') {
                row.data = args[0];
            } else if (tableName === 'quiz_responses') {
                row.quiz_id = args[0]; row.student_name = args[1]; row.answers = args[2]; row.score = args[3];
            }
            
            store[tableName].push(row);
            return { lastInsertRowid: id };
          }
          return { lastInsertRowid: 1 };
        },
        get: (...args: any[]) => {
          console.log("[DB Mock] Get:", sql, args);
          const tableNameMatch = sql.match(/FROM (\w+)/i);
          if (tableNameMatch && store[tableNameMatch[1]]) {
            const tableName = tableNameMatch[1];
            if (sql.includes('ORDER BY id DESC LIMIT 1')) {
              return store[tableName][store[tableName].length - 1];
            }
            if (sql.includes('WHERE name = ? AND role = ?')) {
              return store[tableName].find((u: any) => u.name === args[0] && u.role === args[1]);
            }
          }
          return undefined;
        },
        all: (...args: any[]) => {
          console.log("[DB Mock] All:", sql, args);
          const tableNameMatch = sql.match(/FROM (\w+)/i);
          if (tableNameMatch && store[tableNameMatch[1]]) {
            const tableName = tableNameMatch[1];
            return [...store[tableName]].reverse();
          }
          return [];
        }
      };
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
