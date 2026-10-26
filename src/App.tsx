/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  generateSafeId,
  googleProvider,
  handleFirestoreError,
  OperationType,
  sanitizeString,
  testFirestoreConnection,
} from './lib/firebase';
import { ensureUserProfileDoc } from './services/firestoreService';
import {
  type CalendarExpenditureItem,
  type CalendarNoteItem,
  computeMonthCompletionPercentage,
  computeMonthlyExpenditureSummary,
  createCalendarExpenditureInFirestore,
  createCalendarNoteInFirestore,
  deleteCalendarExpenditureFromFirestore,
  deleteCalendarNoteFromFirestore,
  EXPENSE_CATEGORIES,
  formatFullDateDisplay,
  formatINR,
  getDailyExpenditureInfo,
  getExpendituresForDate,
  getNotesForDate,
  subscribeToUserExpenditures,
  subscribeToUserNotes,
  toDateKey,
  toMonthKey,
  updateCalendarExpenditureInFirestore,
  updateCalendarNoteInFirestore,
} from './services/calendarNotesExpenseService';
import { compressAvatarImageFile } from './utils/dateUtils';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Self-contained SVG data URI avatar presets
const PRESET_AVATARS = [
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0284c7"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="120" height="120" fill="url(#g1)"/><circle cx="60" cy="44" r="22" fill="#38bdf8"/><path d="M24 106c6-22 22-34 36-34s30 12 36 34" fill="#38bdf8"/></svg>`
  )}`,
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#059669"/><stop offset="100%" stop-color="#064e3b"/></linearGradient></defs><rect width="120" height="120" fill="url(#g2)"/><circle cx="60" cy="44" r="22" fill="#6ee7b7"/><path d="M24 106c6-22 22-34 36-34s30 12 36 34" fill="#6ee7b7"/></svg>`
  )}`,
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#1e1b4b"/></linearGradient></defs><rect width="120" height="120" fill="url(#g3)"/><circle cx="60" cy="44" r="22" fill="#a5b4fc"/><path d="M24 106c6-22 22-34 36-34s30 12 36 34" fill="#a5b4fc"/></svg>`
  )}`,
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g4" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d97706"/><stop offset="100%" stop-color="#451a03"/></linearGradient></defs><rect width="120" height="120" fill="url(#g4)"/><circle cx="60" cy="44" r="22" fill="#fde047"/><path d="M24 106c6-22 22-34 36-34s30 12 36 34" fill="#fde047"/></svg>`
  )}`,
];

type DayStatus = 'completed' | 'not_completed' | 'skipped' | null;

interface DayRecordEntry {
  status: DayStatus;
  note: string;
}

interface ProfileData {
  mainName: string;
  surname: string;
  email: string;
  phone: string;
  photo: string;
}

interface TrackerAppState {
  profile: ProfileData;
  tasks: string[];
  activeTask: string;
  currentYear: number;
  currentMonth: number; // 0 = Jan, 9 = October
  selectedDay: number;
  records: Record<string, DayRecordEntry>;
}

const DEFAULT_STATE: TrackerAppState = {
  profile: {
    mainName: 'XXX',
    surname: 'YYY',
    email: 'xxx.yyy@example.com',
    phone: '+91 98765 43210',
    photo: PRESET_AVATARS[0],
  },
  tasks: ['General'],
  activeTask: 'General',
  currentYear: 2026,
  currentMonth: 9, // October
  selectedDay: 25,
  records: {},
};

const SESSION_TOKEN_KEY = 'monthly_tracker_session_token';
const LOCAL_NOTES_KEY = 'monthly_tracker_notes_v1';
const LOCAL_EXPENDITURES_KEY = 'monthly_tracker_expenditures_v1';

function normalizeStatus(status: unknown): DayStatus {
  if (status === 'met' || status === 'completed') return 'completed';
  if (status === 'missed' || status === 'not_completed') return 'not_completed';
  if (status === 'skipped') return 'skipped';
  return null;
}

function getRecordKey(
  task: string,
  year: number,
  month: number,
  day: number
): string {
  return `${task}__${year}-${month}__${day}`;
}

function loadLocalNotes(): CalendarNoteItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_NOTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalNotes(notes: CalendarNoteItem[]): void {
  try {
    localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes));
  } catch {
    // Ignore storage quota errors
  }
}

function loadLocalExpenditures(): CalendarExpenditureItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_EXPENDITURES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalExpenditures(expenditures: CalendarExpenditureItem[]): void {
  try {
    localStorage.setItem(LOCAL_EXPENDITURES_KEY, JSON.stringify(expenditures));
  } catch {
    // Ignore storage quota errors
  }
}

function formatFirebaseAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('auth/email-already-in-use')) {
    return 'An account with this email already exists. Please switch to Sign In.';
  }
  if (
    raw.includes('auth/invalid-credential') ||
    raw.includes('auth/wrong-password') ||
    raw.includes('auth/user-not-found')
  ) {
    return 'Invalid email or password. Please check your credentials or Sign Up first.';
  }
  if (raw.includes('auth/invalid-email')) {
    return 'Please enter a valid email address.';
  }
  if (raw.includes('auth/weak-password')) {
    return 'Password must be at least 6 characters long.';
  }
  if (raw.includes('auth/too-many-requests')) {
    return 'Too many requests. Please wait a few minutes and try again.';
  }
  if (raw.includes('auth/unauthorized-domain')) {
    const currentHost =
      typeof window !== 'undefined' && window.location?.hostname
        ? window.location.hostname
        : 'your deployment domain';
    return `Domain "${currentHost}" is not authorized in Firebase Authentication. Add "${currentHost}" in Firebase Console (project: gen-lang-client-0267092221) → Authentication → Settings → Authorized domains.`;
  }
  if (raw.includes('auth/popup-blocked')) {
    return 'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
  }
  if (
    raw.includes('auth/popup-closed-by-user') ||
    raw.includes('auth/cancelled-popup-request')
  ) {
    return 'Google sign-in was cancelled before completion. Click "Continue with Google" to try again.';
  }
  if (raw.includes('auth/account-exists-with-different-credential')) {
    return 'An account already exists with this email using a different sign-in method. Please sign in with your email and password.';
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Network error while reaching the authentication service. Please check your internet connection and try again.';
  }
  if (raw.includes('Unexpected token')) {
    return 'Unable to reach authentication service. Please try again.';
  }
  return raw.replace(/^Firebase:\s*/i, '');
}

async function safeFetchJson(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { ok: false, status: res.status, data: null };
    }
    const text = await res.text();
    const data = JSON.parse(text) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export default function App() {
  const [appState, setAppState] = useState<TrackerAppState>(() =>
    JSON.parse(JSON.stringify(DEFAULT_STATE))
  );
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [backendSession, setBackendSession] = useState<{
    uid: string;
    email: string;
    token: string;
  } | null>(null);

  // Calendar Notes & Expenditures state
  const [calendarNotes, setCalendarNotes] = useState<CalendarNoteItem[]>(() =>
    loadLocalNotes()
  );
  const [calendarExpenditures, setCalendarExpenditures] = useState<
    CalendarExpenditureItem[]
  >(() => loadLocalExpenditures());

  // UI toggles & modal states
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  // Context Menu State for Calendar Date Right-Click / Long-Press / Menu Button
  const [contextMenu, setContextMenu] = useState<{
    day: number;
    dateKey: string;
    x: number;
    y: number;
  } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal: Add / Edit Note
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteTargetDay, setNoteTargetDay] = useState<number>(25);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteTitleInput, setNoteTitleInput] = useState('');
  const [noteDescInput, setNoteDescInput] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  // Modal: Add / Edit Expenditure
  const [expModalOpen, setExpModalOpen] = useState(false);
  const [expTargetDay, setExpTargetDay] = useState<number>(25);
  const [editingExpId, setEditingExpId] = useState<string | null>(null);
  const [expTitleInput, setExpTitleInput] = useState('');
  const [expAmountInput, setExpAmountInput] = useState('');
  const [expCategoryInput, setExpCategoryInput] = useState<string>('');
  const [expError, setExpError] = useState<string | null>(null);
  const [expSubmitting, setExpSubmitting] = useState(false);

  // Modal: View Date Details (Notes & Expenditures for Selected Date)
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [detailsTargetDay, setDetailsTargetDay] = useState<number>(25);
  const [detailsViewMode, setDetailsViewMode] = useState<
    'all' | 'notes' | 'expenditure'
  >('all');
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<{
    type: 'note' | 'expenditure';
    id: string;
    title: string;
  } | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);

  // Modal 0: Sign In / Sign Up / Forgot Password Modal
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [authMainName, setAuthMainName] = useState('XXX');
  const [authSurname] = useState('YYY');
  const [authPhone, setAuthPhone] = useState('+91 98765 43210');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [resetEmailInput, setResetEmailInput] = useState('');
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);

  // Modal 1: Edit Profile Modal
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editMainName, setEditMainName] = useState('XXX');
  const [editSurname, setEditSurname] = useState('YYY');
  const [editEmail, setEditEmail] = useState('xxx.yyy@example.com');
  const [editPhone, setEditPhone] = useState('+91 98765 43210');
  const [editPhotoUrl, setEditPhotoUrl] = useState('');
  const [editPhotoPreview, setEditPhotoPreview] = useState(PRESET_AVATARS[0]);

  // Modal 2: Add Task Modal
  const [addTaskModalOpen, setAddTaskModalOpen] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');

  // Toast Notification
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 2800);
  }, []);

  // Close context menu on outside click or Escape key
  useEffect(() => {
    if (!contextMenu) return;
    const handleGlobalClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // Save state to Cloud Firestore under users/{uid}/dashboard/main
  const saveDashboardToFirestore = useCallback(
    async (nextState: TrackerAppState, userOverride?: FirebaseUser | null) => {
      const targetUser = userOverride !== undefined ? userOverride : authUser;
      if (!targetUser) return;

      const uid = targetUser.uid;
      const docId = 'main';
      const path = `users/${uid}/dashboard/${docId}`;
      const docRef = doc(db, 'users', uid, 'dashboard', docId);

      const cleanTasks = (
        nextState.tasks.length > 0 ? nextState.tasks : ['General']
      )
        .map((t) => sanitizeString(t, 100) || 'General')
        .slice(0, 50);

      const cleanActiveTask = cleanTasks.includes(nextState.activeTask)
        ? nextState.activeTask
        : cleanTasks[0];

      const cleanRecords: Record<string, { status: DayStatus; note: string }> =
        {};
      const entries = Object.entries(nextState.records || {}).slice(0, 4500);
      for (const [k, v] of entries) {
        if (v && (v.status || v.note)) {
          cleanRecords[k] = {
            status: normalizeStatus(v.status),
            note: sanitizeString(v.note || '', 120),
          };
        }
      }

      const baseFields = {
        mainName:
          sanitizeString(nextState.profile.mainName || 'XXX', 100) || 'XXX',
        surname:
          sanitizeString(nextState.profile.surname || 'YYY', 100) || 'YYY',
        email:
          sanitizeString(
            nextState.profile.email ||
              targetUser.email ||
              'xxx.yyy@example.com',
            254
          ) || 'xxx.yyy@example.com',
        phone: sanitizeString(
          nextState.profile.phone || '+91 98765 43210',
          40
        ),
        photo: sanitizeString(
          nextState.profile.photo || PRESET_AVATARS[0],
          50000
        ),
        tasks: cleanTasks,
        activeTask: cleanActiveTask,
        currentYear: Math.max(
          1970,
          Math.min(2100, Number(nextState.currentYear) || 2026)
        ),
        currentMonth: Math.max(
          0,
          Math.min(11, Number(nextState.currentMonth) || 0)
        ),
        selectedDay: Math.max(
          1,
          Math.min(31, Number(nextState.selectedDay) || 1)
        ),
        records: cleanRecords,
        updatedAt: serverTimestamp(),
      };

      try {
        const existingSnap = await getDoc(docRef);
        if (existingSnap.exists()) {
          await updateDoc(docRef, baseFields);
        } else {
          await setDoc(docRef, {
            docId,
            uid,
            ...baseFields,
            createdAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [authUser]
  );

  // Save state to Backend Database (/api/dashboard) when available
  const saveDashboardToBackend = useCallback(
    async (
      nextState: TrackerAppState,
      notesOverride?: CalendarNoteItem[],
      expOverride?: CalendarExpenditureItem[],
      tokenOverride?: string
    ) => {
      const token = tokenOverride || backendSession?.token;
      if (!token) return;
      await safeFetchJson('/api/dashboard', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dashboard: {
            ...nextState,
            calendarNotes: notesOverride ?? calendarNotes,
            calendarExpenditures: expOverride ?? calendarExpenditures,
          },
        }),
      });
    },
    [backendSession?.token, calendarExpenditures, calendarNotes]
  );

  // Helper to update state and persist to active database(s)
  const updateStateAndPersist = useCallback(
    (updater: (prev: TrackerAppState) => TrackerAppState) => {
      setAppState((prev) => {
        const next = updater(prev);
        if (authUser) {
          saveDashboardToFirestore(next, authUser);
        }
        if (backendSession?.token) {
          saveDashboardToBackend(next, undefined, undefined, backendSession.token);
        }
        return next;
      });
    },
    [authUser, backendSession?.token, saveDashboardToBackend, saveDashboardToFirestore]
  );

  // Restore backend email/password session on boot if present and no Firebase user
  useEffect(() => {
    const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (!savedToken) return;

    safeFetchJson('/api/dashboard', {
      headers: { Authorization: `Bearer ${savedToken}` },
    }).then(({ ok, data }) => {
      if (ok && data && data.dashboard) {
        const d = data.dashboard as Record<string, any>;
        setBackendSession({
          uid: String(data.uid || ''),
          email: String(data.email || ''),
          token: savedToken,
        });
        setAppState({
          profile: {
            mainName: d.profile?.mainName || 'XXX',
            surname: d.profile?.surname || 'YYY',
            email:
              d.profile?.email || String(data.email || 'xxx.yyy@example.com'),
            phone: d.profile?.phone || '+91 98765 43210',
            photo: d.profile?.photo || PRESET_AVATARS[0],
          },
          tasks:
            Array.isArray(d.tasks) && d.tasks.length > 0
              ? d.tasks
              : ['General'],
          activeTask: d.activeTask || 'General',
          currentYear:
            typeof d.currentYear === 'number' ? d.currentYear : 2026,
          currentMonth:
            typeof d.currentMonth === 'number' ? d.currentMonth : 9,
          selectedDay:
            typeof d.selectedDay === 'number' ? d.selectedDay : 25,
          records: d.records && typeof d.records === 'object' ? d.records : {},
        });
        if (!auth?.currentUser) {
          if (Array.isArray(d.calendarNotes) && d.calendarNotes.length > 0) {
            setCalendarNotes(d.calendarNotes);
          }
          if (
            Array.isArray(d.calendarExpenditures) &&
            d.calendarExpenditures.length > 0
          ) {
            setCalendarExpenditures(d.calendarExpenditures);
          }
        }
      } else {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
    });
  }, []);

  // Subscribe to Firebase Auth & Cloud Firestore Dashboard + Notes + Expenditures
  useEffect(() => {
    testFirestoreConnection();

    // Handle redirect result if Google Sign-In fell back to signInWithRedirect on mobile/popup-blocked browsers
    if (auth) {
      getRedirectResult(auth)
        .then(async (result) => {
          if (result && result.user) {
            await ensureUserProfileDoc({
              uid: result.user.uid,
              displayName:
                result.user.displayName ||
                result.user.email?.split('@')[0] ||
                'User',
              email: result.user.email || '',
              phoneNumber: result.user.phoneNumber || '',
              photoURL: result.user.photoURL || '',
            });
            setBackendSession(null);
            sessionStorage.removeItem(SESSION_TOKEN_KEY);
            setAuthModalOpen(false);
            showToast(
              `Signed in with Google as ${
                result.user.displayName || result.user.email
              }`
            );
          }
        })
        .catch((err) => {
          const raw = err instanceof Error ? err.message : String(err);
          if (
            !raw.includes('auth/popup-closed-by-user') &&
            !raw.includes('auth/cancelled-popup-request')
          ) {
            setAuthError(formatFirebaseAuthError(err));
          }
        });
    }

    let unsubDashboard: (() => void) | null = null;
    let unsubNotes: (() => void) | null = null;
    let unsubExpenditures: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);

      if (unsubDashboard) {
        unsubDashboard();
        unsubDashboard = null;
      }
      if (unsubNotes) {
        unsubNotes();
        unsubNotes = null;
      }
      if (unsubExpenditures) {
        unsubExpenditures();
        unsubExpenditures = null;
      }

      if (!user) return;

      try {
        await ensureUserProfileDoc({
          uid: user.uid,
          displayName:
            user.displayName || user.email?.split('@')[0] || 'XXX',
          email: user.email || 'xxx.yyy@example.com',
          phoneNumber: user.phoneNumber || '+91 98765 43210',
          photoURL: user.photoURL || '',
        });

        const dashPath = `users/${user.uid}/dashboard/main`;
        const dashRef = doc(db, 'users', user.uid, 'dashboard', 'main');

        unsubDashboard = onSnapshot(
          dashRef,
          (snap) => {
            if (snap.exists()) {
              const data = snap.data();
              const loadedTasks =
                Array.isArray(data.tasks) && data.tasks.length > 0
                  ? (data.tasks as string[])
                  : ['General'];
              const loadedActive =
                typeof data.activeTask === 'string' &&
                loadedTasks.includes(data.activeTask)
                  ? data.activeTask
                  : loadedTasks[0];

              setAppState({
                profile: {
                  mainName: data.mainName || 'XXX',
                  surname: data.surname || 'YYY',
                  email: data.email || user.email || 'xxx.yyy@example.com',
                  phone: data.phone || '+91 98765 43210',
                  photo: data.photo || user.photoURL || PRESET_AVATARS[0],
                },
                tasks: loadedTasks,
                activeTask: loadedActive,
                currentYear:
                  typeof data.currentYear === 'number'
                    ? data.currentYear
                    : 2026,
                currentMonth:
                  typeof data.currentMonth === 'number' ? data.currentMonth : 9,
                selectedDay:
                  typeof data.selectedDay === 'number' ? data.selectedDay : 25,
                records:
                  data.records && typeof data.records === 'object'
                    ? (data.records as Record<string, DayRecordEntry>)
                    : {},
              });
            } else {
              const nameParts = (user.displayName || '').trim().split(/\s+/);
              const initialMainName = nameParts[0] || 'XXX';
              const initialSurname =
                nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'YYY';

              const initialState: TrackerAppState = {
                ...DEFAULT_STATE,
                profile: {
                  mainName: initialMainName,
                  surname: initialSurname,
                  email: user.email || 'xxx.yyy@example.com',
                  phone: user.phoneNumber || '+91 98765 43210',
                  photo: user.photoURL || PRESET_AVATARS[0],
                },
              };
              setAppState(initialState);
              saveDashboardToFirestore(initialState, user);
            }
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, dashPath);
          }
        );

        // Subscribe to user's private Calendar Notes & Expenditures in Firestore
        unsubNotes = subscribeToUserNotes(user.uid, (notesList) => {
          setCalendarNotes(notesList);
          saveLocalNotes(notesList);
        });

        unsubExpenditures = subscribeToUserExpenditures(
          user.uid,
          (expList) => {
            setCalendarExpenditures(expList);
            saveLocalExpenditures(expList);
          }
        );
      } catch (err) {
        console.error('Auth/Dashboard initialization error:', err);
      }
    });

    return () => {
      unsubAuth();
      if (unsubDashboard) unsubDashboard();
      if (unsubNotes) unsubNotes();
      if (unsubExpenditures) unsubExpenditures();
    };
  }, [saveDashboardToFirestore]);

  // Compute stats for a given task/year/month:
  // Percentage calculation is based upon ALL dates of the month.
  // Only Green ('completed') is considered completed; Red, Yellow (Skipped), and Unmarked are unconsidered.
  const getTaskMonthStats = useCallback(
    (taskName: string, year: number, month: number) => {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      let completed = 0;
      let notCompleted = 0;
      let skipped = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const key = getRecordKey(taskName, year, month, d);
        const status = normalizeStatus(appState.records[key]?.status);
        if (status === 'completed') completed++;
        else if (status === 'not_completed') notCompleted++;
        else if (status === 'skipped') skipped++;
      }

      const rate = computeMonthCompletionPercentage(completed, year, month);
      return { completed, notCompleted, skipped, rate, daysInMonth };
    },
    [appState.records]
  );

  const activeStats = getTaskMonthStats(
    appState.activeTask,
    appState.currentYear,
    appState.currentMonth
  );

  // Recalculate Monthly Expenditure Summary from saved expenditure records for the active month & year
  const monthlyExpSummary = useMemo(
    () =>
      computeMonthlyExpenditureSummary(
        calendarExpenditures,
        appState.currentYear,
        appState.currentMonth
      ),
    [calendarExpenditures, appState.currentYear, appState.currentMonth]
  );

  let totalCompletedAllTime = 0;
  Object.values(appState.records).forEach((r) => {
    if (r && normalizeStatus(r.status) === 'completed') {
      totalCompletedAllTime++;
    }
  });

  // Click Circular Date to Cycle Status:
  // Unmarked -> Completed (Green) -> Not Completed (Red) -> Skipped (Yellow) -> Unmarked
  const handleDayCellClick = (dayNumber: number) => {
    updateStateAndPersist((prev) => {
      const key = getRecordKey(
        prev.activeTask,
        prev.currentYear,
        prev.currentMonth,
        dayNumber
      );
      const existing = prev.records[key] || { status: null, note: '' };
      const currentStatus = normalizeStatus(existing.status);

      let nextStatus: DayStatus = null;
      if (!currentStatus) nextStatus = 'completed';
      else if (currentStatus === 'completed') nextStatus = 'not_completed';
      else if (currentStatus === 'not_completed') nextStatus = 'skipped';
      else nextStatus = null;

      const nextRecords = { ...prev.records };
      if (!nextStatus && !existing.note) {
        delete nextRecords[key];
      } else {
        nextRecords[key] = { ...existing, status: nextStatus };
      }

      return {
        ...prev,
        selectedDay: dayNumber,
        records: nextRecords,
      };
    });
  };

  // Context Menu Helpers (Desktop Right-Click, Mobile Long-Press / Menu Icon, Keyboard)
  const openContextMenuAt = useCallback(
    (dayNumber: number, clientX: number, clientY: number) => {
      const menuWidth = 196;
      const menuHeight = 148;
      const clampedX = Math.max(
        8,
        Math.min(clientX, window.innerWidth - menuWidth - 8)
      );
      const clampedY = Math.max(
        8,
        Math.min(clientY, window.innerHeight - menuHeight - 8)
      );
      const dateKey = toDateKey(
        appState.currentYear,
        appState.currentMonth,
        dayNumber
      );
      setAppState((prev) => ({ ...prev, selectedDay: dayNumber }));
      setContextMenu({
        day: dayNumber,
        dateKey,
        x: clampedX,
        y: clampedY,
      });
    },
    [appState.currentMonth, appState.currentYear]
  );

  const handleCellContextMenu = (
    e: React.MouseEvent<HTMLDivElement>,
    dayNumber: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenuAt(dayNumber, e.clientX, e.clientY);
  };

  const handleCellTouchStart = (
    e: React.TouchEvent<HTMLDivElement>,
    dayNumber: number
  ) => {
    const touch = e.touches[0];
    if (!touch) return;
    const x = touch.clientX;
    const y = touch.clientY;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      openContextMenuAt(dayNumber, x, y);
    }, 450);
  };

  const handleCellTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    dayNumber: number
  ) => {
    if (e.key === 'ContextMenu' || (e.key === 'Enter' && e.shiftKey) || e.key === 'm') {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      openContextMenuAt(dayNumber, rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleDayCellClick(dayNumber);
    }
  };

  // Open Modals for Selected Day
  const openAddNoteModal = (dayNumber: number, noteToEdit?: CalendarNoteItem) => {
    setContextMenu(null);
    setNoteTargetDay(dayNumber);
    setNoteError(null);
    if (noteToEdit) {
      setEditingNoteId(noteToEdit.noteId);
      setNoteTitleInput(noteToEdit.title);
      setNoteDescInput(noteToEdit.description);
    } else {
      setEditingNoteId(null);
      setNoteTitleInput('');
      setNoteDescInput('');
    }
    setNoteModalOpen(true);
  };

  const openAddExpenditureModal = (
    dayNumber: number,
    expToEdit?: CalendarExpenditureItem
  ) => {
    setContextMenu(null);
    setExpTargetDay(dayNumber);
    setExpError(null);
    if (expToEdit) {
      setEditingExpId(expToEdit.expenditureId);
      setExpTitleInput(expToEdit.title);
      setExpAmountInput(String(expToEdit.amount));
      setExpCategoryInput(expToEdit.category || '');
    } else {
      setEditingExpId(null);
      setExpTitleInput('');
      setExpAmountInput('');
      setExpCategoryInput('');
    }
    setExpModalOpen(true);
  };

  const openViewDetailsModal = (
    dayNumber: number,
    mode: 'all' | 'notes' | 'expenditure' = 'all'
  ) => {
    setContextMenu(null);
    setDetailsTargetDay(dayNumber);
    setDetailsViewMode(mode);
    setConfirmDeleteTarget(null);
    setDetailsModalOpen(true);
  };

  // Save Note (Create or Update)
  const handleSaveNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (noteSubmitting) return;

    const cleanTitle = noteTitleInput.trim();
    const cleanDesc = noteDescInput.trim();

    if (!cleanTitle) {
      setNoteError('Please enter a note title.');
      return;
    }

    setNoteError(null);
    setNoteSubmitting(true);
    const dateKey = toDateKey(
      appState.currentYear,
      appState.currentMonth,
      noteTargetDay
    );

    try {
      if (authUser) {
        await ensureUserProfileDoc({
          uid: authUser.uid,
          displayName:
            authUser.displayName || appState.profile.mainName || 'XXX',
          email:
            authUser.email || appState.profile.email || 'xxx.yyy@example.com',
          phoneNumber:
            authUser.phoneNumber || appState.profile.phone || '+91 98765 43210',
          photoURL: authUser.photoURL || '',
        });

        const nowIso = new Date().toISOString();
        if (editingNoteId) {
          await updateCalendarNoteInFirestore(authUser.uid, editingNoteId, {
            title: cleanTitle,
            description: cleanDesc,
          });
          setCalendarNotes((prev) => {
            const nextNotes = prev.map((n) =>
              n.noteId === editingNoteId
                ? {
                    ...n,
                    title: cleanTitle,
                    description: cleanDesc,
                    updatedAt: nowIso,
                  }
                : n
            );
            saveLocalNotes(nextNotes);
            if (backendSession?.token) {
              saveDashboardToBackend(appState, nextNotes, calendarExpenditures);
            }
            return nextNotes;
          });
          showToast('Note updated!');
        } else {
          const createdNote = await createCalendarNoteInFirestore(authUser.uid, {
            date: dateKey,
            title: cleanTitle,
            description: cleanDesc,
          });
          setCalendarNotes((prev) => {
            const exists = prev.some((n) => n.noteId === createdNote.noteId);
            const nextNotes = exists
              ? prev.map((n) =>
                  n.noteId === createdNote.noteId ? createdNote : n
                )
              : [...prev, createdNote];
            saveLocalNotes(nextNotes);
            if (backendSession?.token) {
              saveDashboardToBackend(appState, nextNotes, calendarExpenditures);
            }
            return nextNotes;
          });
          showToast('Note saved!');
        }
      } else {
        const nowIso = new Date().toISOString();
        let nextNotes: CalendarNoteItem[];
        if (editingNoteId) {
          nextNotes = calendarNotes.map((n) =>
            n.noteId === editingNoteId
              ? {
                  ...n,
                  title: cleanTitle,
                  description: cleanDesc,
                  updatedAt: nowIso,
                }
              : n
          );
          showToast('Note updated!');
        } else {
          const newItem: CalendarNoteItem = {
            noteId: generateSafeId('note'),
            uid: backendSession?.uid || 'guest',
            date: dateKey,
            title: cleanTitle,
            description: cleanDesc,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          nextNotes = [...calendarNotes, newItem];
          showToast('Note saved!');
        }
        setCalendarNotes(nextNotes);
        saveLocalNotes(nextNotes);
        if (backendSession?.token) {
          await saveDashboardToBackend(appState, nextNotes, calendarExpenditures);
        }
      }
      setNoteModalOpen(false);
    } catch (err) {
      setNoteError(
        err instanceof Error ? err.message : 'Failed to save note. Please try again.'
      );
    } finally {
      setNoteSubmitting(false);
    }
  };

  // Save Expenditure (Create or Update)
  const handleSaveExpenditureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (expSubmitting) return;

    const cleanTitle = expTitleInput.trim();
    const rawAmountStr = expAmountInput.trim();

    if (!cleanTitle) {
      setExpError('Please enter an expenditure title or description.');
      return;
    }
    if (rawAmountStr === '') {
      setExpError('Please enter an amount in Indian Rupees (₹).');
      return;
    }

    const parsedAmount = Number(rawAmountStr);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setExpError('Please enter a valid non-negative amount (0 or greater).');
      return;
    }
    if (parsedAmount > 100000000) {
      setExpError('Amount cannot exceed ₹10,00,00,000.');
      return;
    }

    const roundedAmount = Math.round(parsedAmount * 100) / 100;
    const cleanCategory = expCategoryInput.trim();

    setExpError(null);
    setExpSubmitting(true);
    const dateKey = toDateKey(
      appState.currentYear,
      appState.currentMonth,
      expTargetDay
    );
    const monthKey = toMonthKey(appState.currentYear, appState.currentMonth);

    try {
      if (authUser) {
        await ensureUserProfileDoc({
          uid: authUser.uid,
          displayName:
            authUser.displayName || appState.profile.mainName || 'XXX',
          email:
            authUser.email || appState.profile.email || 'xxx.yyy@example.com',
          phoneNumber:
            authUser.phoneNumber || appState.profile.phone || '+91 98765 43210',
          photoURL: authUser.photoURL || '',
        });

        const nowIso = new Date().toISOString();
        if (editingExpId) {
          await updateCalendarExpenditureInFirestore(authUser.uid, editingExpId, {
            title: cleanTitle,
            amount: roundedAmount,
            category: cleanCategory,
          });
          setCalendarExpenditures((prev) => {
            const nextExp = prev.map((item) =>
              item.expenditureId === editingExpId
                ? {
                    ...item,
                    title: cleanTitle,
                    amount: roundedAmount,
                    category: cleanCategory,
                    updatedAt: nowIso,
                  }
                : item
            );
            saveLocalExpenditures(nextExp);
            if (backendSession?.token) {
              saveDashboardToBackend(appState, calendarNotes, nextExp);
            }
            return nextExp;
          });
          showToast('Expenditure updated!');
        } else {
          const createdExp = await createCalendarExpenditureInFirestore(
            authUser.uid,
            {
              date: dateKey,
              title: cleanTitle,
              amount: roundedAmount,
              category: cleanCategory,
            }
          );
          setCalendarExpenditures((prev) => {
            const exists = prev.some(
              (item) => item.expenditureId === createdExp.expenditureId
            );
            const nextExp = exists
              ? prev.map((item) =>
                  item.expenditureId === createdExp.expenditureId
                    ? createdExp
                    : item
                )
              : [...prev, createdExp];
            saveLocalExpenditures(nextExp);
            if (backendSession?.token) {
              saveDashboardToBackend(appState, calendarNotes, nextExp);
            }
            return nextExp;
          });
          showToast(`Expenditure of ${formatINR(roundedAmount)} saved!`);
        }
      } else {
        const nowIso = new Date().toISOString();
        let nextExp: CalendarExpenditureItem[];
        if (editingExpId) {
          nextExp = calendarExpenditures.map((item) =>
            item.expenditureId === editingExpId
              ? {
                  ...item,
                  title: cleanTitle,
                  amount: roundedAmount,
                  category: cleanCategory,
                  updatedAt: nowIso,
                }
              : item
          );
          showToast('Expenditure updated!');
        } else {
          const newItem: CalendarExpenditureItem = {
            expenditureId: generateSafeId('exp'),
            uid: backendSession?.uid || 'guest',
            date: dateKey,
            monthKey,
            title: cleanTitle,
            amount: roundedAmount,
            category: cleanCategory,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          nextExp = [...calendarExpenditures, newItem];
          showToast(`Expenditure of ${formatINR(roundedAmount)} saved!`);
        }
        setCalendarExpenditures(nextExp);
        saveLocalExpenditures(nextExp);
        if (backendSession?.token) {
          await saveDashboardToBackend(appState, calendarNotes, nextExp);
        }
      }
      setExpModalOpen(false);
    } catch (err) {
      setExpError(
        err instanceof Error
          ? err.message
          : 'Failed to save expenditure. Please try again.'
      );
    } finally {
      setExpSubmitting(false);
    }
  };

  // Confirmed Delete of Note or Expenditure
  const handleConfirmDeleteItem = async () => {
    if (!confirmDeleteTarget || deletingItem) return;
    setDeletingItem(true);
    try {
      if (confirmDeleteTarget.type === 'note') {
        if (authUser) {
          await deleteCalendarNoteFromFirestore(
            authUser.uid,
            confirmDeleteTarget.id
          );
          setCalendarNotes((prev) => {
            const nextNotes = prev.filter(
              (n) => n.noteId !== confirmDeleteTarget.id
            );
            saveLocalNotes(nextNotes);
            if (backendSession?.token) {
              saveDashboardToBackend(
                appState,
                nextNotes,
                calendarExpenditures
              );
            }
            return nextNotes;
          });
        } else {
          const nextNotes = calendarNotes.filter(
            (n) => n.noteId !== confirmDeleteTarget.id
          );
          setCalendarNotes(nextNotes);
          saveLocalNotes(nextNotes);
          if (backendSession?.token) {
            await saveDashboardToBackend(
              appState,
              nextNotes,
              calendarExpenditures
            );
          }
        }
        showToast('Note deleted.');
      } else {
        if (authUser) {
          await deleteCalendarExpenditureFromFirestore(
            authUser.uid,
            confirmDeleteTarget.id
          );
          setCalendarExpenditures((prev) => {
            const nextExp = prev.filter(
              (e) => e.expenditureId !== confirmDeleteTarget.id
            );
            saveLocalExpenditures(nextExp);
            if (backendSession?.token) {
              saveDashboardToBackend(appState, calendarNotes, nextExp);
            }
            return nextExp;
          });
        } else {
          const nextExp = calendarExpenditures.filter(
            (e) => e.expenditureId !== confirmDeleteTarget.id
          );
          setCalendarExpenditures(nextExp);
          saveLocalExpenditures(nextExp);
          if (backendSession?.token) {
            await saveDashboardToBackend(appState, calendarNotes, nextExp);
          }
        }
        showToast('Expenditure deleted.');
      }
      setConfirmDeleteTarget(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to delete entry.'
      );
    } finally {
      setDeletingItem(false);
    }
  };

  // Month & Year Navigation
  const changeMonth = (delta: number) => {
    setContextMenu(null);
    updateStateAndPersist((prev) => {
      let newMonth = prev.currentMonth + delta;
      let newYear = prev.currentYear;
      if (newMonth < 0) {
        newMonth = 11;
        newYear--;
      } else if (newMonth > 11) {
        newMonth = 0;
        newYear++;
      }
      const maxDays = new Date(newYear, newMonth + 1, 0).getDate();
      const selectedDay =
        prev.selectedDay > maxDays ? maxDays : prev.selectedDay;
      return {
        ...prev,
        currentMonth: newMonth,
        currentYear: newYear,
        selectedDay,
      };
    });
  };

  const changeYear = (delta: number) => {
    setContextMenu(null);
    updateStateAndPersist((prev) => ({
      ...prev,
      currentYear: prev.currentYear + delta,
    }));
  };

  const jumpToOct2026 = () => {
    setMonthPickerOpen(false);
    setContextMenu(null);
    updateStateAndPersist((prev) => ({
      ...prev,
      currentYear: 2026,
      currentMonth: 9,
      selectedDay: 25,
    }));
  };

  // Task Selection, Addition & Deletion
  const selectTask = (taskName: string) => {
    updateStateAndPersist((prev) => ({
      ...prev,
      activeTask: taskName,
    }));
  };

  const handleAddTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = newTaskName.trim();
    if (!val) return;
    updateStateAndPersist((prev) => {
      const nextTasks = prev.tasks.includes(val)
        ? prev.tasks
        : [...prev.tasks, val];
      return {
        ...prev,
        tasks: nextTasks,
        activeTask: val,
      };
    });
    setNewTaskName('');
    setAddTaskModalOpen(false);
    showToast(`Task "${val}" created & saved!`);
  };

  const deleteTask = (taskName: string) => {
    if (appState.tasks.length <= 1) return;
    updateStateAndPersist((prev) => {
      const nextTasks = prev.tasks.filter((t) => t !== taskName);
      const nextActive =
        prev.activeTask === taskName ? nextTasks[0] : prev.activeTask;
      return {
        ...prev,
        tasks: nextTasks,
        activeTask: nextActive,
      };
    });
    showToast(`Task "${taskName}" removed.`);
  };

  // Profile Modal & Photo Upload Handlers
  const openProfileModal = () => {
    const p = appState.profile;
    setEditMainName(p.mainName || 'XXX');
    setEditSurname(p.surname || 'YYY');
    setEditEmail(p.email || 'xxx.yyy@example.com');
    setEditPhone(p.phone || '+91 98765 43210');
    setEditPhotoUrl(p.photo.startsWith('data:') ? '' : p.photo);
    setEditPhotoPreview(p.photo || PRESET_AVATARS[0]);
    setProfileModalOpen(true);
  };

  const handlePhotoFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressAvatarImageFile(file);
      setEditPhotoPreview(compressed);
      updateStateAndPersist((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          photo: compressed,
        },
      }));
      showToast('Profile photo updated & saved!');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not process image.'
      );
    }
  };

  const selectPresetAvatar = (url: string) => {
    setEditPhotoPreview(url);
    setEditPhotoUrl('');
    updateStateAndPersist((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        photo: url,
      },
    }));
  };

  const saveProfileChanges = (e: React.FormEvent) => {
    e.preventDefault();
    const mainName = editMainName.trim() || 'XXX';
    const surname = editSurname.trim() || 'YYY';
    const email = editEmail.trim() || 'xxx.yyy@example.com';
    const phone = editPhone.trim() || '+91 98765 43210';
    const customUrl = editPhotoUrl.trim();
    const finalPhoto = customUrl || editPhotoPreview || appState.profile.photo;

    updateStateAndPersist((prev) => ({
      ...prev,
      profile: {
        mainName,
        surname,
        email,
        phone,
        photo: finalPhoto,
      },
    }));
    setProfileModalOpen(false);
    showToast('Profile saved!');
  };

  const copyProfileField = (type: 'email' | 'phone') => {
    const text =
      type === 'email' ? appState.profile.email : appState.profile.phone;
    navigator.clipboard?.writeText(text).catch(() => {});
    showToast(`Copied ${type === 'email' ? 'Email' : 'Phone Number'}!`);
  };

  // Authentication Handlers (Google Sign-In + Firebase Email & Password Sign Up / Sign In + Password Recovery)
  const migrateGuestDataToFirestore = async (uid: string) => {
    const guestNotes = calendarNotes.filter((n) => n.uid === 'guest');
    for (const gn of guestNotes) {
      await createCalendarNoteInFirestore(uid, {
        date: gn.date,
        title: gn.title,
        description: gn.description,
      }).catch(() => {});
    }
    const guestExps = calendarExpenditures.filter((x) => x.uid === 'guest');
    for (const ge of guestExps) {
      await createCalendarExpenditureInFirestore(uid, {
        date: ge.date,
        title: ge.title,
        amount: ge.amount,
        category: ge.category,
      }).catch(() => {});
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setResetSuccessMsg(null);
    if (!auth) {
      setAuthError(
        'Firebase Authentication is not configured. Please check your Firebase configuration.'
      );
      return;
    }
    setAuthSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserProfileDoc({
        uid: cred.user.uid,
        displayName:
          cred.user.displayName || cred.user.email?.split('@')[0] || 'User',
        email: cred.user.email || '',
        phoneNumber: cred.user.phoneNumber || '',
        photoURL: cred.user.photoURL || '',
      });
      await migrateGuestDataToFirestore(cred.user.uid);
      setBackendSession(null);
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      setAuthModalOpen(false);
      showToast(
        `Signed in with Google as ${cred.user.displayName || cred.user.email}`
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // If browser blocks popups (e.g. mobile in-app browsers on Vercel), fall back to signInWithRedirect
      if (
        raw.includes('auth/popup-blocked') ||
        raw.includes('auth/operation-not-supported-in-this-environment')
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          setAuthError(formatFirebaseAuthError(redirectErr));
        }
      } else {
        setAuthError(formatFirebaseAuthError(err));
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setResetSuccessMsg(null);

    const cleanEmail = resetEmailInput.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setAuthError('Please enter a valid registered email address.');
      return;
    }
    if (!auth) {
      setAuthError(
        'Authentication service is not configured. Please verify your Firebase settings.'
      );
      return;
    }

    setAuthSubmitting(true);
    try {
      const continueUrl =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : undefined;
      try {
        if (continueUrl) {
          await sendPasswordResetEmail(auth, cleanEmail, {
            url: continueUrl,
            handleCodeInApp: false,
          });
        } else {
          await sendPasswordResetEmail(auth, cleanEmail);
        }
      } catch (innerErr) {
        const innerMsg =
          innerErr instanceof Error ? innerErr.message : String(innerErr);
        // If custom domain is not yet in Firebase Authorized Domains for continueUrl, fall back to default Firebase reset email
        if (
          innerMsg.includes('auth/unauthorized-continue-uri') ||
          innerMsg.includes('auth/invalid-continue-uri') ||
          innerMsg.includes('auth/missing-continue-uri')
        ) {
          await sendPasswordResetEmail(auth, cleanEmail);
        } else {
          throw innerErr;
        }
      }

      setResetSuccessMsg(
        `If an account is registered with ${cleanEmail}, a password reset link has been sent. Please check your inbox and spam folder.`
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Do not reveal whether a particular email address is registered
      if (raw.includes('auth/user-not-found')) {
        setResetSuccessMsg(
          `If an account is registered with ${cleanEmail}, a password reset link has been sent. Please check your inbox and spam folder.`
        );
      } else {
        setAuthError(formatFirebaseAuthError(err));
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setResetSuccessMsg(null);
    const cleanEmail = authEmail.trim().toLowerCase();
    if (!cleanEmail || !authPassword) {
      setAuthError('Please enter both your email address and password.');
      return;
    }
    if (authPassword.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    setAuthSubmitting(true);
    try {
      const mName = authMainName.trim() || 'XXX';
      const sName = authSurname.trim() || 'YYY';
      const phoneVal = authPhone.trim() || '+91 98765 43210';

      // 1. Primary Authentication: Firebase Authentication + Cloud Firestore
      if (authTab === 'signup') {
        const cred = await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          authPassword
        );
        await updateProfile(cred.user, {
          displayName: mName,
        }).catch(() => {});

        await ensureUserProfileDoc({
          uid: cred.user.uid,
          displayName: mName,
          email: cleanEmail,
          phoneNumber: phoneVal,
          photoURL: PRESET_AVATARS[0],
        });

        const initialDashboardState: TrackerAppState = {
          ...appState,
          profile: {
            mainName: mName,
            surname: sName,
            email: cleanEmail,
            phone: phoneVal,
            photo: appState.profile.photo || PRESET_AVATARS[0],
          },
        };
        setAppState(initialDashboardState);
        await saveDashboardToFirestore(initialDashboardState, cred.user);

        // Migrate any guest notes/expenditures created before signup to Firestore
        await migrateGuestDataToFirestore(cred.user.uid);
      } else {
        const cred = await signInWithEmailAndPassword(
          auth,
          cleanEmail,
          authPassword
        );
        await ensureUserProfileDoc({
          uid: cred.user.uid,
          displayName:
            cred.user.displayName || cleanEmail.split('@')[0] || 'XXX',
          email: cleanEmail,
          phoneNumber: cred.user.phoneNumber || '+91 98765 43210',
          photoURL: cred.user.photoURL || PRESET_AVATARS[0],
        });
        await migrateGuestDataToFirestore(cred.user.uid);
      }

      // 2. Optional safe sync with backend API if running in full-stack mode (never throws on 404/HTML)
      const endpoint =
        authTab === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const { ok, data } = await safeFetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: authPassword,
          mainName: mName,
          surname: sName,
          phone: phoneVal,
          photo: PRESET_AVATARS[0],
        }),
      });
      if (ok && data && typeof data.token === 'string') {
        sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
        setBackendSession({
          uid: String(data.uid || ''),
          email: String(data.email || cleanEmail),
          token: data.token,
        });
      }

      setAuthPassword('');
      setAuthModalOpen(false);
      showToast(
        authTab === 'signup'
          ? `Account created & saved for ${cleanEmail}`
          : `Signed in as ${cleanEmail}`
      );
    } catch (err) {
      setAuthError(formatFirebaseAuthError(err));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogoutAccount = async () => {
    if (authUser) {
      await signOut(auth).catch(() => {});
    }
    setBackendSession(null);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    setAppState(JSON.parse(JSON.stringify(DEFAULT_STATE)));
    setCalendarNotes([]);
    setCalendarExpenditures([]);
    saveLocalNotes([]);
    saveLocalExpenditures([]);
    setAuthModalOpen(false);
    showToast('Logged out successfully.');
  };

  // Build 42-cell (6x7) Calendar Grid for currentYear and currentMonth
  const firstDayIndex = new Date(
    appState.currentYear,
    appState.currentMonth,
    1
  ).getDay();
  const daysInMonth = new Date(
    appState.currentYear,
    appState.currentMonth + 1,
    0
  ).getDate();

  const mainName = (appState.profile.mainName || 'XXX').trim();
  const currentMonthName = MONTH_NAMES[appState.currentMonth];
  const signedInEmail = authUser?.email || backendSession?.email || null;

  // Date Details Modal computed items
  const detailsDateKey = toDateKey(
    appState.currentYear,
    appState.currentMonth,
    detailsTargetDay
  );
  const detailsNotes = useMemo(
    () => getNotesForDate(calendarNotes, detailsDateKey),
    [calendarNotes, detailsDateKey]
  );
  const detailsExpenditures = useMemo(
    () => getExpendituresForDate(calendarExpenditures, detailsDateKey),
    [calendarExpenditures, detailsDateKey]
  );
  const detailsDailyExpInfo = useMemo(
    () => getDailyExpenditureInfo(calendarExpenditures, detailsDateKey),
    [calendarExpenditures, detailsDateKey]
  );

  return (
    <div className="w-full min-h-screen lg:h-screen lg:max-h-screen lg:overflow-hidden flex flex-col bg-[#0b0f19] text-slate-100 selection:bg-sky-500 selection:text-white">
      {/* TOP HEADER BAR — Clean & Minimal: Sign In, Sign Up, Profile, Log Out */}
      <header className="w-full shrink-0 bg-[#0f172a]/90 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarHidden((prev) => !prev)}
            title="Toggle Profile Sidebar"
            className="w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 flex items-center justify-center text-sky-400 transition cursor-pointer shrink-0"
          >
            <i className="fa-solid fa-bars text-xs"></i>
          </button>
          <h1 className="text-base sm:text-lg md:text-xl font-bold tracking-tight text-slate-100 truncate">
            {mainName}’s Target Tracker
          </h1>
        </div>

        {/* Top Right Action Buttons: Sign In, Sign Up, Profile, Log Out */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 1. Sign In */}
          <button
            type="button"
            onClick={() => {
              setAuthTab('signin');
              setAuthError(null);
              setAuthModalOpen(true);
            }}
            className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
          >
            <i className="fa-solid fa-right-to-bracket text-xs"></i>
            <span>
              {signedInEmail ? signedInEmail.split('@')[0] : 'Sign In'}
            </span>
          </button>

          {/* 2. Sign Up */}
          <button
            type="button"
            onClick={() => {
              setAuthTab('signup');
              setAuthError(null);
              setAuthModalOpen(true);
            }}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <i className="fa-solid fa-user-plus text-xs"></i>
            <span>Sign Up</span>
          </button>

          {/* 3. Profile */}
          <button
            type="button"
            onClick={openProfileModal}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <i className="fa-solid fa-user-pen text-xs text-sky-400"></i>
            <span>Profile</span>
          </button>

          {/* 4. Log Out */}
          <button
            type="button"
            onClick={handleLogoutAccount}
            title="Log Out"
            className="px-3.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <i className="fa-solid fa-power-off text-xs"></i>
            <span>Log Out</span>
          </button>
        </div>
      </header>

      {/* FULL-WIDTH MAIN WORKSPACE — Fits on 1 screen on Desktop without scrolling */}
      <div className="flex-1 min-h-0 w-full max-w-none flex flex-col lg:flex-row gap-3.5 p-3 sm:p-4 overflow-y-auto lg:overflow-hidden">
        {/* LEFT SIDEBAR: CLEAN USER PROFILE PANEL + MONTHLY EXPENDITURE SUMMARY */}
        {!sidebarHidden && (
          <aside className="w-full lg:w-[265px] xl:w-[285px] shrink-0 flex flex-col min-h-0">
            <div className="bg-[#0f172a] border border-slate-800/90 rounded-xl overflow-hidden shadow-lg flex flex-col h-full justify-between">
              <div className="overflow-y-auto">
                {/* Clean Top Cover Accent */}
                <div className="h-10 sidebar-cover" />

                {/* Avatar + Name Section */}
                <div className="px-4 pt-0 pb-3 flex flex-col items-center text-center relative">
                  <div className="relative -mt-7 mb-2 group">
                    <div className="w-16 h-16 rounded-full p-0.5 bg-gradient-to-tr from-sky-500 to-indigo-500 shadow-md">
                      <img
                        src={appState.profile.photo || PRESET_AVATARS[0]}
                        alt="User Profile Photo"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = PRESET_AVATARS[0];
                        }}
                        className="w-full h-full object-cover rounded-full bg-[#0b0f19] border-2 border-[#0f172a]"
                      />
                    </div>
                    <label
                      htmlFor="quickPhotoUpload"
                      title="Upload your photo"
                      className="cursor-pointer absolute bottom-0 right-0 w-6 h-6 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center justify-center shadow border-2 border-[#0f172a] transition"
                    >
                      <i className="fa-solid fa-camera text-[10px]"></i>
                      <input
                        id="quickPhotoUpload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoFileSelect}
                      />
                    </label>
                  </div>

                  {/* Clean User Name */}
                  <h2 className="text-base font-bold text-slate-100 tracking-tight leading-snug">
                    {mainName}
                  </h2>

                  <p className="mt-0.5 text-xs text-emerald-400 font-medium">
                    Total Completed: {totalCompletedAllTime}{' '}
                    {totalCompletedAllTime === 1 ? 'Day' : 'Days'}
                  </p>

                  <div className="w-full h-px bg-slate-800/80 my-2.5" />

                  {/* Clean Contact Information List */}
                  <div className="w-full space-y-2 text-left">
                    {/* Name Field */}
                    <div className="bg-[#131c2e] border border-slate-800/80 rounded-lg px-3 py-1.5 flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-user text-[11px]"></i>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400">
                          Name
                        </p>
                        <p className="text-xs font-semibold text-slate-100 truncate">
                          {mainName}
                        </p>
                      </div>
                    </div>

                    {/* Email Field */}
                    <div className="bg-[#131c2e] border border-slate-800/80 rounded-lg px-3 py-1.5 flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-envelope text-[11px]"></i>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400">
                          Email
                        </p>
                        <p className="text-xs font-semibold text-slate-100 truncate">
                          {appState.profile.email}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyProfileField('email')}
                        title="Copy Email"
                        className="text-slate-400 hover:text-sky-400 p-1 transition cursor-pointer"
                      >
                        <i className="fa-regular fa-copy text-xs"></i>
                      </button>
                    </div>

                    {/* Phone Number Field */}
                    <div className="bg-[#131c2e] border border-slate-800/80 rounded-lg px-3 py-1.5 flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-phone text-[11px]"></i>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400">
                          Phone
                        </p>
                        <p className="text-xs font-semibold text-slate-100 truncate">
                          {appState.profile.phone}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyProfileField('phone')}
                        title="Copy Phone Number"
                        className="text-slate-400 hover:text-emerald-400 p-1 transition cursor-pointer"
                      >
                        <i className="fa-regular fa-copy text-xs"></i>
                      </button>
                    </div>
                  </div>

                  {/* MONTHLY TOTAL EXPENDITURE SUMMARY CARD (Average Daily Expenditure Removed) */}
                  <div className="w-full mt-3 bg-[#131c2e] border border-slate-800/90 rounded-xl p-3 text-left">
                    <div className="flex items-center justify-between gap-1.5 mb-2.5">
                      <span className="text-[11px] font-bold text-slate-200 tracking-tight truncate">
                        Monthly Expenditure — {currentMonthName}{' '}
                        {appState.currentYear}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[#0f172a] border border-slate-800/80 rounded-lg px-2.5 py-2 flex flex-col justify-between">
                        <span className="text-[10px] text-slate-400 font-medium">
                          Total Expenditure
                        </span>
                        <span
                          data-testid="monthly-total-expenditure"
                          className="text-sm font-bold text-emerald-400 tabular-nums mt-0.5 truncate"
                        >
                          {formatINR(monthlyExpSummary.totalExpenditure)}
                        </span>
                      </div>
                      <div className="bg-[#0f172a] border border-slate-800/80 rounded-lg px-2.5 py-2 flex flex-col justify-between">
                        <span className="text-[10px] text-slate-400 font-medium">
                          Days with Expenses
                        </span>
                        <span
                          data-testid="monthly-days-with-expenses"
                          className="text-sm font-bold text-slate-100 tabular-nums mt-0.5"
                        >
                          {monthlyExpSummary.daysWithExpenses}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Edit Profile Button */}
              <div className="px-4 pb-3 pt-1">
                <button
                  type="button"
                  onClick={openProfileModal}
                  className="w-full py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <i className="fa-solid fa-pen-to-square text-sky-400"></i>
                  <span>Edit Profile</span>
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* RIGHT MAIN TRACKER CONTAINER — Flex-col filling remaining height without scrolling */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col bg-[#0f172a] border border-slate-800/90 rounded-xl overflow-hidden shadow-lg">
            {/* 1. TOP TRACKER HEADER BANNER */}
            <div className="tracker-header-banner py-2 px-4 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xs sm:text-sm font-semibold text-slate-200 tracking-wider uppercase">
                  {appState.activeTask} — {currentMonthName}{' '}
                  {appState.currentYear}
                </h2>
              </div>

              {/* Compact Top-Right Monthly Expenditure Summary (Total + Days with Expenses only) */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-2 bg-[#131c2e] border border-slate-800 px-3 py-1 rounded-lg">
                  <span className="text-slate-400 hidden sm:inline">
                    {currentMonthName} {appState.currentYear} Expense:
                  </span>
                  <span className="font-bold text-emerald-400 tabular-nums">
                    {formatINR(monthlyExpSummary.totalExpenditure)}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-300 text-[11px] tabular-nums">
                    {monthlyExpSummary.daysWithExpenses}{' '}
                    {monthlyExpSummary.daysWithExpenses === 1 ? 'day' : 'days'}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. COMPACT TASK TABS, MONTH NAVIGATION & STATS BAR */}
            <div className="px-4 py-2 bg-[#0f172a] border-b border-slate-800/80 shrink-0 flex flex-wrap items-center justify-between gap-2.5">
              {/* Left: Task Tabs (Default: General + "+ Add Task") */}
              <div className="flex flex-wrap items-center gap-1.5">
                {appState.tasks.map((taskName) => {
                  const isActive = taskName === appState.activeTask;
                  return (
                    <div
                      key={taskName}
                      className="relative group flex items-center"
                    >
                      <button
                        type="button"
                        onClick={() => selectTask(taskName)}
                        className={
                          isActive
                            ? 'px-3.5 py-1.5 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs sm:text-sm transition flex items-center gap-1.5 shadow-sm cursor-pointer'
                            : 'px-3.5 py-1.5 rounded-lg bg-[#162033] hover:bg-slate-800 border border-slate-800 text-slate-300 font-medium text-xs sm:text-sm transition flex items-center gap-1.5 cursor-pointer'
                        }
                      >
                        <span>{taskName}</span>
                        {appState.tasks.length > 1 && (
                          <span
                            title={`Delete ${taskName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTask(taskName);
                            }}
                            className={`ml-1 opacity-0 group-hover:opacity-100 transition text-[11px] ${
                              isActive
                                ? 'text-slate-900 hover:text-rose-900'
                                : 'text-slate-400 hover:text-rose-400'
                            }`}
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setNewTaskName('');
                    setAddTaskModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-semibold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer"
                >
                  <i className="fa-solid fa-plus text-xs"></i>
                  <span>Add Task</span>
                </button>
              </div>

              {/* Center: Month Selector ( < October 2026 > ) */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => changeMonth(-1)}
                  title="Previous Month"
                  className="w-8 h-8 rounded-lg bg-[#162033] hover:bg-slate-800 border border-slate-700/70 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                >
                  <i className="fa-solid fa-chevron-left text-xs"></i>
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMonthPickerOpen((prev) => !prev)}
                    className="min-w-[165px] px-3.5 py-1.5 rounded-lg bg-[#162033] hover:bg-slate-800 border border-slate-700/70 text-slate-100 font-semibold text-xs sm:text-sm flex items-center justify-between gap-2 transition cursor-pointer"
                  >
                    <span>
                      {currentMonthName} {appState.currentYear}
                    </span>
                    <i className="fa-regular fa-calendar text-slate-400 text-xs"></i>
                  </button>

                  {monthPickerOpen && (
                    <div className="absolute left-0 top-10 mt-1 w-64 bg-[#111827] border border-slate-700 rounded-xl shadow-2xl p-3.5 z-50">
                      <div className="flex items-center justify-between mb-2.5">
                        <button
                          type="button"
                          onClick={() => changeYear(-1)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
                        >
                          <i className="fa-solid fa-angles-left"></i>
                        </button>
                        <span className="font-bold text-sky-400 text-sm">
                          {appState.currentYear}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeYear(1)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
                        >
                          <i className="fa-solid fa-angles-right"></i>
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-xs">
                        {SHORT_MONTHS.map((mName, idx) => {
                          const isCurr = idx === appState.currentMonth;
                          return (
                            <button
                              key={mName}
                              type="button"
                              onClick={() => {
                                setMonthPickerOpen(false);
                                updateStateAndPersist((prev) => ({
                                  ...prev,
                                  currentMonth: idx,
                                }));
                              }}
                              className={`py-1.5 rounded-lg font-medium transition cursor-pointer ${
                                isCurr
                                  ? 'bg-sky-500 text-slate-950 font-semibold'
                                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300'
                              }`}
                            >
                              {mName}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2.5 pt-2 border-t border-slate-800 flex justify-between">
                        <button
                          type="button"
                          onClick={jumpToOct2026}
                          className="text-[11px] text-sky-400 hover:underline font-medium cursor-pointer"
                        >
                          Reset to Oct 2026
                        </button>
                        <button
                          type="button"
                          onClick={() => setMonthPickerOpen(false)}
                          className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => changeMonth(1)}
                  title="Next Month"
                  className="w-8 h-8 rounded-lg bg-[#162033] hover:bg-slate-800 border border-slate-700/70 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                >
                  <i className="fa-solid fa-chevron-right text-xs"></i>
                </button>
              </div>

              {/* Right: COMPLETED | NOT COMPLETED | SKIPPED | SUCCESS RATE (based on all days of month) */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="stat-completed px-3 py-1 rounded-lg min-w-[84px] text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    Completed
                  </div>
                  <div className="text-sm sm:text-base font-bold text-slate-100 leading-tight">
                    {activeStats.completed}
                  </div>
                </div>

                <div className="stat-not-completed px-3 py-1 rounded-lg min-w-[96px] text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">
                    Not Completed
                  </div>
                  <div className="text-sm sm:text-base font-bold text-slate-100 leading-tight">
                    {activeStats.notCompleted}
                  </div>
                </div>

                <div className="stat-skipped px-3 py-1 rounded-lg min-w-[78px] text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                    Skipped
                  </div>
                  <div className="text-sm sm:text-base font-bold text-slate-100 leading-tight">
                    {activeStats.skipped}
                  </div>
                </div>

                <div
                  title={`Completed ${activeStats.completed} of ${activeStats.daysInMonth} days in ${currentMonthName}`}
                  className="stat-rate px-3 py-1 rounded-lg min-w-[92px] text-center"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                    Success Rate
                  </div>
                  <div className="text-sm sm:text-base font-bold text-slate-100 leading-tight">
                    {activeStats.rate}%
                  </div>
                </div>
              </div>
            </div>

            {/* 3. CLEAN DAYS OF WEEK HEADER (SUN - SAT) */}
            <div className="grid grid-cols-7 day-of-week-header border-b border-slate-800/90 shrink-0">
              <div className="py-1.5 text-center font-semibold text-[11px] border-r border-slate-800/60">
                SUN
              </div>
              <div className="py-1.5 text-center font-semibold text-[11px] border-r border-slate-800/60">
                MON
              </div>
              <div className="py-1.5 text-center font-semibold text-[11px] border-r border-slate-800/60">
                TUE
              </div>
              <div className="py-1.5 text-center font-semibold text-[11px] border-r border-slate-800/60">
                WED
              </div>
              <div className="py-1.5 text-center font-semibold text-[11px] border-r border-slate-800/60">
                THU
              </div>
              <div className="py-1.5 text-center font-semibold text-[11px] border-r border-slate-800/60">
                FRI
              </div>
              <div className="py-1.5 text-center font-semibold text-[11px]">
                SAT
              </div>
            </div>

            {/* 4. 6x7 CALENDAR GRID WITH CIRCULAR DATES + NOTE & EXPENDITURE INDICATORS */}
            <div className="flex-1 min-h-0 grid grid-cols-7 grid-rows-6 bg-[#0b0f19]">
              {Array.from({ length: 42 }).map((_, i) => {
                const dayNumber = i - firstDayIndex + 1;
                if (dayNumber < 1 || dayNumber > daysInMonth) {
                  return (
                    <div
                      key={`empty-${i}`}
                      className="calendar-cell opacity-40"
                    />
                  );
                }

                const key = getRecordKey(
                  appState.activeTask,
                  appState.currentYear,
                  appState.currentMonth,
                  dayNumber
                );
                const rawRecord = appState.records[key] || {
                  status: null,
                  note: '',
                };
                const status = normalizeStatus(rawRecord.status);
                const isSelectedDay = dayNumber === appState.selectedDay;

                const cellDateKey = toDateKey(
                  appState.currentYear,
                  appState.currentMonth,
                  dayNumber
                );
                const dayNotes = getNotesForDate(calendarNotes, cellDateKey);
                const dayExpInfo = getDailyExpenditureInfo(
                  calendarExpenditures,
                  cellDateKey
                );

                let cellStatusClass = '';
                let circleClass = 'date-circle-unmarked';

                if (status === 'completed') {
                  cellStatusClass = 'status-completed';
                  circleClass = 'date-circle-completed';
                } else if (status === 'not_completed') {
                  cellStatusClass = 'status-not_completed';
                  circleClass = 'date-circle-not_completed';
                } else if (status === 'skipped') {
                  cellStatusClass = 'status-skipped';
                  circleClass = 'date-circle-skipped';
                }

                return (
                  <div
                    key={`day-${dayNumber}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${dayNumber} ${currentMonthName} ${appState.currentYear}${
                      dayNotes.length > 0 ? ', Notes available' : ''
                    }${
                      dayExpInfo.hasEntries
                        ? `, Expenditure ${formatINR(dayExpInfo.dailyTotal)}`
                        : ''
                    }`}
                    onClick={() => handleDayCellClick(dayNumber)}
                    onContextMenu={(e) => handleCellContextMenu(e, dayNumber)}
                    onTouchStart={(e) => handleCellTouchStart(e, dayNumber)}
                    onTouchEnd={handleCellTouchEnd}
                    onTouchMove={handleCellTouchEnd}
                    onKeyDown={(e) => handleCellKeyDown(e, dayNumber)}
                    className={`calendar-cell active-day p-1 flex flex-col items-center justify-center cursor-pointer group focus:outline-none focus:ring-2 focus:ring-sky-400/70 ${cellStatusClass} ${
                      isSelectedDay ? 'selected-day' : ''
                    }`}
                  >
                    {/* Top-Left Corner: Separate Note Icon & Expenditure Icon side by side */}
                    {(dayNotes.length > 0 || dayExpInfo.hasEntries) && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => e.stopPropagation()}
                        className="absolute top-1 left-1 z-20 flex items-center gap-1"
                      >
                        {dayNotes.length > 0 && (
                          <button
                            type="button"
                            data-testid={`note-icon-${dayNumber}`}
                            title="View Notes"
                            aria-label="View Notes"
                            onClick={(e) => {
                              e.stopPropagation();
                              openViewDetailsModal(dayNumber, 'notes');
                            }}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
                            className="h-5 min-w-[20px] px-1 rounded-md bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/60 text-amber-300 text-[10px] font-semibold flex items-center justify-center gap-0.5 transition cursor-pointer shadow-sm"
                          >
                            <svg
                              className="w-2.5 h-2.5 shrink-0 fill-current"
                              viewBox="0 0 16 16"
                              aria-hidden="true"
                            >
                              <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h6.086a1.5 1.5 0 0 0 1.06-.44l4.915-4.914A1.5 1.5 0 0 0 15 8.586V2.5A1.5 1.5 0 0 0 13.5 1h-11zM2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V8H9.5A1.5 1.5 0 0 0 8 9.5V14H2.5a.5.5 0 0 1-.5-.5v-11zm7 11.293V9.5a.5.5 0 0 1 .5-.5h4.293L9 13.793z" />
                            </svg>
                            {dayNotes.length > 1 && (
                              <span className="leading-none text-[9px] tabular-nums">
                                {dayNotes.length}
                              </span>
                            )}
                          </button>
                        )}

                        {dayExpInfo.hasEntries && (
                          <button
                            type="button"
                            data-testid={`expenditure-icon-${dayNumber}`}
                            title="View Expenditure"
                            aria-label="View Expenditure"
                            onClick={(e) => {
                              e.stopPropagation();
                              openViewDetailsModal(dayNumber, 'expenditure');
                            }}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
                            className="h-5 min-w-[20px] px-1 rounded-md bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/60 text-emerald-300 text-[10px] font-semibold flex items-center justify-center gap-0.5 transition cursor-pointer shadow-sm"
                          >
                            <svg
                              className="w-2.5 h-2.5 shrink-0 fill-current"
                              viewBox="0 0 16 16"
                              aria-hidden="true"
                            >
                              <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13zm13 1a.5.5 0 0 1 .5.5v2h-3.5a2.5 2.5 0 0 0 0 5H15v2a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h13zM11.5 6.5H15v3h-3.5a1.5 1.5 0 0 1 0-3zm0 2a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z" />
                            </svg>
                            {dayExpInfo.count > 1 && (
                              <span className="leading-none text-[9px] tabular-nums">
                                {dayExpInfo.count}
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Top-Right Corner: Accessible Mobile / Quick Context Menu Trigger */}
                    <button
                      type="button"
                      title="Date options (Add Note, Add Expenditure, View Details)"
                      aria-label={`Open options for ${dayNumber} ${currentMonthName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        openContextMenuAt(dayNumber, rect.left, rect.bottom + 4);
                      }}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchEnd={(e) => e.stopPropagation()}
                      className="absolute top-1 right-1 z-20 w-5 h-5 rounded bg-slate-800/70 hover:bg-slate-700 text-slate-400 hover:text-slate-100 opacity-60 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center text-[10px] transition cursor-pointer"
                    >
                      <i className="fa-solid fa-ellipsis-vertical"></i>
                    </button>

                    {/* Center Circular Color-Coded Date Badge */}
                    <div className={`date-circle ${circleClass}`}>
                      <span>{dayNumber}</span>
                      {status === 'completed' && (
                        <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-950 border border-emerald-300 text-emerald-300 flex items-center justify-center text-[9px] shadow">
                          <i className="fa-solid fa-check"></i>
                        </span>
                      )}
                      {status === 'not_completed' && (
                        <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-rose-950 border border-rose-300 text-rose-300 flex items-center justify-center text-[9px] shadow">
                          <i className="fa-solid fa-xmark"></i>
                        </span>
                      )}
                      {status === 'skipped' && (
                        <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-amber-950 border border-amber-300 text-amber-300 flex items-center justify-center text-[9px] shadow">
                          <i className="fa-solid fa-minus"></i>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>

      {/* ========================================== */}
      {/* FLOATING CALENDAR DATE CONTEXT MENU */}
      {/* ========================================== */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-48 bg-[#111827] border border-slate-700 rounded-xl shadow-2xl overflow-hidden py-1 text-xs"
        >
          <div className="px-3 py-1.5 border-b border-slate-800 text-[11px] font-bold text-slate-300 flex items-center justify-between">
            <span>
              {formatFullDateDisplay(
                appState.currentYear,
                appState.currentMonth,
                contextMenu.day
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => openAddNoteModal(contextMenu.day)}
            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition cursor-pointer"
          >
            <i className="fa-solid fa-note-sticky text-amber-400 w-4 text-center"></i>
            <span>Add Note</span>
          </button>
          <button
            type="button"
            onClick={() => openAddExpenditureModal(contextMenu.day)}
            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition cursor-pointer"
          >
            <i className="fa-solid fa-indian-rupee-sign text-emerald-400 w-4 text-center"></i>
            <span>Add Expenditure</span>
          </button>
          <button
            type="button"
            onClick={() => openViewDetailsModal(contextMenu.day)}
            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 border-t border-slate-800/80 transition cursor-pointer"
          >
            <i className="fa-solid fa-eye text-sky-400 w-4 text-center"></i>
            <span>View Details</span>
          </button>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: ADD / EDIT NOTE */}
      {/* ========================================== */}
      {noteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="tracker-header-banner px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-100 text-sm sm:text-base tracking-tight flex items-center gap-2">
                <i className="fa-solid fa-note-sticky text-amber-400"></i>
                <span>{editingNoteId ? 'Edit Note' : 'Add Note'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setNoteModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSaveNoteSubmit} className="p-5 space-y-4">
              {noteError && (
                <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-300 text-xs font-medium">
                  {noteError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Selected Date
                </label>
                <input
                  type="text"
                  readOnly
                  value={formatFullDateDisplay(
                    appState.currentYear,
                    appState.currentMonth,
                    noteTargetDay
                  )}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19]/70 border border-slate-800 text-slate-300 text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Note Title *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={150}
                  placeholder="e.g. Exam Preparation / Important Reminder"
                  value={noteTitleInput}
                  onChange={(e) => setNoteTitleInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Note Description
                </label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  placeholder="Write details for this date..."
                  value={noteDescInput}
                  onChange={(e) => setNoteDescInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setNoteModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={noteSubmitting}
                  className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold tracking-wide shadow-md cursor-pointer disabled:opacity-50"
                >
                  {noteSubmitting ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: ADD / EDIT EXPENDITURE */}
      {/* ========================================== */}
      {expModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="tracker-header-banner px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-100 text-sm sm:text-base tracking-tight flex items-center gap-2">
                <i className="fa-solid fa-indian-rupee-sign text-emerald-400"></i>
                <span>
                  {editingExpId ? 'Edit Expenditure' : 'Add Expenditure'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setExpModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form
              onSubmit={handleSaveExpenditureSubmit}
              className="p-5 space-y-4"
            >
              {expError && (
                <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-300 text-xs font-medium">
                  {expError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Selected Date
                </label>
                <input
                  type="text"
                  readOnly
                  value={formatFullDateDisplay(
                    appState.currentYear,
                    appState.currentMonth,
                    expTargetDay
                  )}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19]/70 border border-slate-800 text-slate-300 text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Expenditure Title or Description *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={150}
                  placeholder="e.g. Groceries, Transport, Study Books"
                  value={expTitleInput}
                  onChange={(e) => setExpTitleInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Amount (in ₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    placeholder="e.g. 500"
                    value={expAmountInput}
                    onChange={(e) => setExpAmountInput(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Category (Optional)
                  </label>
                  <select
                    value={expCategoryInput}
                    onChange={(e) => setExpCategoryInput(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-400"
                  >
                    <option value="">None (Optional)</option>
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setExpModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={expSubmitting}
                  className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold tracking-wide shadow-md cursor-pointer disabled:opacity-50"
                >
                  {expSubmitting ? 'Saving...' : 'Save Expenditure'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: VIEW DETAILS FOR SELECTED DATE */}
      {/* ========================================== */}
      {detailsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl max-w-lg w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="tracker-header-banner px-5 py-3.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {detailsViewMode === 'notes' ? (
                  <i className="fa-solid fa-note-sticky text-amber-400"></i>
                ) : detailsViewMode === 'expenditure' ? (
                  <i className="fa-solid fa-wallet text-emerald-400"></i>
                ) : (
                  <i className="fa-regular fa-calendar-check text-sky-400"></i>
                )}
                <h3 className="font-bold text-slate-100 text-sm sm:text-base tracking-tight">
                  {detailsViewMode === 'notes'
                    ? 'Notes — '
                    : detailsViewMode === 'expenditure'
                      ? 'Expenditure — '
                      : 'Date: '}
                  {formatFullDateDisplay(
                    appState.currentYear,
                    appState.currentMonth,
                    detailsTargetDay
                  )}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailsModalOpen(false);
                  setConfirmDeleteTarget(null);
                }}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Filter Tabs (Notes | Expenditure | All) + Quick Add Actions */}
            <div className="px-5 py-2.5 bg-[#111827] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1 bg-[#0b0f19] p-1 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setDetailsViewMode('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    detailsViewMode === 'all'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsViewMode('notes')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                    detailsViewMode === 'notes'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <i className="fa-solid fa-note-sticky text-[10px]"></i>
                  <span>Notes ({detailsNotes.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsViewMode('expenditure')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                    detailsViewMode === 'expenditure'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <i className="fa-solid fa-wallet text-[10px]"></i>
                  <span>Expenditure ({detailsExpenditures.length})</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {detailsViewMode !== 'expenditure' && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetailsModalOpen(false);
                      openAddNoteModal(detailsTargetDay);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-300 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                  >
                    <i className="fa-solid fa-plus text-[10px]"></i>
                    <span>Add Note</span>
                  </button>
                )}
                {detailsViewMode !== 'notes' && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetailsModalOpen(false);
                      openAddExpenditureModal(detailsTargetDay);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-300 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                  >
                    <i className="fa-solid fa-plus text-[10px]"></i>
                    <span>Add Expenditure</span>
                  </button>
                )}
              </div>
            </div>

            {/* Delete Confirmation Banner if triggered */}
            {confirmDeleteTarget && (
              <div className="mx-5 mt-4 p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="text-xs text-rose-200">
                  Delete {confirmDeleteTarget.type}{' '}
                  <strong className="text-white">
                    “{confirmDeleteTarget.title}”
                  </strong>
                  ?
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTarget(null)}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deletingItem}
                    onClick={handleConfirmDeleteItem}
                    className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {deletingItem ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                </div>
              </div>
            )}

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {detailsViewMode === 'all' &&
              detailsNotes.length === 0 &&
              detailsExpenditures.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">
                  No notes or expenditure recorded for this date.
                </div>
              ) : (
                <>
                  {/* Notes Section */}
                  {(detailsViewMode === 'all' || detailsViewMode === 'notes') && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2.5 flex items-center gap-1.5">
                        <i className="fa-solid fa-note-sticky"></i>
                        <span>Notes ({detailsNotes.length})</span>
                      </h4>
                      {detailsNotes.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No notes recorded for this date.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {detailsNotes.map((note) => (
                            <div
                              key={note.noteId}
                              className="bg-[#131c2e] border border-slate-800 rounded-xl p-3 flex items-start justify-between gap-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs sm:text-sm font-semibold text-slate-100">
                                  {note.title}
                                </p>
                                {note.description && (
                                  <p className="text-xs text-slate-300 mt-1 whitespace-pre-wrap break-words">
                                    {note.description}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  title="Edit Note"
                                  onClick={() => {
                                    setDetailsModalOpen(false);
                                    openAddNoteModal(detailsTargetDay, note);
                                  }}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  title="Delete Note"
                                  onClick={() =>
                                    setConfirmDeleteTarget({
                                      type: 'note',
                                      id: note.noteId,
                                      title: note.title,
                                    })
                                  }
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-rose-950 text-rose-400 text-xs cursor-pointer"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Expenditure Section */}
                  {(detailsViewMode === 'all' ||
                    detailsViewMode === 'expenditure') && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2.5 flex items-center gap-1.5">
                        <i className="fa-solid fa-wallet"></i>
                        <span>Expenditure ({detailsExpenditures.length})</span>
                      </h4>
                      {detailsExpenditures.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No expenditure recorded for this date.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {detailsExpenditures.map((exp) => (
                            <div
                              key={exp.expenditureId}
                              className="bg-[#131c2e] border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs sm:text-sm font-semibold text-slate-100">
                                    {exp.title}
                                  </span>
                                  {exp.category && (
                                    <span className="text-[11px] text-slate-400">
                                      · {exp.category}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs sm:text-sm font-bold text-emerald-400 tabular-nums">
                                  {formatINR(exp.amount)}
                                </span>
                                <button
                                  type="button"
                                  title="Edit Expenditure"
                                  onClick={() => {
                                    setDetailsModalOpen(false);
                                    openAddExpenditureModal(
                                      detailsTargetDay,
                                      exp
                                    );
                                  }}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  title="Delete Expenditure"
                                  onClick={() =>
                                    setConfirmDeleteTarget({
                                      type: 'expenditure',
                                      id: exp.expenditureId,
                                      title: exp.title,
                                    })
                                  }
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-rose-950 text-rose-400 text-xs cursor-pointer"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}

                          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs sm:text-sm font-bold">
                            <span className="text-slate-300">
                              Daily Expenditure Total:
                            </span>
                            <span
                              data-testid="details-daily-total"
                              className="text-emerald-400 tabular-nums"
                            >
                              {formatINR(detailsDailyExpInfo.dailyTotal)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3 bg-[#111827] border-t border-slate-800 flex items-center justify-between shrink-0">
              <div className="text-xs font-semibold text-slate-300">
                Daily Total:{' '}
                <span className="text-emerald-400 font-bold tabular-nums">
                  {formatINR(detailsDailyExpInfo.dailyTotal)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailsModalOpen(false);
                  setConfirmDeleteTarget(null);
                }}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 0: SIGN IN / SIGN UP / FORGOT PASSWORD + GOOGLE */}
      {/* ========================================== */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="tracker-header-banner px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-100 text-sm sm:text-base tracking-tight flex items-center gap-2">
                <i className="fa-solid fa-shield-halved text-sky-400"></i>{' '}
                {authTab === 'signup'
                  ? 'Create Account'
                  : authTab === 'forgot'
                    ? 'Reset Your Password'
                    : 'Sign In to Dashboard'}
              </h3>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {signedInEmail && (
                <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                      Signed In Account
                    </div>
                    <div className="text-xs sm:text-sm font-semibold text-white truncate">
                      {signedInEmail}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogoutAccount}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shrink-0 transition cursor-pointer"
                  >
                    Log Out
                  </button>
                </div>
              )}

              {authTab !== 'forgot' && (
                /* Sign In / Sign Up Mode Switch Tabs */
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0b0f19] rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('signin');
                      setAuthError(null);
                      setResetSuccessMsg(null);
                    }}
                    className={`py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      authTab === 'signin'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('signup');
                      setAuthError(null);
                      setResetSuccessMsg(null);
                    }}
                    className={`py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      authTab === 'signup'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Sign Up
                  </button>
                </div>
              )}

              {authError && (
                <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-300 text-xs font-medium leading-relaxed">
                  {authError}
                </div>
              )}

              {resetSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs font-medium leading-relaxed">
                  {resetSuccessMsg}
                </div>
              )}

              {authTab === 'forgot' ? (
                <form
                  onSubmit={handleForgotPasswordSubmit}
                  className="space-y-3.5"
                >
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Enter your registered email address below and we will send
                    you a password reset link.
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Registered Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      autoFocus
                      placeholder="you@example.com"
                      value={resetEmailInput}
                      onChange={(e) => setResetEmailInput(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold tracking-wide shadow-md transition cursor-pointer disabled:opacity-50"
                  >
                    {authSubmitting ? 'Sending Reset Link...' : 'Send Password Reset Email'}
                  </button>

                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab('signin');
                        setAuthError(null);
                        setResetSuccessMsg(null);
                      }}
                      className="text-xs font-semibold text-sky-400 hover:text-sky-300 hover:underline transition cursor-pointer"
                    >
                      ← Back to Sign In
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <form onSubmit={handleAuthSubmit} className="space-y-3">
                    {authTab === 'signup' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">
                            Name *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="Your Name"
                            value={authMainName}
                            onChange={(e) => setAuthMainName(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">
                            Phone Number
                          </label>
                          <input
                            type="text"
                            placeholder="+91 98765 43210"
                            value={authPhone}
                            onChange={(e) => setAuthPhone(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        required
                        placeholder="you@example.com"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-slate-300">
                          Password *
                        </label>
                        {authTab === 'signin' && (
                          <button
                            type="button"
                            data-testid="forgot-password-link"
                            onClick={() => {
                              setResetEmailInput(authEmail.trim());
                              setAuthError(null);
                              setResetSuccessMsg(null);
                              setAuthTab('forgot');
                            }}
                            className="text-xs font-semibold text-sky-400 hover:text-sky-300 hover:underline transition cursor-pointer"
                          >
                            Forgot Password?
                          </button>
                        )}
                      </div>
                      <input
                        type="password"
                        required
                        minLength={6}
                        placeholder="Minimum 6 characters"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={authSubmitting}
                      className="w-full py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold tracking-wide shadow-md transition cursor-pointer disabled:opacity-50"
                    >
                      {authSubmitting
                        ? 'Please wait...'
                        : authTab === 'signup'
                          ? 'Create Account'
                          : 'Sign In'}
                    </button>
                  </form>

                  <div className="relative flex items-center justify-center">
                    <div className="border-t border-slate-800 w-full"></div>
                    <span className="bg-[#0f172a] px-3 text-[10px] uppercase tracking-wider font-semibold text-slate-500 whitespace-nowrap">
                      or
                    </span>
                    <div className="border-t border-slate-800 w-full"></div>
                  </div>

                  {/* Google Login Button */}
                  <button
                    type="button"
                    disabled={authSubmitting}
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs flex items-center justify-center gap-2.5 shadow-sm transition cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 1: EDIT USER PROFILE */}
      {/* ========================================== */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="tracker-header-banner px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-100 text-sm sm:text-base tracking-tight flex items-center gap-2">
                <i className="fa-solid fa-user-pen text-sky-400"></i> Edit Profile
              </h3>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={saveProfileChanges} className="p-5 space-y-4">
              <div className="flex flex-col items-center gap-3 pb-3 border-b border-slate-800">
                <div className="relative">
                  <img
                    src={editPhotoPreview || PRESET_AVATARS[0]}
                    alt="Preview"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = PRESET_AVATARS[0];
                    }}
                    className="w-20 h-20 rounded-full object-cover border-2 border-sky-400 bg-slate-900"
                  />
                  <label
                    htmlFor="modalPhotoInput"
                    className="cursor-pointer absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center justify-center shadow"
                  >
                    <i className="fa-solid fa-upload text-xs"></i>
                    <input
                      id="modalPhotoInput"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoFileSelect}
                    />
                  </label>
                </div>
                <div className="text-center">
                  <p className="text-[11px] text-slate-400 mb-1.5">
                    Upload your photo or pick an avatar preset:
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    {PRESET_AVATARS.map((presetUrl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => selectPresetAvatar(presetUrl)}
                        className="w-8 h-8 rounded-full overflow-hidden border border-slate-600 hover:border-sky-400 cursor-pointer"
                      >
                        <img
                          src={presetUrl}
                          alt={`Preset ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Your Name"
                  value={editMainName}
                  onChange={(e) => setEditMainName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="+91 98765 43210"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Custom Photo URL (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Paste image link or use upload button above"
                  value={editPhotoUrl}
                  onChange={(e) => setEditPhotoUrl(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#0b0f19] border border-slate-700 text-slate-300 text-xs focus:outline-none focus:border-sky-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setProfileModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold tracking-wide shadow-md cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 2: ADD NEW TASK MODAL */}
      {/* ========================================== */}
      {addTaskModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
            <div className="tracker-header-banner px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-100 text-sm tracking-tight flex items-center gap-2">
                <i className="fa-solid fa-plus-circle text-emerald-400"></i> Add New Task
              </h3>
              <button
                type="button"
                onClick={() => setAddTaskModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <form onSubmit={handleAddTaskSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Task Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={28}
                  placeholder="e.g. Science, Fitness, Reading, Coding"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0f19] border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-400"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddTaskModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold tracking-wide cursor-pointer"
                >
                  Add Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toastMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#111827] border border-slate-700 text-slate-100 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-medium flex items-center gap-2">
          <i className="fa-solid fa-circle-check text-emerald-400"></i>
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}
