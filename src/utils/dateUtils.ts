import type {
  ActivityMonthlyStats,
  CurrencyCode,
  DailyRecord,
  ExpenseMonthlyStats,
  ExpenseRecord,
  StudyMonthlyStats,
  Tracker,
} from '../types/tracker';

export const MONTH_NAMES = [
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

export const WEEKDAY_NAMES_SUN = [
  { short: 'Sun', full: 'Sunday', index: 0 },
  { short: 'Mon', full: 'Monday', index: 1 },
  { short: 'Tue', full: 'Tuesday', index: 2 },
  { short: 'Wed', full: 'Wednesday', index: 3 },
  { short: 'Thu', full: 'Thursday', index: 4 },
  { short: 'Fri', full: 'Friday', index: 5 },
  { short: 'Sat', full: 'Saturday', index: 6 },
];

export const WEEKDAY_NAMES_MON = [
  { short: 'Mon', full: 'Monday', index: 1 },
  { short: 'Tue', full: 'Tuesday', index: 2 },
  { short: 'Wed', full: 'Wednesday', index: 3 },
  { short: 'Thu', full: 'Thursday', index: 4 },
  { short: 'Fri', full: 'Friday', index: 5 },
  { short: 'Sat', full: 'Saturday', index: 6 },
  { short: 'Sun', full: 'Sunday', index: 0 },
];

export const STUDY_SUBJECT_SUGGESTIONS = [
  'Physics',
  'Mathematics',
  'Electrical Engineering',
  'Chemistry',
  'General Studies',
  'Computer Science',
  'Custom Subject',
];

export const EXPENSE_CATEGORIES = [
  'Education',
  'Food & Dining',
  'Books & Supplies',
  'Transport',
  'Housing & Utilities',
  'Health & Fitness',
  'Personal & Subscriptions',
  'Other',
];

export const PAYMENT_METHODS = [
  'UPI',
  'Cash',
  'Debit Card',
  'Credit Card',
  'Net Banking',
];

/**
 * Checks if a year is a leap year
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns exact number of days in a month (0-indexed month: 0 = Jan, 1 = Feb, ..., 11 = Dec)
 */
export function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Formats year, 0-indexed month, and day into YYYY-MM-DD in local time
 */
export function formatDateId(year: number, monthIndex: number, day: number): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formats year and 0-indexed month into YYYY-MM
 */
export function formatMonthKey(year: number, monthIndex: number): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(monthIndex + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Returns today's date in the user's local timezone as YYYY-MM-DD
 */
export function getTodayLocalDateId(): string {
  const now = new Date();
  return formatDateId(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Parses YYYY-MM-DD into a human-readable string like "Sunday, October 25, 2026"
 */
export function formatReadableDate(dateId: string): string {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return dateId;
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function getWeekdayName(dateId: string): string {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('en-US', { weekday: 'long' });
}

export interface CalendarCellData {
  dateId: string; // YYYY-MM-DD
  dayNumber: number;
  weekdayIndex: number; // 0 (Sun) - 6 (Sat)
  isToday: boolean;
  isFuture: boolean;
  isExcludedWeekday: boolean;
}

/**
 * Builds the calendar grid cells (with leading and trailing null padding slots)
 */
export function buildMonthlyCalendarGrid(
  year: number,
  monthIndex: number,
  weekStartsOn: 0 | 1,
  excludedWeekdays: number[]
): (CalendarCellData | null)[] {
  const daysInMonth = getDaysInMonth(year, monthIndex);
  const firstDayWeekday = new Date(year, monthIndex, 1).getDay(); // 0 (Sun) .. 6 (Sat)
  const todayId = getTodayLocalDateId();

  const leadingEmptyCount =
    weekStartsOn === 0
      ? firstDayWeekday
      : (firstDayWeekday === 0 ? 6 : firstDayWeekday - 1);

  const cells: (CalendarCellData | null)[] = [];
  for (let i = 0; i < leadingEmptyCount; i++) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateId = formatDateId(year, monthIndex, day);
    const weekdayIndex = new Date(year, monthIndex, day).getDay();
    cells.push({
      dateId,
      dayNumber: day,
      weekdayIndex,
      isToday: dateId === todayId,
      isFuture: dateId > todayId,
      isExcludedWeekday: excludedWeekdays.includes(weekdayIndex),
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

/**
 * Formats currency using Indian numbering system for INR (e.g. ₹1,50,000)
 */
export function formatCurrency(amount: number, currency: CurrencyCode = 'INR'): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: safeAmount % 1 === 0 ? 0 : 2,
  }).format(safeAmount);
}

/**
 * Formats minutes into "Xh Ym"
 */
export function formatDurationMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return '0h';
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
}

/**
 * Calculates Activity Monthly Statistics strictly from saved Firestore records.
 * Future dates are never counted as failures or eligible days.
 */
export function calculateActivityMonthlyStats(
  year: number,
  monthIndex: number,
  recordsByDate: Record<string, DailyRecord>,
  excludedWeekdays: number[],
  monthlyGoal: number
): ActivityMonthlyStats {
  const totalDaysInMonth = getDaysInMonth(year, monthIndex);
  const todayId = getTodayLocalDateId();

  let eligibleDays = 0;
  let excludedDaysCount = 0;
  let futureDaysCount = 0;
  let completedDays = 0;
  let notCompletedDays = 0;
  let skippedDays = 0;
  let unmarkedDays = 0;

  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dateId = formatDateId(year, monthIndex, day);
    const weekday = new Date(year, monthIndex, day).getDay();
    const record = recordsByDate[dateId];
    const status = record?.status ?? 'not_marked';

    if (status === 'completed') completedDays++;
    else if (status === 'not_completed') notCompletedDays++;
    else if (status === 'skipped') skippedDays++;
    else unmarkedDays++;

    if (dateId > todayId) {
      futureDaysCount++;
    } else if (excludedWeekdays.includes(weekday)) {
      excludedDaysCount++;
    } else {
      eligibleDays++;
    }
  }

  const completionPercentage =
    eligibleDays > 0
      ? Math.min(100, Math.round((completedDays / eligibleDays) * 1000) / 10)
      : 0;

  const effectiveGoal = monthlyGoal > 0 ? monthlyGoal : eligibleDays;
  const goalAchievementPercentage =
    effectiveGoal > 0
      ? Math.min(100, Math.round((completedDays / effectiveGoal) * 1000) / 10)
      : 0;

  return {
    totalDaysInMonth,
    eligibleDays,
    excludedDaysCount,
    futureDaysCount,
    completedDays,
    notCompletedDays,
    skippedDays,
    unmarkedDays,
    completionPercentage,
    goalTarget: monthlyGoal,
    goalAchievementPercentage,
  };
}

/**
 * Calculates specialized Study Tracker Monthly Statistics
 */
export function calculateStudyMonthlyStats(
  year: number,
  monthIndex: number,
  recordsByDate: Record<string, DailyRecord>,
  excludedWeekdays: number[],
  tracker: Tracker
): StudyMonthlyStats {
  const baseStats = calculateActivityMonthlyStats(
    year,
    monthIndex,
    recordsByDate,
    excludedWeekdays,
    tracker.monthlyGoal
  );

  const todayId = getTodayLocalDateId();
  let totalStudyMinutes = 0;
  let activeStudyDays = 0;
  let targetMetDays = 0;
  let elapsedCalendarDays = 0;
  const subjectBreakdown: Record<string, number> = {};
  const targetMinutesPerDay = (tracker.dailyTargetHours || 0) * 60;

  for (let day = 1; day <= baseStats.totalDaysInMonth; day++) {
    const dateId = formatDateId(year, monthIndex, day);
    if (dateId <= todayId) {
      elapsedCalendarDays++;
    }
    const record = recordsByDate[dateId];
    if (record) {
      const mins = Number(record.studyDurationMinutes) || 0;
      if (mins > 0) {
        totalStudyMinutes += mins;
        activeStudyDays++;
        const subj = record.subject?.trim() || tracker.defaultSubject || 'General';
        subjectBreakdown[subj] = (subjectBreakdown[subj] || 0) + mins;
        if (targetMinutesPerDay > 0 && mins >= targetMinutesPerDay) {
          targetMetDays++;
        }
      }
    }
  }

  const totalStudyHours = Math.round((totalStudyMinutes / 60) * 10) / 10;
  const denominatorCalendarDays =
    elapsedCalendarDays > 0 ? elapsedCalendarDays : baseStats.totalDaysInMonth;
  const avgStudyHoursPerCalendarDay =
    denominatorCalendarDays > 0
      ? Math.round((totalStudyHours / denominatorCalendarDays) * 10) / 10
      : 0;
  const avgStudyHoursPerActiveDay =
    activeStudyDays > 0
      ? Math.round((totalStudyHours / activeStudyDays) * 10) / 10
      : 0;

  // Target achievement percentage: compares completed study hours against monthly study goal (or eligibleDays * dailyTargetHours)
  const monthlyTargetHours =
    tracker.monthlyGoal > 0
      ? tracker.monthlyGoal
      : baseStats.eligibleDays * (tracker.dailyTargetHours || 0);

  const studyTargetAchievementPercentage =
    monthlyTargetHours > 0
      ? Math.min(100, Math.round((totalStudyHours / monthlyTargetHours) * 1000) / 10)
      : baseStats.completionPercentage;

  return {
    ...baseStats,
    totalStudyMinutes,
    totalStudyHours,
    activeStudyDays,
    targetMetDays,
    avgStudyHoursPerCalendarDay,
    avgStudyHoursPerActiveDay,
    studyTargetAchievementPercentage,
    subjectBreakdown,
  };
}

/**
 * Calculates Expense Tracker Monthly Statistics
 */
export function calculateExpenseMonthlyStats(
  year: number,
  monthIndex: number,
  expenses: ExpenseRecord[],
  monthlyBudget: number
): ExpenseMonthlyStats {
  const totalDaysInMonth = getDaysInMonth(year, monthIndex);
  const todayId = getTodayLocalDateId();
  const monthStart = formatDateId(year, monthIndex, 1);
  const monthEnd = formatDateId(year, monthIndex, totalDaysInMonth);

  let daysInMonthElapsed = totalDaysInMonth;
  if (todayId < monthStart) {
    daysInMonthElapsed = 0;
  } else if (todayId <= monthEnd) {
    daysInMonthElapsed = Number(todayId.split('-')[2]) || 1;
  }

  let totalMonthlyExpense = 0;
  const byDate: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byPaymentMethod: Record<string, number> = {};

  for (const exp of expenses) {
    const amt = Number(exp.amount) || 0;
    if (amt <= 0) continue;
    totalMonthlyExpense += amt;
    byDate[exp.date] = (byDate[exp.date] || 0) + amt;
    const cat = exp.category?.trim() || 'Other';
    byCategory[cat] = (byCategory[cat] || 0) + amt;
    const pm = exp.paymentMethod?.trim() || 'Unspecified';
    byPaymentMethod[pm] = (byPaymentMethod[pm] || 0) + amt;
  }

  let highestSpendingDay: { date: string; amount: number } | null = null;
  const activeDates = Object.keys(byDate);
  for (const d of activeDates) {
    if (!highestSpendingDay || byDate[d] > highestSpendingDay.amount) {
      highestSpendingDay = { date: d, amount: byDate[d] };
    }
  }

  const denominatorDays = daysInMonthElapsed > 0 ? daysInMonthElapsed : totalDaysInMonth;
  const averageDailyExpense =
    denominatorDays > 0 ? Math.round(totalMonthlyExpense / denominatorDays) : 0;
  const averageActiveDayExpense =
    activeDates.length > 0
      ? Math.round(totalMonthlyExpense / activeDates.length)
      : 0;

  const remainingBudget =
    monthlyBudget > 0 ? monthlyBudget - totalMonthlyExpense : 0;
  const budgetUsedPercentage =
    monthlyBudget > 0
      ? Math.round((totalMonthlyExpense / monthlyBudget) * 1000) / 10
      : 0;

  return {
    totalMonthlyExpense,
    transactionCount: expenses.length,
    highestSpendingDay,
    averageDailyExpense,
    averageActiveDayExpense,
    daysInMonthElapsed,
    monthlyBudget,
    remainingBudget,
    budgetUsedPercentage,
    byCategory,
    byPaymentMethod,
  };
}

/**
 * Compresses an uploaded image File into a small square Data URL (<= 18KB)
 * so it can be stored safely in the user's Firestore profile document.
 */
export function compressAvatarImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select a valid image file (PNG, JPG, or WebP).'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const targetSize = 112;
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        // Center-crop square
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Generates and triggers a CSV download for the selected tracker and month
 */
export function exportMonthlyRecordsToCsv(params: {
  tracker: Tracker;
  year: number;
  monthIndex: number;
  recordsByDate: Record<string, DailyRecord>;
  expenses: ExpenseRecord[];
}): void {
  const { tracker, year, monthIndex, recordsByDate, expenses } = params;
  const daysInMonth = getDaysInMonth(year, monthIndex);
  const monthLabel = `${MONTH_NAMES[monthIndex]}_${year}`;
  const safeTrackerName = tracker.name.replace(/[^a-zA-Z0-9_\-]/g, '_');

  const escapeCsv = (val: string | number | undefined | null): string => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows: string[][] = [];

  if (tracker.type === 'expense' || tracker.trackingMethod === 'expense_log') {
    rows.push([
      'Date',
      'Day',
      'Expense Title',
      'Category',
      'Payment Method',
      'Amount',
      'Notes',
    ]);
    const sorted = [...expenses].sort((a, b) => a.date.localeCompare(b.date));
    let totalAmount = 0;
    for (const exp of sorted) {
      totalAmount += Number(exp.amount) || 0;
      rows.push([
        exp.date,
        getWeekdayName(exp.date),
        exp.title,
        exp.category,
        exp.paymentMethod || '',
        String(exp.amount),
        exp.notes || '',
      ]);
    }
    rows.push(['TOTAL', '', `${sorted.length} entries`, '', '', String(totalAmount), '']);
  } else if (tracker.type === 'study' || tracker.trackingMethod === 'study_hours') {
    rows.push([
      'Date',
      'Day',
      'Status',
      'Study Subject',
      'Duration (Minutes)',
      'Duration (Hours)',
      'Task Description',
      'Notes',
    ]);
    let totalMins = 0;
    let completedCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateId = formatDateId(year, monthIndex, day);
      const rec = recordsByDate[dateId];
      const status = rec?.status ?? 'not_marked';
      const mins = rec?.studyDurationMinutes ?? 0;
      totalMins += mins;
      if (status === 'completed') completedCount++;
      rows.push([
        dateId,
        getWeekdayName(dateId),
        status.toUpperCase(),
        rec?.subject || '',
        String(mins),
        String(Math.round((mins / 60) * 100) / 100),
        rec?.taskDescription || '',
        rec?.notes || '',
      ]);
    }
    rows.push([
      'SUMMARY',
      '',
      `Completed: ${completedCount} days`,
      '',
      String(totalMins),
      String(Math.round((totalMins / 60) * 100) / 100),
      '',
      '',
    ]);
  } else {
    rows.push(['Date', 'Day', 'Status', 'Task Description', 'Notes']);
    let completedCount = 0;
    let skippedCount = 0;
    let notCompletedCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateId = formatDateId(year, monthIndex, day);
      const rec = recordsByDate[dateId];
      const status = rec?.status ?? 'not_marked';
      if (status === 'completed') completedCount++;
      else if (status === 'skipped') skippedCount++;
      else if (status === 'not_completed') notCompletedCount++;
      rows.push([
        dateId,
        getWeekdayName(dateId),
        status.toUpperCase(),
        rec?.taskDescription || '',
        rec?.notes || '',
      ]);
    }
    rows.push([
      'SUMMARY',
      '',
      `Completed: ${completedCount} | Not Completed: ${notCompletedCount} | Skipped: ${skippedCount}`,
      '',
      '',
    ]);
  }

  const csvContent = rows
    .map((r) => r.map((cell) => escapeCsv(cell)).join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${safeTrackerName}_${monthLabel}_Report.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
