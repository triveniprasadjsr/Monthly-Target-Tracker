import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  db,
  generateSafeId,
  handleFirestoreError,
  OperationType,
  sanitizeString,
} from '../lib/firebase';

export const EXPENSE_CATEGORIES = [
  'Food',
  'Travel',
  'Shopping',
  'Bills',
  'Education',
  'Other',
] as const;

export type ExpenseCategoryOption = (typeof EXPENSE_CATEGORIES)[number] | '';

export interface CalendarNoteItem {
  noteId: string;
  uid: string;
  date: string; // YYYY-MM-DD (local date)
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarExpenditureItem {
  expenditureId: string;
  uid: string;
  date: string; // YYYY-MM-DD (local date)
  monthKey: string; // YYYY-MM
  title: string;
  amount: number; // >= 0 in INR
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyExpenditureSummary {
  monthKey: string;
  totalExpenditure: number;
  daysWithExpenses: number;
  averageDailyExpenditure: number;
}

const MONTH_FULL_NAMES = [
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

/**
 * Consistent local-date YYYY-MM-DD formatter (monthIndex is 0-based: 0 = Jan, 9 = Oct)
 */
export function toDateKey(
  year: number,
  monthIndex: number,
  day: number
): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Consistent local-month YYYY-MM formatter (monthIndex is 0-based: 0 = Jan, 9 = Oct)
 */
export function toMonthKey(year: number, monthIndex: number): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(monthIndex + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Human-readable date string, e.g., "25 October 2026"
 */
export function formatFullDateDisplay(
  year: number,
  monthIndex: number,
  day: number
): string {
  const monthName = MONTH_FULL_NAMES[monthIndex] || 'Month';
  return `${day} ${monthName} ${year}`;
}

/**
 * Formats an amount in Indian Rupees (₹).
 * Whole numbers render as e.g. "₹850" or "₹0", fractional numbers render with 2 decimals e.g. "₹283.33".
 */
export function formatINR(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) {
    return '₹0';
  }
  const rounded = Math.round(amount * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 1e-9;
  if (isWhole) {
    return `₹${Math.round(rounded).toLocaleString('en-IN')}`;
  }
  return `₹${rounded.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Calculates the monthly task completion percentage based on ALL dates of the month.
 * Only Green ('completed') counts in the numerator; Red, Yellow (Skipped), and Unmarked are unconsidered.
 */
export function computeMonthCompletionPercentage(
  completedDaysCount: number,
  year: number,
  monthIndex: number
): number {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  if (daysInMonth <= 0) return 0;
  const clamped = Math.max(0, Math.min(daysInMonth, completedDaysCount));
  return Math.round((clamped / daysInMonth) * 100);
}

/**
 * Returns all notes for a specific YYYY-MM-DD date sorted chronologically
 */
export function getNotesForDate(
  notes: CalendarNoteItem[],
  dateKey: string
): CalendarNoteItem[] {
  return notes
    .filter((n) => n.date === dateKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Returns all expenditure entries for a specific YYYY-MM-DD date sorted chronologically
 */
export function getExpendituresForDate(
  expenditures: CalendarExpenditureItem[],
  dateKey: string
): CalendarExpenditureItem[] {
  return expenditures
    .filter((e) => e.date === dateKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Computes the daily expenditure total and whether the date has any recorded expense entry
 */
export function getDailyExpenditureInfo(
  expenditures: CalendarExpenditureItem[],
  dateKey: string
): { hasEntries: boolean; dailyTotal: number; count: number } {
  const list = expenditures.filter((e) => e.date === dateKey);
  if (list.length === 0) {
    return { hasEntries: false, dailyTotal: 0, count: 0 };
  }
  const sum = list.reduce(
    (acc, item) => acc + (Number.isFinite(item.amount) ? item.amount : 0),
    0
  );
  return {
    hasEntries: true,
    dailyTotal: Math.round(sum * 100) / 100,
    count: list.length,
  };
}

/**
 * Recalculates the Monthly Expenditure Summary directly from saved expenditure records
 * for the selected year and month (0-based monthIndex).
 */
export function computeMonthlyExpenditureSummary(
  expenditures: CalendarExpenditureItem[],
  year: number,
  monthIndex: number
): MonthlyExpenditureSummary {
  const targetMonthKey = toMonthKey(year, monthIndex);
  const monthEntries = expenditures.filter(
    (e) => e.monthKey === targetMonthKey || e.date.startsWith(`${targetMonthKey}-`)
  );

  if (monthEntries.length === 0) {
    return {
      monthKey: targetMonthKey,
      totalExpenditure: 0,
      daysWithExpenses: 0,
      averageDailyExpenditure: 0,
    };
  }

  const dailyTotalsByDate = new Map<string, number>();
  let rawTotal = 0;

  for (const entry of monthEntries) {
    const amt = Number.isFinite(entry.amount) && entry.amount >= 0 ? entry.amount : 0;
    rawTotal += amt;
    dailyTotalsByDate.set(
      entry.date,
      (dailyTotalsByDate.get(entry.date) || 0) + amt
    );
  }

  const totalExpenditure = Math.round(rawTotal * 100) / 100;

  // Count distinct days in this month that have positive recorded expenditure (> 0)
  let daysWithExpenses = 0;
  for (const daySum of dailyTotalsByDate.values()) {
    if (daySum > 0) {
      daysWithExpenses++;
    }
  }

  const averageDailyExpenditure =
    daysWithExpenses > 0
      ? Math.round((totalExpenditure / daysWithExpenses) * 100) / 100
      : 0;

  return {
    monthKey: targetMonthKey,
    totalExpenditure,
    daysWithExpenses,
    averageDailyExpenditure,
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
 * Subscribes to the authenticated user's calendar notes in users/{uid}/notes
 */
export function subscribeToUserNotes(
  uid: string,
  onData: (notes: CalendarNoteItem[]) => void
): () => void {
  const path = `users/${uid}/notes`;
  const notesCol = collection(db, 'users', uid, 'notes');
  return onSnapshot(
    notesCol,
    (snap) => {
      const items: CalendarNoteItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          noteId: String(data.noteId || d.id),
          uid: String(data.uid || uid),
          date: String(data.date || ''),
          title: String(data.title || ''),
          description: String(data.description || ''),
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt),
        };
      });
      onData(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

/**
 * Subscribes to the authenticated user's calendar expenditures in users/{uid}/expenditures
 */
export function subscribeToUserExpenditures(
  uid: string,
  onData: (expenditures: CalendarExpenditureItem[]) => void
): () => void {
  const path = `users/${uid}/expenditures`;
  const expCol = collection(db, 'users', uid, 'expenditures');
  return onSnapshot(
    expCol,
    (snap) => {
      const items: CalendarExpenditureItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          expenditureId: String(data.expenditureId || d.id),
          uid: String(data.uid || uid),
          date: String(data.date || ''),
          monthKey: String(data.monthKey || String(data.date || '').slice(0, 7)),
          title: String(data.title || ''),
          amount: Number(data.amount) >= 0 ? Number(data.amount) : 0,
          category: String(data.category || ''),
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt),
        };
      });
      onData(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

/**
 * Creates a new CalendarNote in Firestore
 */
export async function createCalendarNoteInFirestore(
  uid: string,
  input: { date: string; title: string; description: string }
): Promise<CalendarNoteItem> {
  const noteId = generateSafeId('note');
  const path = `users/${uid}/notes/${noteId}`;
  const noteRef = doc(db, 'users', uid, 'notes', noteId);

  const cleanTitle = sanitizeString(input.title, 150);
  if (!cleanTitle) {
    throw new Error('Note title cannot be empty.');
  }
  const cleanDesc = sanitizeString(input.description || '', 2000);
  const cleanDate = sanitizeString(input.date, 10);

  const payload = {
    noteId,
    uid: sanitizeString(uid, 128),
    date: cleanDate,
    title: cleanTitle,
    description: cleanDesc,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(noteRef, payload);
    const nowIso = new Date().toISOString();
    return {
      noteId,
      uid,
      date: cleanDate,
      title: cleanTitle,
      description: cleanDesc,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Updates an existing CalendarNote in Firestore
 */
export async function updateCalendarNoteInFirestore(
  uid: string,
  noteId: string,
  input: { title: string; description: string }
): Promise<void> {
  const path = `users/${uid}/notes/${noteId}`;
  const noteRef = doc(db, 'users', uid, 'notes', noteId);

  const cleanTitle = sanitizeString(input.title, 150);
  if (!cleanTitle) {
    throw new Error('Note title cannot be empty.');
  }
  const cleanDesc = sanitizeString(input.description || '', 2000);

  try {
    await updateDoc(noteRef, {
      title: cleanTitle,
      description: cleanDesc,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Deletes a CalendarNote from Firestore
 */
export async function deleteCalendarNoteFromFirestore(
  uid: string,
  noteId: string
): Promise<void> {
  const path = `users/${uid}/notes/${noteId}`;
  const noteRef = doc(db, 'users', uid, 'notes', noteId);
  try {
    await deleteDoc(noteRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Creates a new CalendarExpenditure in Firestore
 */
export async function createCalendarExpenditureInFirestore(
  uid: string,
  input: {
    date: string;
    title: string;
    amount: number;
    category: string;
  }
): Promise<CalendarExpenditureItem> {
  const expenditureId = generateSafeId('exp');
  const path = `users/${uid}/expenditures/${expenditureId}`;
  const expRef = doc(db, 'users', uid, 'expenditures', expenditureId);

  const cleanTitle = sanitizeString(input.title, 150);
  if (!cleanTitle) {
    throw new Error('Expenditure title or description is required.');
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error('Amount must be 0 or a positive number.');
  }
  const cleanAmount = Math.min(100000000, Math.round(input.amount * 100) / 100);
  const cleanDate = sanitizeString(input.date, 10);
  const cleanMonthKey = cleanDate.slice(0, 7);
  const cleanCategory = sanitizeString(input.category || '', 60);

  const payload = {
    expenditureId,
    uid: sanitizeString(uid, 128),
    date: cleanDate,
    monthKey: cleanMonthKey,
    title: cleanTitle,
    amount: cleanAmount,
    category: cleanCategory,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(expRef, payload);
    const nowIso = new Date().toISOString();
    return {
      expenditureId,
      uid,
      date: cleanDate,
      monthKey: cleanMonthKey,
      title: cleanTitle,
      amount: cleanAmount,
      category: cleanCategory,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Updates an existing CalendarExpenditure in Firestore
 */
export async function updateCalendarExpenditureInFirestore(
  uid: string,
  expenditureId: string,
  input: {
    title: string;
    amount: number;
    category: string;
  }
): Promise<void> {
  const path = `users/${uid}/expenditures/${expenditureId}`;
  const expRef = doc(db, 'users', uid, 'expenditures', expenditureId);

  const cleanTitle = sanitizeString(input.title, 150);
  if (!cleanTitle) {
    throw new Error('Expenditure title or description is required.');
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error('Amount must be 0 or a positive number.');
  }
  const cleanAmount = Math.min(100000000, Math.round(input.amount * 100) / 100);
  const cleanCategory = sanitizeString(input.category || '', 60);

  try {
    await updateDoc(expRef, {
      title: cleanTitle,
      amount: cleanAmount,
      category: cleanCategory,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Deletes a CalendarExpenditure from Firestore
 */
export async function deleteCalendarExpenditureFromFirestore(
  uid: string,
  expenditureId: string
): Promise<void> {
  const path = `users/${uid}/expenditures/${expenditureId}`;
  const expRef = doc(db, 'users', uid, 'expenditures', expenditureId);
  try {
    await deleteDoc(expRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
