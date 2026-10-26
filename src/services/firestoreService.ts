import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  db,
  generateSafeId,
  handleFirestoreError,
  OperationType,
  sanitizeString,
} from '../lib/firebase';
import type {
  CurrencyCode,
  DailyRecord,
  DailyStatus,
  ExpenseRecord,
  ThemePreference,
  Tracker,
  TrackerType,
  TrackingMethod,
  UserProfile,
  UserSettings,
} from '../types/tracker';

const inFlightProfileRequests = new Map<string, Promise<UserProfile>>();

/**
 * Ensures the authenticated user's profile document exists in users/{uid}.
 * Deduplicates concurrent calls for the same uid to prevent duplicate profile creation races.
 */
export async function ensureUserProfileDoc(params: {
  uid: string;
  displayName: string;
  email: string;
  phoneNumber?: string;
  photoURL?: string;
}): Promise<UserProfile> {
  const existingPromise = inFlightProfileRequests.get(params.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const task = (async (): Promise<UserProfile> => {
    const path = `users/${params.uid}`;
    const userRef = doc(db, 'users', params.uid);
    try {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        return snap.data() as UserProfile;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }

    const safeEmail =
      sanitizeString(params.email || 'user@example.com', 254) ||
      'user@example.com';
    const profileData = {
      uid: sanitizeString(params.uid, 128),
      displayName: sanitizeString(params.displayName || 'User', 100) || 'User',
      email: safeEmail.length >= 3 ? safeEmail : 'user@example.com',
      phoneNumber: sanitizeString(params.phoneNumber || '', 30),
      photoURL: sanitizeString(params.photoURL || '', 25000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(userRef, profileData);
      return {
        ...profileData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      // If a concurrent request just created the doc, read and return it instead of failing
      try {
        const retrySnap = await getDoc(userRef);
        if (retrySnap.exists()) {
          return retrySnap.data() as UserProfile;
        }
      } catch {
        // Ignore retry read error and report original error
      }
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  })();

  inFlightProfileRequests.set(params.uid, task);
  try {
    return await task;
  } finally {
    inFlightProfileRequests.delete(params.uid);
  }
}

/**
 * Updates user profile fields in users/{uid}
 */
export async function updateUserProfileDoc(
  uid: string,
  updates: {
    displayName: string;
    phoneNumber: string;
    photoURL: string;
    email: string;
  }
): Promise<void> {
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  try {
    await updateDoc(userRef, {
      displayName: sanitizeString(updates.displayName || 'User', 100) || 'User',
      phoneNumber: sanitizeString(updates.phoneNumber || '', 30),
      photoURL: sanitizeString(updates.photoURL || '', 25000),
      email: sanitizeString(updates.email || 'user@example.com', 254),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Ensures the user's preferences document exists in users/{uid}/settings/preferences
 */
export async function ensureUserSettingsDoc(uid: string): Promise<UserSettings> {
  const settingId = 'preferences';
  const path = `users/${uid}/settings/${settingId}`;
  const settingRef = doc(db, 'users', uid, 'settings', settingId);

  try {
    const snap = await getDoc(settingRef);
    if (snap.exists()) {
      return snap.data() as UserSettings;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  const detectedTz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

  const initialSettings = {
    settingId,
    uid: sanitizeString(uid, 128),
    theme: 'light' as ThemePreference,
    currency: 'INR' as CurrencyCode,
    weekStartsOn: 0 as 0 | 1,
    defaultTrackerId: '',
    timezone: sanitizeString(detectedTz, 80),
    excludedWeekdays: [] as number[],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(settingRef, initialSettings);
    return initialSettings;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Updates user preferences in users/{uid}/settings/preferences
 */
export async function updateUserSettingsDoc(
  uid: string,
  updates: {
    theme: ThemePreference;
    currency: CurrencyCode;
    weekStartsOn: 0 | 1;
    defaultTrackerId: string;
    timezone: string;
    excludedWeekdays: number[];
  }
): Promise<void> {
  const settingId = 'preferences';
  const path = `users/${uid}/settings/${settingId}`;
  const settingRef = doc(db, 'users', uid, 'settings', settingId);

  const validExcluded = (updates.excludedWeekdays || [])
    .filter((d) => typeof d === 'number' && d >= 0 && d <= 6)
    .slice(0, 6);

  try {
    await updateDoc(settingRef, {
      theme: updates.theme,
      currency: updates.currency,
      weekStartsOn: updates.weekStartsOn === 1 ? 1 : 0,
      defaultTrackerId: sanitizeString(updates.defaultTrackerId || '', 128),
      timezone: sanitizeString(updates.timezone || 'Asia/Kolkata', 80) || 'Asia/Kolkata',
      excludedWeekdays: validExcluded,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Creates a new Tracker in users/{uid}/trackers/{trackerId}
 */
export async function createTrackerDoc(
  uid: string,
  input: {
    name: string;
    type: TrackerType;
    description?: string;
    trackingMethod?: TrackingMethod;
    monthlyGoal?: number;
    dailyTargetHours?: number;
    defaultSubject?: string;
    defaultTask?: string;
  }
): Promise<Tracker> {
  const trackerId = generateSafeId('trk');
  const path = `users/${uid}/trackers/${trackerId}`;
  const trackerRef = doc(db, 'users', uid, 'trackers', trackerId);

  const resolvedMethod: TrackingMethod =
    input.trackingMethod ||
    (input.type === 'expense'
      ? 'expense_log'
      : input.type === 'study'
        ? 'study_hours'
        : 'status');

  const safeGoal = Math.max(
    0,
    Math.min(100000000, Number(input.monthlyGoal) || 0)
  );
  const safeDailyHours = Math.max(
    0,
    Math.min(24, Number(input.dailyTargetHours) || 0)
  );

  const payload = {
    trackerId,
    uid: sanitizeString(uid, 128),
    name: sanitizeString(input.name || 'Untitled Tracker', 100) || 'Untitled Tracker',
    type: input.type,
    description: sanitizeString(input.description || '', 500),
    trackingMethod: resolvedMethod,
    monthlyGoal: safeGoal,
    dailyTargetHours: safeDailyHours,
    defaultSubject: sanitizeString(input.defaultSubject || '', 100),
    defaultTask: sanitizeString(input.defaultTask || '', 300),
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(trackerRef, payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Updates an existing Tracker in users/{uid}/trackers/{trackerId}
 */
export async function updateTrackerDoc(
  uid: string,
  trackerId: string,
  updates: {
    name: string;
    type: TrackerType;
    description: string;
    trackingMethod: TrackingMethod;
    monthlyGoal: number;
    dailyTargetHours: number;
    defaultSubject: string;
    defaultTask: string;
    archived: boolean;
  }
): Promise<void> {
  const path = `users/${uid}/trackers/${trackerId}`;
  const trackerRef = doc(db, 'users', uid, 'trackers', trackerId);

  try {
    await updateDoc(trackerRef, {
      name: sanitizeString(updates.name || 'Untitled Tracker', 100) || 'Untitled Tracker',
      type: updates.type,
      description: sanitizeString(updates.description || '', 500),
      trackingMethod: updates.trackingMethod,
      monthlyGoal: Math.max(0, Math.min(100000000, Number(updates.monthlyGoal) || 0)),
      dailyTargetHours: Math.max(
        0,
        Math.min(24, Number(updates.dailyTargetHours) || 0)
      ),
      defaultSubject: sanitizeString(updates.defaultSubject || '', 100),
      defaultTask: sanitizeString(updates.defaultTask || '', 300),
      archived: Boolean(updates.archived),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Permanently deletes a Tracker and all its associated dailyRecords or expenses
 */
export async function deleteTrackerAndRecords(
  uid: string,
  tracker: Tracker
): Promise<void> {
  // 1. Delete daily records in users/{uid}/trackers/{trackerId}/dailyRecords
  const dailyColPath = `users/${uid}/trackers/${tracker.trackerId}/dailyRecords`;
  try {
    const dailyQ = query(
      collection(db, 'users', uid, 'trackers', tracker.trackerId, 'dailyRecords'),
      where('uid', '==', uid)
    );
    const snap = await getDocs(dailyQ);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, dailyColPath);
  }

  // 2. If Expense Tracker, delete associated expense records
  if (tracker.type === 'expense' || tracker.trackingMethod === 'expense_log') {
    const expColPath = `users/${uid}/expenses`;
    try {
      const expQ = query(
        collection(db, 'users', uid, 'expenses'),
        where('uid', '==', uid),
        where('trackerId', '==', tracker.trackerId)
      );
      const expSnap = await getDocs(expQ);
      for (const e of expSnap.docs) {
        await deleteDoc(e.ref);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, expColPath);
    }
  }

  // 3. Delete tracker document itself
  const trackerPath = `users/${uid}/trackers/${tracker.trackerId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'trackers', tracker.trackerId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, trackerPath);
  }
}

/**
 * Saves or updates a DailyRecord at users/{uid}/trackers/{trackerId}/dailyRecords/{dateId}
 */
export async function upsertDailyRecordDoc(params: {
  uid: string;
  trackerId: string;
  dateId: string;
  status: DailyStatus;
  subject?: string;
  taskDescription?: string;
  studyDurationMinutes?: number;
  notes?: string;
  existingRecord?: DailyRecord;
}): Promise<void> {
  const { uid, trackerId, dateId, existingRecord } = params;
  const path = `users/${uid}/trackers/${trackerId}/dailyRecords/${dateId}`;
  const recordRef = doc(
    db,
    'users',
    uid,
    'trackers',
    trackerId,
    'dailyRecords',
    dateId
  );

  const safeStatus: DailyStatus = params.status;
  const safeSubject = sanitizeString(
    params.subject ?? existingRecord?.subject ?? '',
    100
  );
  const safeTask = sanitizeString(
    params.taskDescription ?? existingRecord?.taskDescription ?? '',
    500
  );
  const safeMins = Math.max(
    0,
    Math.min(
      1440,
      Math.round(
        Number(
          params.studyDurationMinutes ?? existingRecord?.studyDurationMinutes ?? 0
        ) || 0
      )
    )
  );
  const safeNotes = sanitizeString(
    params.notes ?? existingRecord?.notes ?? '',
    1000
  );

  // If status is cleared ('not_marked') and there are no study minutes, task, or notes, delete the record cleanly
  if (
    safeStatus === 'not_marked' &&
    safeMins === 0 &&
    !safeTask &&
    !safeNotes &&
    existingRecord
  ) {
    try {
      await deleteDoc(recordRef);
      return;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  if (existingRecord) {
    try {
      await updateDoc(recordRef, {
        status: safeStatus,
        subject: safeSubject,
        taskDescription: safeTask,
        studyDurationMinutes: safeMins,
        notes: safeNotes,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(recordRef, {
        date: dateId,
        uid: sanitizeString(uid, 128),
        trackerId: sanitizeString(trackerId, 128),
        status: safeStatus,
        subject: safeSubject,
        taskDescription: safeTask,
        studyDurationMinutes: safeMins,
        notes: safeNotes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }
}

/**
 * Creates a new ExpenseRecord in users/{uid}/expenses/{expenseId}
 */
export async function createExpenseRecordDoc(params: {
  uid: string;
  trackerId: string;
  dateId: string;
  title: string;
  amount: number;
  category: string;
  paymentMethod?: string;
  notes?: string;
}): Promise<ExpenseRecord> {
  const expenseId = generateSafeId('exp');
  const path = `users/${params.uid}/expenses/${expenseId}`;
  const expRef = doc(db, 'users', params.uid, 'expenses', expenseId);
  const monthKey = params.dateId.slice(0, 7);

  const safeAmount = Math.max(
    0.01,
    Math.min(100000000, Math.round(Number(params.amount) * 100) / 100)
  );

  const payload = {
    expenseId,
    uid: sanitizeString(params.uid, 128),
    trackerId: sanitizeString(params.trackerId, 128),
    date: params.dateId,
    monthKey,
    title: sanitizeString(params.title || 'Expense', 150) || 'Expense',
    amount: safeAmount,
    category: sanitizeString(params.category || 'Other', 60) || 'Other',
    paymentMethod: sanitizeString(params.paymentMethod || 'UPI', 50),
    notes: sanitizeString(params.notes || '', 500),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(expRef, payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Updates an existing ExpenseRecord in users/{uid}/expenses/{expenseId}
 */
export async function updateExpenseRecordDoc(params: {
  uid: string;
  expenseId: string;
  dateId: string;
  title: string;
  amount: number;
  category: string;
  paymentMethod: string;
  notes: string;
}): Promise<void> {
  const path = `users/${params.uid}/expenses/${params.expenseId}`;
  const expRef = doc(db, 'users', params.uid, 'expenses', params.expenseId);
  const monthKey = params.dateId.slice(0, 7);
  const safeAmount = Math.max(
    0.01,
    Math.min(100000000, Math.round(Number(params.amount) * 100) / 100)
  );

  try {
    await updateDoc(expRef, {
      date: params.dateId,
      monthKey,
      title: sanitizeString(params.title || 'Expense', 150) || 'Expense',
      amount: safeAmount,
      category: sanitizeString(params.category || 'Other', 60) || 'Other',
      paymentMethod: sanitizeString(params.paymentMethod || 'UPI', 50),
      notes: sanitizeString(params.notes || '', 500),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Deletes an ExpenseRecord in users/{uid}/expenses/{expenseId}
 */
export async function deleteExpenseRecordDoc(
  uid: string,
  expenseId: string
): Promise<void> {
  const path = `users/${uid}/expenses/${expenseId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'expenses', expenseId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
