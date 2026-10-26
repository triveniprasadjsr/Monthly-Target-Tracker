import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'accounts_db.json');

interface StoredDashboard {
  profile: {
    mainName: string;
    surname: string;
    email: string;
    phone: string;
    photo: string;
  };
  tasks: string[];
  activeTask: string;
  currentYear: number;
  currentMonth: number;
  selectedDay: number;
  records: Record<string, { status: string | null; note: string }>;
  calendarNotes?: unknown[];
  calendarExpenditures?: unknown[];
  updatedAt: number;
}

interface StoredAccount {
  uid: string;
  email: string;
  passwordSalt: string;
  passwordHash: string;
  token: string;
  dashboard: StoredDashboard;
}

interface DatabaseSchema {
  accountsByEmail: Record<string, StoredAccount>;
}

function ensureDb(): DatabaseSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial: DatabaseSchema = { accountsByEmail: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as DatabaseSchema;
  } catch {
    return { accountsByEmail: {} };
  }
}

function saveDb(dbData: DatabaseSchema): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

async function startServer() {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });
  app.get('/google6058ee555355a0f6.html', (_req, res) => {
    res
      .status(200)
      .type('text/html')
      .send('google-site-verification: google6058ee555355a0f6.html');
  });
  app.use(express.json({ limit: '5mb' }));

  // POST /api/auth/signup - Email & Password registration with separate dashboard storage
  app.post('/api/auth/signup', (req, res) => {
    const { email, password, mainName, surname, phone, photo } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const rawPassword = String(password || '');

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (rawPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const dbData = ensureDb();
    if (dbData.accountsByEmail[cleanEmail]) {
      res.status(409).json({
        error: 'An account with this email already exists. Please sign in instead.',
      });
      return;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(rawPassword, salt);
    const token = crypto.randomBytes(32).toString('hex');
    const uid = `usr_${crypto.randomBytes(10).toString('hex')}`;

    const dashboard: StoredDashboard = {
      profile: {
        mainName: String(mainName || 'XXX').trim() || 'XXX',
        surname: String(surname || 'YYY').trim() || 'YYY',
        email: cleanEmail,
        phone: String(phone || '+91 98765 43210').trim() || '+91 98765 43210',
        photo: String(photo || ''),
      },
      tasks: ['General'],
      activeTask: 'General',
      currentYear: 2026,
      currentMonth: 9,
      selectedDay: 25,
      records: {},
      calendarNotes: [],
      calendarExpenditures: [],
      updatedAt: Date.now(),
    };

    dbData.accountsByEmail[cleanEmail] = {
      uid,
      email: cleanEmail,
      passwordSalt: salt,
      passwordHash,
      token,
      dashboard,
    };
    saveDb(dbData);

    res.json({
      uid,
      email: cleanEmail,
      token,
      dashboard,
    });
  });

  // POST /api/auth/signin - Email & Password login returning the user's saved dashboard
  app.post('/api/auth/signin', (req, res) => {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const rawPassword = String(password || '');

    if (!cleanEmail || !rawPassword) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const dbData = ensureDb();
    const account = dbData.accountsByEmail[cleanEmail];
    if (!account) {
      res.status(404).json({
        error: 'No account found with this email address. Please Sign Up first.',
      });
      return;
    }

    const computedHash = hashPassword(rawPassword, account.passwordSalt);
    if (computedHash !== account.passwordHash) {
      res.status(401).json({
        error: 'Incorrect password. Please check your password and try again.',
      });
      return;
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    account.token = newToken;
    saveDb(dbData);

    res.json({
      uid: account.uid,
      email: account.email,
      token: newToken,
      dashboard: account.dashboard,
    });
  });

  // GET /api/dashboard - Restore session & load dashboard by Bearer token
  app.get('/api/dashboard', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      res.status(401).json({ error: 'Missing session token.' });
      return;
    }

    const dbData = ensureDb();
    const account = Object.values(dbData.accountsByEmail).find(
      (a) => a.token === token
    );
    if (!account) {
      res.status(401).json({ error: 'Invalid or expired session token.' });
      return;
    }

    res.json({
      uid: account.uid,
      email: account.email,
      dashboard: account.dashboard,
    });
  });

  // PUT /api/dashboard - Save updated dashboard for the authenticated account
  app.put('/api/dashboard', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      res.status(401).json({ error: 'Missing session token.' });
      return;
    }

    const dbData = ensureDb();
    const account = Object.values(dbData.accountsByEmail).find(
      (a) => a.token === token
    );
    if (!account) {
      res.status(401).json({ error: 'Invalid or expired session token.' });
      return;
    }

    const incoming = req.body?.dashboard;
    if (!incoming || typeof incoming !== 'object') {
      res.status(400).json({ error: 'Invalid dashboard payload.' });
      return;
    }

    account.dashboard = {
      profile: {
        mainName: String(incoming.profile?.mainName || 'XXX').trim().slice(0, 100) || 'XXX',
        surname: String(incoming.profile?.surname || 'YYY').trim().slice(0, 100) || 'YYY',
        email: String(incoming.profile?.email || account.email).trim().slice(0, 254),
        phone: String(incoming.profile?.phone || '+91 98765 43210').trim().slice(0, 40),
        photo: String(incoming.profile?.photo || '').slice(0, 50000),
      },
      tasks:
        Array.isArray(incoming.tasks) && incoming.tasks.length > 0
          ? incoming.tasks.map((t: unknown) => String(t).slice(0, 100)).slice(0, 50)
          : ['General'],
      activeTask: String(incoming.activeTask || 'General').slice(0, 100),
      currentYear: Number(incoming.currentYear) || 2026,
      currentMonth:
        typeof incoming.currentMonth === 'number' ? incoming.currentMonth : 9,
      selectedDay: Number(incoming.selectedDay) || 25,
      records:
        incoming.records && typeof incoming.records === 'object'
          ? incoming.records
          : {},
      calendarNotes: Array.isArray(incoming.calendarNotes)
        ? incoming.calendarNotes.slice(0, 2000)
        : account.dashboard.calendarNotes || [],
      calendarExpenditures: Array.isArray(incoming.calendarExpenditures)
        ? incoming.calendarExpenditures.slice(0, 2000)
        : account.dashboard.calendarExpenditures || [],
      updatedAt: Date.now(),
    };

    saveDb(dbData);
    res.json({ ok: true, dashboard: account.dashboard });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
