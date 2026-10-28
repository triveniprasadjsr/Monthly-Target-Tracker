import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
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

export interface WeekdayOption {
  index: number; // 0 = Sunday .. 6 = Saturday
  short: string;
  full: string;
}

export const WEEKDAY_OPTIONS: readonly WeekdayOption[] = [
  { index: 0, short: 'Sun', full: 'Sunday' },
  { index: 1, short: 'Mon', full: 'Monday' },
  { index: 2, short: 'Tue', full: 'Tuesday' },
  { index: 3, short: 'Wed', full: 'Wednesday' },
  { index: 4, short: 'Thu', full: 'Thursday' },
  { index: 5, short: 'Fri', full: 'Friday' },
  { index: 6, short: 'Sat', full: 'Saturday' },
] as const;

export interface TaskConfigItem {
  taskId: string;
  uid: string;
  name: string;
  targetDays: number[]; // [] means all 7 weekdays allowed
  createdAt: string;
  updatedAt: string;
}

export interface TaskConfigMapEntry {
  taskId: string;
  name: string;
  targetDays: number[];
}

/**
 * Normalizes and sorts an array of weekday indices (0 = Sunday .. 6 = Saturday).
 * If all 7 days are selected, normalizes to [] (every day allowed) or keeps sorted unique values.
 */
export function normalizeTargetDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  const valid = Array.from(
    new Set(
      days
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    )
  ).sort((a, b) => a - b);
  return valid;
}

/**
 * Human-readable label for a task's target weekday schedule
 */
export function formatTargetDaysSummary(targetDays?: number[]): string {
  const normalized = normalizeTargetDays(targetDays);
  if (normalized.length === 0 || normalized.length === 7) {
    return 'Every day';
  }
  return normalized
    .map((idx) => WEEKDAY_OPTIONS[idx]?.short || '')
    .filter(Boolean)
    .join(', ');
}

/**
 * Determines whether a given calendar date (year, 0-based monthIndex, day) is allowed
 * for progress tracking under the task's targetDays configuration.
 * If targetDays is empty ([]), tracking is allowed every day.
 */
export function isDateAllowedByTargetDays(
  year: number,
  monthIndex: number,
  day: number,
  targetDays?: number[]
): boolean {
  const normalized = normalizeTargetDays(targetDays);
  if (normalized.length === 0 || normalized.length === 7) {
    return true;
  }
  const weekday = new Date(year, monthIndex, day).getDay();
  return normalized.includes(weekday);
}

/**
 * Computes monthly statistics for a task taking its Target Weekdays into account.
 * Disallowed weekdays are excluded from target-based statistics and completion percentage.
 */
export function computeTaskMonthStatsWithTargetDays(
  taskName: string,
  year: number,
  monthIndex: number,
  records: Record<string, { status: string | null; note: string }>,
  targetDays?: number[]
): {
  completed: number;
  notCompleted: number;
  skipped: number;
  rate: number;
  daysInMonth: number;
  eligibleDaysInMonth: number;
} {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  let completed = 0;
  let notCompleted = 0;
  let skipped = 0;
  let eligibleDaysInMonth = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const allowed = isDateAllowedByTargetDays(year, monthIndex, d, targetDays);
    if (!allowed) {
      continue;
    }
    eligibleDaysInMonth++;
    const key = `${taskName}__${year}-${monthIndex}__${d}`;
    const rawStatus = records[key]?.status;
    if (rawStatus === 'completed' || rawStatus === 'met') {
      completed++;
    } else if (rawStatus === 'not_completed' || rawStatus === 'missed') {
      notCompleted++;
    } else if (rawStatus === 'skipped') {
      skipped++;
    }
  }

  const rate =
    eligibleDaysInMonth > 0
      ? Math.round(
          (Math.max(0, Math.min(eligibleDaysInMonth, completed)) /
            eligibleDaysInMonth) *
            100
        )
      : 0;

  return {
    completed,
    notCompleted,
    skipped,
    rate,
    daysInMonth,
    eligibleDaysInMonth,
  };
}

function timestampToIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (
    typeof val === 'object' &&
    val !== null &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

/**
 * Subscribes to the authenticated user's tasks in users/{uid}/tasks
 * Uses where('uid', '==', uid) to satisfy Firestore security rules for list queries.
 */
export function subscribeToUserTasks(
  uid: string,
  onData: (tasks: TaskConfigItem[]) => void
): () => void {
  const path = `users/${uid}/tasks`;
  const tasksQuery = query(
    collection(db, 'users', uid, 'tasks'),
    where('uid', '==', uid)
  );
  return onSnapshot(
    tasksQuery,
    (snap) => {
      const items: TaskConfigItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          taskId: String(data.taskId || d.id),
          uid: String(data.uid || uid),
          name: String(data.name || 'General'),
          targetDays: normalizeTargetDays(data.targetDays),
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt),
        };
      });
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch {
        // Prevent uncaught snapshot error from breaking UI state
      }
    }
  );
}

/**
 * Creates or overwrites a TaskItem document in users/{uid}/tasks/{taskId}
 */
export async function saveTaskInFirestore(
  uid: string,
  input: {
    taskId?: string;
    name: string;
    targetDays: number[];
  }
): Promise<TaskConfigItem> {
  const cleanName = sanitizeString(input.name, 100);
  if (!cleanName) {
    throw new Error('Task name cannot be empty.');
  }
  const taskId = input.taskId || generateSafeId('tsk');
  const path = `users/${uid}/tasks/${taskId}`;
  const taskRef = doc(db, 'users', uid, 'tasks', taskId);
  const cleanTargetDays = normalizeTargetDays(input.targetDays);

  const payload = {
    taskId,
    uid: sanitizeString(uid, 128),
    name: cleanName,
    targetDays: cleanTargetDays,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(taskRef, payload);
    const nowIso = new Date().toISOString();
    return {
      taskId,
      uid,
      name: cleanName,
      targetDays: cleanTargetDays,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Updates an existing TaskItem in users/{uid}/tasks/{taskId}
 */
export async function updateTaskInFirestore(
  uid: string,
  taskId: string,
  updates: {
    name: string;
    targetDays: number[];
  }
): Promise<void> {
  const cleanName = sanitizeString(updates.name, 100);
  if (!cleanName) {
    throw new Error('Task name cannot be empty.');
  }
  const path = `users/${uid}/tasks/${taskId}`;
  const taskRef = doc(db, 'users', uid, 'tasks', taskId);
  const cleanTargetDays = normalizeTargetDays(updates.targetDays);

  try {
    await updateDoc(taskRef, {
      name: cleanName,
      targetDays: cleanTargetDays,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    // If document didn't exist yet (e.g. legacy task from dashboard array), create it
    try {
      await setDoc(taskRef, {
        taskId,
        uid: sanitizeString(uid, 128),
        name: cleanName,
        targetDays: cleanTargetDays,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (innerErr) {
      handleFirestoreError(innerErr, OperationType.UPDATE, path);
    }
  }
}

/**
 * Writes or deletes a daily progress document in users/{uid}/tasks/{taskId}/progress/{dateKey}
 */
export async function syncTaskProgressInFirestore(
  uid: string,
  taskId: string,
  dateKey: string,
  status: 'completed' | 'not_completed' | 'skipped' | null,
  note = ''
): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}/progress/${dateKey}`;
  const progRef = doc(db, 'users', uid, 'tasks', taskId, 'progress', dateKey);

  if (!status && !note) {
    try {
      await deleteDoc(progRef);
    } catch {
      // Ignore if already absent
    }
    return;
  }

  try {
    await setDoc(progRef, {
      date: sanitizeString(dateKey, 10),
      uid: sanitizeString(uid, 128),
      taskId: sanitizeString(taskId, 128),
      status: status || 'not_marked',
      note: sanitizeString(note, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.WRITE, path);
    } catch {
      // Non-fatal background sync
    }
  }
}

/**
 * Deletes a task document and all its progress documents in users/{uid}/tasks/{taskId}/progress
 */
export async function deleteTaskAndProgressFromFirestore(
  uid: string,
  taskId: string
): Promise<void> {
  const progressColPath = `users/${uid}/tasks/${taskId}/progress`;
  try {
    const progQuery = query(
      collection(db, 'users', uid, 'tasks', taskId, 'progress'),
      where('uid', '==', uid)
    );
    const snap = await getDocs(progQuery);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch {
    // Ignore if progress subcollection is empty
  }

  const taskPath = `users/${uid}/tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tasks', taskId));
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.DELETE, taskPath);
    } catch {
      // Ignore if task was only stored in dashboard array
    }
  }
}
