export type TrackerType = 'study' | 'habit' | 'goal' | 'fitness' | 'expense' | 'custom';

export type TrackingMethod = 'status' | 'study_hours' | 'expense_log';

export type DailyStatus = 'completed' | 'not_completed' | 'skipped' | 'not_marked';

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  phoneNumber: string;
  photoURL: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Tracker {
  trackerId: string;
  uid: string;
  name: string;
  type: TrackerType;
  description: string;
  trackingMethod: TrackingMethod;
  monthlyGoal: number;
  dailyTargetHours: number;
  defaultSubject: string;
  defaultTask: string;
  archived: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DailyRecord {
  date: string; // YYYY-MM-DD
  uid: string;
  trackerId: string;
  status: DailyStatus;
  subject: string;
  taskDescription: string;
  studyDurationMinutes: number;
  notes: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ExpenseRecord {
  expenseId: string;
  uid: string;
  trackerId: string;
  date: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
  title: string;
  amount: number;
  category: string;
  paymentMethod: string;
  notes: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserSettings {
  settingId: string;
  uid: string;
  theme: ThemePreference;
  currency: CurrencyCode;
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
  defaultTrackerId: string;
  timezone: string;
  excludedWeekdays: number[]; // e.g., [0] for Sunday
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ActivityMonthlyStats {
  totalDaysInMonth: number;
  eligibleDays: number;
  excludedDaysCount: number;
  futureDaysCount: number;
  completedDays: number;
  notCompletedDays: number;
  skippedDays: number;
  unmarkedDays: number;
  completionPercentage: number;
  goalTarget: number;
  goalAchievementPercentage: number;
}

export interface StudyMonthlyStats extends ActivityMonthlyStats {
  totalStudyMinutes: number;
  totalStudyHours: number;
  activeStudyDays: number;
  targetMetDays: number;
  avgStudyHoursPerCalendarDay: number;
  avgStudyHoursPerActiveDay: number;
  studyTargetAchievementPercentage: number;
  subjectBreakdown: Record<string, number>; // subject -> minutes
}

export interface ExpenseMonthlyStats {
  totalMonthlyExpense: number;
  transactionCount: number;
  highestSpendingDay: { date: string; amount: number } | null;
  averageDailyExpense: number;
  averageActiveDayExpense: number;
  daysInMonthElapsed: number;
  monthlyBudget: number;
  remainingBudget: number;
  budgetUsedPercentage: number;
  byCategory: Record<string, number>;
  byPaymentMethod: Record<string, number>;
}
