const fs = require('fs');
const os = require('os');
const path = require('path');
let initSqlJs;
try {
  initSqlJs = require('./sql-asm.js');
} catch (e1) {
  try {
    initSqlJs = require('sql.js/dist/sql-asm.js');
  } catch (e2) {
    initSqlJs = require('sql.js');
  }
}
const bcrypt = require('bcryptjs');

// Determine if running in a serverless environment (Netlify / AWS Lambda)
const isServerless = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

function getBundledDbPath() {
  const candidates = [
    path.join(process.cwd(), 'data', 'portal.db'),
    path.join(__dirname, 'data', 'portal.db'),
    path.join(__dirname, '..', 'data', 'portal.db'),
    path.join(__dirname, '..', '..', 'data', 'portal.db'),
    path.resolve('data', 'portal.db'),
    '/var/task/data/portal.db'
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}

// In serverless, the only writable directory is the temp directory (/tmp on Netlify)
let dbPath;
if (isServerless) {
  dbPath = path.join(os.tmpdir(), 'portal.db');
  if (!fs.existsSync(dbPath)) {
    const bundled = getBundledDbPath();
    if (bundled) {
      try {
        fs.copyFileSync(bundled, dbPath);
        console.log(`[Database] Seeded ${dbPath} from ${bundled}`);
      } catch (err) {
        console.error('[Database] Failed copying seed DB to tmp:', err);
      }
    }
  }
} else {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  dbPath = path.join(dataDir, 'portal.db');
}

let dbInstance = null;

// Helper to save SQLite database buffer to disk
function saveDb() {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('[Database] Failed to save DB to disk:', err);
  }
}

// Database helper wrapper providing standard prepared statements
const db = {
  exec(sql) {
    dbInstance.exec(sql);
    saveDb();
  },
  prepare(sql) {
    return {
      all(...args) {
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = dbInstance.prepare(sql);
        if (params && params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      },
      get(...args) {
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = dbInstance.prepare(sql);
        if (params && params.length) stmt.bind(params);
        let row = null;
        if (stmt.step()) {
          row = stmt.getAsObject();
        }
        stmt.free();
        return row;
      },
      run(...args) {
        // Support run(val1, val2) or run([val1, val2])
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = dbInstance.prepare(sql);
        if (params && params.length) stmt.bind(params);
        stmt.step();
        stmt.free();
        // Capture last_insert_rowid before saveDb() because dbInstance.export() resets it to 0
        let lastId = null;
        try {
          const res = dbInstance.exec('SELECT last_insert_rowid()');
          if (res && res[0] && res[0].values && res[0].values[0]) {
            lastId = res[0].values[0][0];
          }
        } catch(e) {}
        saveDb();
        return { lastInsertRowid: lastId };
      }
    };
  }
};

async function initDatabase() {
  if (dbInstance) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      dbInstance = new SQL.Database(fileBuffer);
      console.log(`[Database] Loaded existing database from ${dbPath}`);
    } catch (err) {
      console.error(`[Database] Failed reading ${dbPath}:`, err);
    }
  }

  if (!dbInstance) {
    const bundled = getBundledDbPath();
    if (bundled && fs.existsSync(bundled)) {
      try {
        const fileBuffer = fs.readFileSync(bundled);
        dbInstance = new SQL.Database(fileBuffer);
        console.log(`[Database] Loaded database from bundled ${bundled}`);
        saveDb();
      } catch (err) {
        console.error(`[Database] Failed reading bundled ${bundled}:`, err);
      }
    }
  }

  if (!dbInstance) {
    dbInstance = new SQL.Database();
    console.log('[Database] Created new SQLite database instance');
  }

  // Create Schema for all 10 Tables
  db.exec(`
    -- 1. Admin Passwords (Password-Only Authentication)
    CREATE TABLE IF NOT EXISTS admin_passwords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      permissions TEXT DEFAULT 'all',
      plain_preview TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Departments
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      icon TEXT DEFAULT '🏢',
      color TEXT DEFAULT '#2A6FA8',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. Team Members (For Zero-Login Employee Selection)
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department_id INTEGER NOT NULL,
      role_title TEXT DEFAULT 'Team Member',
      avatar_color TEXT DEFAULT '#2A6FA8',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE
    );

    -- 4. Organization Links
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT NOT NULL,
      department_id INTEGER,
      tags TEXT,
      icon TEXT DEFAULT '🔗',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE SET NULL
    );

    -- 5. Announcements Board
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT CHECK(priority IN ('Urgent', 'Notice', 'Milestone', 'General')) DEFAULT 'General',
      department_id INTEGER,
      tags TEXT,
      is_pinned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE SET NULL
    );

    -- 6. Voting Polls (Controlled by Admin)
    CREATE TABLE IF NOT EXISTS voting_polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 7. Department Bottlenecks & Hurdles (Includes 3 Solutions & Admin Notes)
    CREATE TABLE IF NOT EXISTS bottlenecks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      details TEXT,
      severity TEXT CHECK(severity IN ('Critical', 'High', 'Medium')) DEFAULT 'High',
      hours_lost_week REAL DEFAULT 0,
      tags TEXT,
      reported_by TEXT NOT NULL,
      solution_1 TEXT,
      solution_2 TEXT,
      solution_3 TEXT,
      admin_notes TEXT,
      status TEXT CHECK(status IN ('Under Review', 'Open', 'In Discussion', 'Solution Linked', 'Resolved')) DEFAULT 'Under Review',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE
    );

    -- 8. Ideas & Automation Hub
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER,
      title TEXT NOT NULL,
      department_id INTEGER NOT NULL,
      category TEXT CHECK(category IN ('Process Automation', 'Company Growth', 'Cost Reduction', 'Quality & Speed')) NOT NULL,
      description TEXT NOT NULL,
      expected_impact TEXT,
      tags TEXT,
      bottleneck_id INTEGER,
      submitter_name TEXT NOT NULL,
      total_votes INTEGER DEFAULT 0,
      dept_votes INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      is_selected INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('Submitted', 'Best Idea', 'Selected', 'Under Review', 'In Progress', 'Implemented')) DEFAULT 'Submitted',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE,
      FOREIGN KEY(poll_id) REFERENCES voting_polls(id) ON DELETE SET NULL,
      FOREIGN KEY(bottleneck_id) REFERENCES bottlenecks(id) ON DELETE SET NULL
    );

    -- 9. Votes (Prevents Double Voting)
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id INTEGER NOT NULL,
      poll_id INTEGER,
      voter_name TEXT NOT NULL,
      voter_department_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(idea_id, voter_name),
      FOREIGN KEY(idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
      FOREIGN KEY(poll_id) REFERENCES voting_polls(id) ON DELETE CASCADE,
      FOREIGN KEY(voter_department_id) REFERENCES departments(id) ON DELETE CASCADE
    );

    -- 10. Team Chat Messages
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_name TEXT NOT NULL,
      sender_department_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_department_id) REFERENCES departments(id) ON DELETE CASCADE
    );
  `);

  // Safe migrations for schema updates
  try { db.exec('ALTER TABLE bottlenecks ADD COLUMN solution_1 TEXT;'); } catch(e) {}
  try { db.exec('ALTER TABLE bottlenecks ADD COLUMN solution_2 TEXT;'); } catch(e) {}
  try { db.exec('ALTER TABLE bottlenecks ADD COLUMN solution_3 TEXT;'); } catch(e) {}
  try { db.exec('ALTER TABLE bottlenecks ADD COLUMN admin_notes TEXT;'); } catch(e) {}
  try { db.exec('ALTER TABLE ideas ADD COLUMN is_locked INTEGER DEFAULT 0;'); } catch(e) {}
  try { db.exec('ALTER TABLE ideas ADD COLUMN is_selected INTEGER DEFAULT 0;'); } catch(e) {}
  try { db.exec("ALTER TABLE admin_passwords ADD COLUMN permissions TEXT DEFAULT 'all';"); } catch(e) {}
  try { db.exec('ALTER TABLE admin_passwords ADD COLUMN plain_preview TEXT;'); } catch(e) {}
  try { db.exec('ALTER TABLE team_members ADD COLUMN password_hash TEXT;'); } catch(e) {}
  try { db.exec('ALTER TABLE team_members ADD COLUMN plain_preview TEXT;'); } catch(e) {}
  try { db.exec('ALTER TABLE team_members ADD COLUMN personal_links TEXT;'); } catch(e) {}
  try { db.exec('ALTER TABLE ideas ADD COLUMN poll_allowed INTEGER DEFAULT 0;'); } catch(e) {}
  try { db.exec('ALTER TABLE ideas ADD COLUMN admin_notification INTEGER DEFAULT 1;'); } catch(e) {}
  try { db.exec('ALTER TABLE ideas ADD COLUMN selection_notified INTEGER DEFAULT 0;'); } catch(e) {}

  // Set default PIN '1234' for team members who don't have one
  try {
    const unhashedMembers = db.prepare('SELECT id, name FROM team_members WHERE password_hash IS NULL OR password_hash = ""').all();
    if (unhashedMembers && unhashedMembers.length > 0) {
      const defaultPin = '1234';
      const defaultHash = bcrypt.hashSync(defaultPin, 10);
      const updateStmt = db.prepare('UPDATE team_members SET password_hash = ?, plain_preview = ? WHERE id = ?');
      unhashedMembers.forEach(m => {
        updateStmt.run(defaultHash, defaultPin, m.id);
      });
      console.log(`[Database] Initialized default personal PIN '1234' for ${unhashedMembers.length} team members.`);
    }
  } catch(e) {}

  // Ensure key admin / team members exist if needed
  try {
    const standardMembers = [
      ['Hemlata Sakla', 5, 'MIS Executive', '1234']
    ];
    standardMembers.forEach(([name, deptId, role, pin]) => {
      const existing = db.prepare('SELECT id FROM team_members WHERE LOWER(name) = LOWER(?)').get(name);
      if (!existing) {
        const hash = bcrypt.hashSync(pin, 10);
        db.prepare('INSERT INTO team_members (name, department_id, role_title, password_hash, plain_preview) VALUES (?, ?, ?, ?, ?)').run(
          name, deptId, role, hash, pin
        );
      }
    });
  } catch(e) {}

  // Seed sample personal links for Rahul Sharma if empty
  try {
    const rahul = db.prepare("SELECT id, personal_links FROM team_members WHERE name = 'Rahul Sharma'").get();
    if (rahul && (!rahul.personal_links || rahul.personal_links === '[]' || rahul.personal_links === '')) {
      const sampleLinks = JSON.stringify([
        { title: "Rahul's Q3 Accounts KPI Sheet", url: "https://docs.google.com/spreadsheets/d/rahul-kpi", icon: "📊" },
        { title: "Employee Payroll & Tax Slips", url: "https://payroll.teamsaathi.internal/slips", icon: "📑" },
        { title: "GST Portal Quick Access", url: "https://services.gst.gov.in", icon: "🏛️" }
      ]);
      db.prepare("UPDATE team_members SET personal_links = ? WHERE id = ?").run(sampleLinks, rahul.id);
    }
  } catch(e) {}

  // Migration: ensure bottlenecks supports 'Under Review' status
  try {
    const bSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bottlenecks'").get();
    if (bSchema && !bSchema.sql.includes('Under Review')) {
      db.exec(`
        CREATE TABLE bottlenecks_migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          department_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          details TEXT,
          severity TEXT CHECK(severity IN ('Critical', 'High', 'Medium')) DEFAULT 'High',
          hours_lost_week REAL DEFAULT 0,
          tags TEXT,
          reported_by TEXT NOT NULL,
          solution_1 TEXT,
          solution_2 TEXT,
          solution_3 TEXT,
          admin_notes TEXT,
          status TEXT CHECK(status IN ('Under Review', 'Open', 'In Discussion', 'Solution Linked', 'Resolved')) DEFAULT 'Under Review',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE
        );
        INSERT INTO bottlenecks_migration (id, department_id, title, details, severity, hours_lost_week, tags, reported_by, solution_1, solution_2, solution_3, admin_notes, status, created_at)
        SELECT id, department_id, title, details, severity, hours_lost_week, tags, reported_by, solution_1, solution_2, solution_3, admin_notes, status, created_at FROM bottlenecks;
        DROP TABLE bottlenecks;
        ALTER TABLE bottlenecks_migration RENAME TO bottlenecks;
      `);
      console.log('[Database] Migrated bottlenecks table to support Under Review status');
    }
  } catch(err) {
    console.error('[Database] Bottlenecks migration note:', err.message);
  }

  // Migration: ensure ideas supports 'Selected' status
  try {
    const iSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ideas'").get();
    if (iSchema && !iSchema.sql.includes('Selected')) {
      db.exec(`
        CREATE TABLE ideas_migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER,
          title TEXT NOT NULL,
          department_id INTEGER NOT NULL,
          category TEXT CHECK(category IN ('Process Automation', 'Company Growth', 'Cost Reduction', 'Quality & Speed')) NOT NULL,
          description TEXT NOT NULL,
          expected_impact TEXT,
          tags TEXT,
          bottleneck_id INTEGER,
          submitter_name TEXT NOT NULL,
          total_votes INTEGER DEFAULT 0,
          dept_votes INTEGER DEFAULT 0,
          is_locked INTEGER DEFAULT 0,
          is_selected INTEGER DEFAULT 0,
          status TEXT CHECK(status IN ('Submitted', 'Best Idea', 'Selected', 'Under Review', 'In Progress', 'Implemented')) DEFAULT 'Submitted',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE,
          FOREIGN KEY(poll_id) REFERENCES voting_polls(id) ON DELETE SET NULL,
          FOREIGN KEY(bottleneck_id) REFERENCES bottlenecks(id) ON DELETE SET NULL
        );
        INSERT INTO ideas_migration (id, poll_id, title, department_id, category, description, expected_impact, tags, bottleneck_id, submitter_name, total_votes, dept_votes, is_locked, is_selected, status, created_at)
        SELECT id, poll_id, title, department_id, category, description, expected_impact, tags, bottleneck_id, submitter_name, total_votes, dept_votes, is_locked, is_selected, status, created_at FROM ideas;
        DROP TABLE ideas;
        ALTER TABLE ideas_migration RENAME TO ideas;
      `);
      console.log('[Database] Migrated ideas table to support Selected status');
    }
  } catch(err) {
    console.error('[Database] Ideas migration note:', err.message);
  }

  // Clean up any corrupt emojis in departments
  const deptIcons = {
    'ACC': '💰', 'SAL': '💼', 'OPS': '⚙️', 'HR': '👥', 'TECH': '💻', 'MKT': '📣',
    'PUR': '📦', 'QC': '🔍', 'LEGAL': '⚖️', 'EXEC': '🏛️', 'CS': '🎧', 'RD': '🔬', 'WH': '🏭'
  };
  for (const [code, icon] of Object.entries(deptIcons)) {
    try {
      db.prepare("UPDATE departments SET icon = ? WHERE code = ? AND (icon LIKE '%?%' OR icon = '')").run(icon, code);
    } catch(e) {}
  }
  // Set default plain_preview for Primary Admin if null
  try {
    db.prepare("UPDATE admin_passwords SET plain_preview = 'admin123' WHERE plain_preview IS NULL AND admin_name = 'Primary Administrator'").run();
  } catch(e) {}

  seedData();
  saveDb();
  return db;
}

function seedData() {
  // 1. Admin Password: admin123
  const adminRow = db.prepare('SELECT COUNT(*) as count FROM admin_passwords').get();
  if (!adminRow || adminRow.count === 0) {
    const defaultHash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admin_passwords (admin_name, password_hash, permissions, plain_preview) VALUES (?, ?, ?, ?)').run(
      'Primary Administrator',
      defaultHash,
      'all',
      'admin123'
    );
    console.log('[Database] Default Admin created. Initial password: admin123');
  }

  // 2. Departments
  const deptRow = db.prepare('SELECT COUNT(*) as count FROM departments').get();
  if (!deptRow || deptRow.count === 0) {
    const depts = [
      ['Accounts & Finance', 'ACC', '💰', '#2A6FA8'],
      ['Sales & BD', 'SAL', '💼', '#14B8A6'],
      ['Operations & Logistics', 'OPS', '⚙️', '#E67E22'],
      ['Human Resources (HR)', 'HR', '👥', '#8E44AD'],
      ['IT & Automation', 'TECH', '💻', '#2980B9'],
      ['Marketing & Design', 'MKT', '📣', '#D35400']
    ];
    const ins = db.prepare('INSERT INTO departments (name, code, icon, color) VALUES (?, ?, ?, ?)');
    depts.forEach(d => ins.run(d));
    console.log('[Database] Seeded 6 departments');
  }

  // 3. Team Members
  const memberRow = db.prepare('SELECT COUNT(*) as count FROM team_members').get();
  if (!memberRow || memberRow.count === 0) {
    const members = [
      ['Rahul Sharma', 1, 'Senior Accountant'],
      ['Priya Kapoor', 2, 'Sales Executive'],
      ['Vikram Singh', 3, 'Dispatch Lead'],
      ['Neha Gupta', 4, 'HR Manager'],
      ['Aman Verma', 5, 'Automation Specialist'],
      ['Sunita Das', 1, 'Accounts Assistant']
    ];
    const ins = db.prepare('INSERT INTO team_members (name, department_id, role_title) VALUES (?, ?, ?)');
    members.forEach(m => ins.run(m));
  }

  // 4. Voting Poll
  const pollRow = db.prepare('SELECT COUNT(*) as count FROM voting_polls').get();
  if (!pollRow || pollRow.count === 0) {
    db.prepare(`
      INSERT INTO voting_polls (title, description, is_active)
      VALUES (?, ?, ?)
    `).run(
      'September 2026 Innovation Poll',
      'Vote for the best automation and growth ideas. Highest voted ideas per department will be implemented!',
      1
    );
  }

  // 5. Links
  const linkRow = db.prepare('SELECT COUNT(*) as count FROM links').get();
  if (!linkRow || linkRow.count === 0) {
    const sampleLinks = [
      ['Vendor Payment Request Form', 'https://forms.google.com', 'form', 1, 'accounts,payments,approval', '📝'],
      ['Tally Prime Web Gateway', 'https://tallysolutions.com', 'platform', 1, 'gst,ledger,billing', '📊'],
      ['Courier & Dispatch Tracking', 'https://shiprocket.in', 'tool', 3, 'operations,dispatch,awb', '🚚'],
      ['Employee Leave & Attendance', 'https://hrms.hallstatt.co.in', 'platform', 4, 'hr,payroll,leave', '👥'],
      ['CRM Leads & Pipeline', 'https://zoho.com/crm', 'platform', 2, 'sales,leads,pipeline', '💼'],
      ['IT Helpdesk Ticket Portal', 'https://support.google.com', 'form', 5, 'it,support,bugs', '⚙️']
    ];
    const ins = db.prepare('INSERT INTO links (title, url, category, department_id, tags, icon) VALUES (?, ?, ?, ?, ?, ?)');
    sampleLinks.forEach(l => ins.run(l));
  }

  // 6. Announcements
  const annRow = db.prepare('SELECT COUNT(*) as count FROM announcements').get();
  if (!annRow || annRow.count === 0) {
    db.prepare(`
      INSERT INTO announcements (title, content, priority, is_pinned, tags)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      '🚨 New GST E-Invoicing & Automated Tally Sync Active',
      'All Accounts and Billing executives must use the automated sync utility starting this Friday. Review the SOP guide in Links directory.',
      'Urgent',
      1,
      'gst,tally,sop'
    );
    db.prepare(`
      INSERT INTO announcements (title, content, priority, is_pinned, tags)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      '🎉 Congratulations to Operations Team for Zero Dispatch Delays',
      'Operations achieved 100% on-time dispatch SLAs across 1,200 shipments this past month. Outstanding effort!',
      'Milestone',
      0,
      'celebration,operations'
    );
  }

  // 7. Bottlenecks (Clean slate - no dummy records)
  // 8. Ideas (Clean slate - no dummy records)
  // 9. Chat (Clean slate - no dummy records)
}

function clearDemoData() {
  db.exec(`
    DELETE FROM bottlenecks;
    DELETE FROM votes;
    DELETE FROM ideas;
    DELETE FROM chat_messages;
    DELETE FROM sqlite_sequence WHERE name IN ('bottlenecks', 'ideas', 'votes', 'chat_messages');
  `);
  saveDb();
  console.log('[Database] Cleared all demo bottlenecks, ideas, votes, and chat messages.');
}

module.exports = {
  db,
  initDatabase,
  saveDb,
  clearDemoData
};
