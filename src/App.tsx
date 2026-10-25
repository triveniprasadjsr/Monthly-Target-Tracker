/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
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
  googleProvider,
  handleFirestoreError,
  OperationType,
  sanitizeString,
  testFirestoreConnection,
} from './lib/firebase';
import { ensureUserProfileDoc } from './services/firestoreService';
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

  // UI toggles & modal states
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  // Modal 0: Sign In / Sign Up Modal
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [authMainName, setAuthMainName] = useState('XXX');
  const [authSurname, setAuthSurname] = useState('YYY');
  const [authPhone, setAuthPhone] = useState('+91 98765 43210');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

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
    }, 2600);
  }, []);

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

  // Save state to Backend Database (/api/dashboard) when logged in via Email/Password session
  const saveDashboardToBackend = useCallback(
    async (nextState: TrackerAppState, tokenOverride?: string) => {
      const token = tokenOverride || backendSession?.token;
      if (!token) return;
      try {
        await fetch('/api/dashboard', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ dashboard: nextState }),
        });
      } catch (err) {
        console.error('Failed to sync dashboard to server:', err);
      }
    },
    [backendSession?.token]
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
          saveDashboardToBackend(next, backendSession.token);
        }
        return next;
      });
    },
    [authUser, backendSession?.token, saveDashboardToBackend, saveDashboardToFirestore]
  );

  // Restore backend email/password session on boot if present
  useEffect(() => {
    const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (!savedToken) return;

    fetch('/api/dashboard', {
      headers: { Authorization: `Bearer ${savedToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.dashboard) {
          setBackendSession({
            uid: data.uid,
            email: data.email,
            token: savedToken,
          });
          const d = data.dashboard;
          setAppState({
            profile: {
              mainName: d.profile?.mainName || 'XXX',
              surname: d.profile?.surname || 'YYY',
              email: d.profile?.email || data.email || 'xxx.yyy@example.com',
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
        } else {
          sessionStorage.removeItem(SESSION_TOKEN_KEY);
        }
      })
      .catch(() => {});
  }, []);

  // Subscribe to Firebase Auth & Cloud Firestore Dashboard
  useEffect(() => {
    testFirestoreConnection();

    let unsubDashboard: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);

      if (unsubDashboard) {
        unsubDashboard();
        unsubDashboard = null;
      }

      if (!user) return;

      try {
        await ensureUserProfileDoc({
          uid: user.uid,
          displayName:
            user.displayName || user.email?.split('@')[0] || 'XXX YYY',
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
      } catch (err) {
        console.error('Auth/Dashboard initialization error:', err);
      }
    });

    return () => {
      unsubAuth();
      if (unsubDashboard) unsubDashboard();
    };
  }, [saveDashboardToFirestore]);

  // Compute stats for a given task/year/month
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

      const totalEvaluated = completed + notCompleted;
      const rate =
        totalEvaluated > 0
          ? Math.round((completed / totalEvaluated) * 100)
          : 0;
      return { completed, notCompleted, skipped, rate, daysInMonth };
    },
    [appState.records]
  );

  const activeStats = getTaskMonthStats(
    appState.activeTask,
    appState.currentYear,
    appState.currentMonth
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

  // Month & Year Navigation
  const changeMonth = (delta: number) => {
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
    updateStateAndPersist((prev) => ({
      ...prev,
      currentYear: prev.currentYear + delta,
    }));
  };

  const jumpToOct2026 = () => {
    setMonthPickerOpen(false);
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

  // Bulk Month Actions
  const markAllMonth = (status: 'completed') => {
    const daysInMonth = new Date(
      appState.currentYear,
      appState.currentMonth + 1,
      0
    ).getDate();
    updateStateAndPersist((prev) => {
      const nextRecords = { ...prev.records };
      for (let d = 1; d <= daysInMonth; d++) {
        const key = getRecordKey(
          prev.activeTask,
          prev.currentYear,
          prev.currentMonth,
          d
        );
        const existing = nextRecords[key] || { status: null, note: '' };
        nextRecords[key] = { ...existing, status };
      }
      return { ...prev, records: nextRecords };
    });
    showToast(
      `Marked all days in ${MONTH_NAMES[appState.currentMonth]} as Completed!`
    );
  };

  const clearCurrentTaskMonth = () => {
    const daysInMonth = new Date(
      appState.currentYear,
      appState.currentMonth + 1,
      0
    ).getDate();
    updateStateAndPersist((prev) => {
      const nextRecords = { ...prev.records };
      for (let d = 1; d <= daysInMonth; d++) {
        const key = getRecordKey(
          prev.activeTask,
          prev.currentYear,
          prev.currentMonth,
          d
        );
        delete nextRecords[key];
      }
      return { ...prev, records: nextRecords };
    });
    showToast(
      `Cleared ${appState.activeTask} entries for ${MONTH_NAMES[appState.currentMonth]}.`
    );
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
    showToast(`Copied ${type === 'email' ? 'Email ID' : 'Phone Number'}!`);
  };

  // Authentication Handlers (Google Sign-In + Email & Password Sign Up / Sign In)
  const handleGoogleSignIn = async () => {
    setAuthError(null);
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
      setBackendSession(null);
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      setAuthModalOpen(false);
      showToast(
        `Signed in with Google as ${cred.user.displayName || cred.user.email}`
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (!raw.includes('auth/popup-closed-by-user')) {
        setAuthError(raw.replace('Firebase: ', ''));
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
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
      const endpoint =
        authTab === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const mName = authMainName.trim() || 'XXX';
      const sName = authSurname.trim() || 'YYY';
      const phoneVal = authPhone.trim() || '+91 98765 43210';

      // 1. Authenticate with Backend Persistent Account Database
      const apiRes = await fetch(endpoint, {
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
      const apiData = await apiRes.json();
      if (!apiRes.ok) {
        throw new Error(apiData.error || 'Authentication failed.');
      }

      // 2. Also attempt Firebase Email/Password Auth if enabled in Firebase Console
      try {
        if (authTab === 'signup') {
          const cred = await createUserWithEmailAndPassword(
            auth,
            cleanEmail,
            authPassword
          );
          await updateProfile(cred.user, {
            displayName: `${mName} ${sName}`.trim(),
          }).catch(() => {});
          await ensureUserProfileDoc({
            uid: cred.user.uid,
            displayName: `${mName} ${sName}`.trim(),
            email: cleanEmail,
            phoneNumber: phoneVal,
            photoURL: PRESET_AVATARS[0],
          });
        } else {
          await signInWithEmailAndPassword(auth, cleanEmail, authPassword);
        }
      } catch {
        // If Email/Password provider is not toggled on in Firebase Console yet,
        // backend session authentication continues seamlessly across devices.
      }

      // 3. Apply the user's personal dashboard
      sessionStorage.setItem(SESSION_TOKEN_KEY, apiData.token);
      setBackendSession({
        uid: apiData.uid,
        email: apiData.email,
        token: apiData.token,
      });

      const d = apiData.dashboard;
      setAppState({
        profile: {
          mainName: d.profile?.mainName || mName,
          surname: d.profile?.surname || sName,
          email: d.profile?.email || cleanEmail,
          phone: d.profile?.phone || phoneVal,
          photo: d.profile?.photo || PRESET_AVATARS[0],
        },
        tasks:
          Array.isArray(d.tasks) && d.tasks.length > 0 ? d.tasks : ['General'],
        activeTask: d.activeTask || 'General',
        currentYear: typeof d.currentYear === 'number' ? d.currentYear : 2026,
        currentMonth: typeof d.currentMonth === 'number' ? d.currentMonth : 9,
        selectedDay: typeof d.selectedDay === 'number' ? d.selectedDay : 25,
        records: d.records && typeof d.records === 'object' ? d.records : {},
      });

      setAuthPassword('');
      setAuthModalOpen(false);
      showToast(
        authTab === 'signup'
          ? `Account created & dashboard saved for ${cleanEmail}`
          : `Signed in as ${cleanEmail}`
      );
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Authentication failed.'
      );
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
        {/* LEFT SIDEBAR: CLEAN USER PROFILE PANEL */}
        {!sidebarHidden && (
          <aside className="w-full lg:w-[260px] xl:w-[280px] shrink-0 flex flex-col min-h-0">
            <div className="bg-[#0f172a] border border-slate-800/90 rounded-xl overflow-hidden shadow-lg flex flex-col h-full justify-between">
              <div>
                {/* Clean Top Cover Accent (no background text clutter) */}
                <div className="h-12 sidebar-cover" />

                {/* Avatar + Name Section */}
                <div className="px-4 pt-0 pb-4 flex flex-col items-center text-center relative">
                  <div className="relative -mt-8 mb-2.5 group">
                    <div className="w-18 h-18 rounded-full p-0.5 bg-gradient-to-tr from-sky-500 to-indigo-500 shadow-md">
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

                  <p className="mt-1 text-xs text-emerald-400 font-medium">
                    Total Completed: {totalCompletedAllTime}{' '}
                    {totalCompletedAllTime === 1 ? 'Day' : 'Days'}
                  </p>

                  <div className="w-full h-px bg-slate-800/80 my-3.5" />

                  {/* Clean Contact Information List */}
                  <div className="w-full space-y-2.5 text-left">
                    {/* Name Field */}
                    <div className="bg-[#131c2e] border border-slate-800/80 rounded-lg px-3 py-2 flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-md bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-user text-xs"></i>
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
                    <div className="bg-[#131c2e] border border-slate-800/80 rounded-lg px-3 py-2 flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-md bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-envelope text-xs"></i>
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
                    <div className="bg-[#131c2e] border border-slate-800/80 rounded-lg px-3 py-2 flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-phone text-xs"></i>
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
                </div>
              </div>

              {/* Bottom Edit Profile Button */}
              <div className="px-4 pb-4">
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
            <div className="tracker-header-banner py-2.5 px-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                <h2 className="text-xs sm:text-sm font-semibold text-slate-200 tracking-wider uppercase">
                  {appState.activeTask} — {currentMonthName} {appState.currentYear}
                </h2>
              </div>
              <span className="text-xs text-slate-400 font-medium hidden sm:inline">
                Monthly Progress
              </span>
            </div>

            {/* 2. COMPACT TASK TABS, MONTH NAVIGATION & STATS BAR */}
            <div className="px-4 py-2.5 bg-[#0f172a] border-b border-slate-800/80 shrink-0 flex flex-wrap items-center justify-between gap-3">
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

              {/* Right: COMPLETED | NOT COMPLETED | SKIPPED | SUCCESS RATE */}
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

                <div className="stat-rate px-3 py-1 rounded-lg min-w-[92px] text-center">
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
              <div className="py-2 text-center font-semibold text-[11px] border-r border-slate-800/60">
                SUN
              </div>
              <div className="py-2 text-center font-semibold text-[11px] border-r border-slate-800/60">
                MON
              </div>
              <div className="py-2 text-center font-semibold text-[11px] border-r border-slate-800/60">
                TUE
              </div>
              <div className="py-2 text-center font-semibold text-[11px] border-r border-slate-800/60">
                WED
              </div>
              <div className="py-2 text-center font-semibold text-[11px] border-r border-slate-800/60">
                THU
              </div>
              <div className="py-2 text-center font-semibold text-[11px] border-r border-slate-800/60">
                FRI
              </div>
              <div className="py-2 text-center font-semibold text-[11px]">
                SAT
              </div>
            </div>

            {/* 4. 6x7 CALENDAR GRID WITH CLEAN CIRCULAR COLOR-CODED DATES */}
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
                    onClick={() => handleDayCellClick(dayNumber)}
                    className={`calendar-cell active-day p-1 flex items-center justify-center cursor-pointer ${cellStatusClass} ${
                      isSelectedDay ? 'selected-day' : ''
                    }`}
                  >
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
      {/* MODAL 0: SIGN IN / SIGN UP (EMAIL & PASSWORD + GOOGLE) */}
      {/* ========================================== */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="tracker-header-banner px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-100 text-sm sm:text-base tracking-tight flex items-center gap-2">
                <i className="fa-solid fa-shield-halved text-sky-400"></i>{' '}
                {authTab === 'signup'
                  ? 'Create Account'
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

              {/* Sign In / Sign Up Mode Switch Tabs */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0b0f19] rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('signin');
                    setAuthError(null);
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

              {authError && (
                <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-300 text-xs font-medium">
                  {authError}
                </div>
              )}

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
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Password *
                  </label>
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
