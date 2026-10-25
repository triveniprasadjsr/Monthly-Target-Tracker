import React, { useState } from 'react';
import {
  BookOpen,
  Check,
  Filter,
  Minus,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import type {
  ActivityMonthlyStats,
  CurrencyCode,
  DailyRecord,
  ExpenseMonthlyStats,
  ExpenseRecord,
  StudyMonthlyStats,
  Tracker,
} from '../types/tracker';
import {
  EXPENSE_CATEGORIES,
  formatCurrency,
  formatDurationMinutes,
  MONTH_NAMES,
  WEEKDAY_NAMES_SUN,
} from '../utils/dateUtils';

interface MonthlySummaryPanelProps {
  tracker: Tracker;
  year: number;
  monthIndex: number;
  activityStats: ActivityMonthlyStats;
  studyStats: StudyMonthlyStats;
  expenseStats: ExpenseMonthlyStats;
  expenses: ExpenseRecord[];
  recordsByDate: Record<string, DailyRecord>;
  excludedWeekdays: number[];
  currency: CurrencyCode;
  selectedExpenseCategory: string;
  onSelectExpenseCategory: (category: string) => void;
  onSelectDateFromList: (dateId: string) => void;
}

export const MonthlySummaryPanel: React.FC<MonthlySummaryPanelProps> = ({
  tracker,
  year,
  monthIndex,
  activityStats,
  studyStats,
  expenseStats,
  expenses,
  excludedWeekdays,
  currency,
  selectedExpenseCategory,
  onSelectExpenseCategory,
  onSelectDateFromList,
}) => {
  const isExpenseTracker =
    tracker.type === 'expense' || tracker.trackingMethod === 'expense_log';
  const isStudyTracker =
    tracker.type === 'study' || tracker.trackingMethod === 'study_hours';

  const [showExpenseLedger, setShowExpenseLedger] = useState(true);

  const excludedDayNames = excludedWeekdays
    .map((idx) => WEEKDAY_NAMES_SUN.find((w) => w.index === idx)?.short)
    .filter(Boolean)
    .join(', ');

  if (isExpenseTracker) {
    const categories = Object.entries(expenseStats.byCategory).sort(
      (a, b) => b[1] - a[1]
    );
    const filteredExpenses =
      selectedExpenseCategory === 'ALL'
        ? expenses
        : expenses.filter((e) => e.category === selectedExpenseCategory);

    return (
      <section
        aria-label="Monthly Expense Summary"
        className="space-y-6 mt-6"
      >
        {/* Top Financial Metrics Strip */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Wallet className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                <span>
                  {MONTH_NAMES[monthIndex]} {year} — Financial Summary
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Calculated from {expenseStats.transactionCount} recorded expense
                {expenseStats.transactionCount === 1 ? '' : 's'} in Cloud Firestore
              </p>
            </div>
            {expenseStats.monthlyBudget > 0 && (
              <div className="text-left sm:text-right">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Monthly Budget:{' '}
                </span>
                <span className="font-mono-tabular text-xs font-bold text-slate-900 dark:text-white">
                  {formatCurrency(expenseStats.monthlyBudget, currency)}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Total Monthly Expense
              </p>
              <p className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-white mt-1">
                {formatCurrency(expenseStats.totalMonthlyExpense, currency)}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Average Daily Expense
              </p>
              <p className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-white mt-1">
                {formatCurrency(expenseStats.averageDailyExpense, currency)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Across {expenseStats.daysInMonthElapsed} elapsed day
                {expenseStats.daysInMonthElapsed === 1 ? '' : 's'}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Highest Spending Day
              </p>
              <p className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-white mt-1">
                {expenseStats.highestSpendingDay
                  ? formatCurrency(
                      expenseStats.highestSpendingDay.amount,
                      currency
                    )
                  : formatCurrency(0, currency)}
              </p>
              <p className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {expenseStats.highestSpendingDay
                  ? expenseStats.highestSpendingDay.date
                  : 'No expenses yet'}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {expenseStats.monthlyBudget > 0
                  ? 'Remaining Budget'
                  : 'Avg Per Spending Day'}
              </p>
              <p
                className={`font-mono-tabular text-xl font-bold mt-1 ${
                  expenseStats.monthlyBudget > 0 &&
                  expenseStats.remainingBudget < 0
                    ? 'text-rose-600'
                    : 'text-slate-900 dark:text-white'
                }`}
              >
                {expenseStats.monthlyBudget > 0
                  ? formatCurrency(expenseStats.remainingBudget, currency)
                  : formatCurrency(
                      expenseStats.averageActiveDayExpense,
                      currency
                    )}
              </p>
              <p className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {expenseStats.monthlyBudget > 0
                  ? `${expenseStats.budgetUsedPercentage}% of budget used`
                  : 'On days with recorded spend'}
              </p>
            </div>
          </div>

          {/* Budget Progress Bar */}
          {expenseStats.monthlyBudget > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Budget Utilization
                </span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                  {formatCurrency(expenseStats.totalMonthlyExpense, currency)} /{' '}
                  {formatCurrency(expenseStats.monthlyBudget, currency)} (
                  {expenseStats.budgetUsedPercentage}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    expenseStats.budgetUsedPercentage > 100
                      ? 'bg-rose-600'
                      : expenseStats.budgetUsedPercentage > 80
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                  }`}
                  style={{
                    width: `${Math.min(100, expenseStats.budgetUsedPercentage)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Category Breakdown & Filterable Ledger */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Category Breakdown */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-4">
              Expense by Category
            </h3>
            {categories.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                No expenses recorded for {MONTH_NAMES[monthIndex]} {year}. Tap any
                calendar date above to add an expense.
              </p>
            ) : (
              <div className="space-y-3">
                {categories.map(([cat, amt]) => {
                  const pct =
                    expenseStats.totalMonthlyExpense > 0
                      ? Math.round(
                          (amt / expenseStats.totalMonthlyExpense) * 1000
                        ) / 10
                      : 0;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <button
                          type="button"
                          onClick={() =>
                            onSelectExpenseCategory(
                              selectedExpenseCategory === cat ? 'ALL' : cat
                            )
                          }
                          className="font-medium text-slate-800 dark:text-slate-200 hover:underline text-left"
                        >
                          {cat}
                        </button>
                        <span className="font-mono-tabular text-slate-700 dark:text-slate-300">
                          {formatCurrency(amt, currency)} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-slate-800 dark:bg-slate-300 rounded-full"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Filterable Monthly Expense Ledger */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  Monthly Expense Entries ({filteredExpenses.length})
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="Filter expenses by category"
                  value={selectedExpenseCategory}
                  onChange={(e) => onSelectExpenseCategory(e.target.value)}
                  className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                >
                  <option value="ALL">All Categories</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowExpenseLedger(!showExpenseLedger)}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white underline"
                >
                  {showExpenseLedger ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {showExpenseLedger && (
              <>
                {filteredExpenses.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                    No expense entries match the current filter.
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                    {[...filteredExpenses]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((exp) => (
                        <button
                          key={exp.expenseId}
                          type="button"
                          onClick={() => onSelectDateFromList(exp.date)}
                          className="w-full p-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center justify-between gap-3 text-xs transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white truncate">
                              {exp.title}
                            </p>
                            <p className="text-slate-500 dark:text-slate-400 truncate">
                              <span className="font-mono-tabular">{exp.date}</span> ·{' '}
                              {exp.category}
                              {exp.paymentMethod ? ` · ${exp.paymentMethod}` : ''}
                            </p>
                          </div>
                          <span className="font-mono-tabular font-bold text-slate-900 dark:text-white shrink-0">
                            {formatCurrency(exp.amount, currency)}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  /* ACTIVITY & STUDY TRACKER SUMMARY */
  const totalDays = activityStats.totalDaysInMonth || 1;
  const completedPctOfMonth = Math.round(
    (activityStats.completedDays / totalDays) * 100
  );
  const notCompletedPctOfMonth = Math.round(
    (activityStats.notCompletedDays / totalDays) * 100
  );
  const skippedPctOfMonth = Math.round(
    (activityStats.skippedDays / totalDays) * 100
  );

  return (
    <section
      aria-label="Monthly Progress Summary"
      className="space-y-6 mt-6"
    >
      {/* Main Activity Analytics Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              <span>
                {MONTH_NAMES[monthIndex]} {year} — Monthly Summary & Analytics
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Formula: Completion % = Completed Days ({activityStats.completedDays}) ÷
              Eligible Days ({activityStats.eligibleDays}) × 100
              {excludedDayNames ? ` · Excluded: ${excludedDayNames}` : ''}
              {activityStats.futureDaysCount > 0
                ? ` · ${activityStats.futureDaysCount} future day(s) not counted as failures`
                : ''}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <span className="font-mono-tabular text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {activityStats.eligibleDays > 0
                ? `${activityStats.completionPercentage}%`
                : '0% (No eligible days yet)'}
            </span>
          </div>
        </div>

        {/* 6-Column Tabular Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Total Days in Month
            </p>
            <p className="font-mono-tabular text-lg font-bold text-slate-900 dark:text-white mt-0.5">
              {activityStats.totalDaysInMonth}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Eligible Days (To Date)
            </p>
            <p className="font-mono-tabular text-lg font-bold text-slate-900 dark:text-white mt-0.5">
              {activityStats.eligibleDays}
            </p>
          </div>

          <div>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              <span>✓ Completed Days</span>
            </p>
            <p className="font-mono-tabular text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
              {activityStats.completedDays}
            </p>
          </div>

          <div>
            <p className="text-xs text-rose-700 dark:text-rose-400 flex items-center gap-1">
              <X className="w-3.5 h-3.5" />
              <span>✗ Not Completed</span>
            </p>
            <p className="font-mono-tabular text-lg font-bold text-rose-700 dark:text-rose-400 mt-0.5">
              {activityStats.notCompletedDays}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
              <Minus className="w-3.5 h-3.5" />
              <span>– Skipped Days</span>
            </p>
            <p className="font-mono-tabular text-lg font-bold text-slate-700 dark:text-slate-300 mt-0.5">
              {activityStats.skippedDays}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Unmarked Days
            </p>
            <p className="font-mono-tabular text-lg font-bold text-slate-600 dark:text-slate-400 mt-0.5">
              {activityStats.unmarkedDays}
            </p>
          </div>
        </div>

        {/* Visual Progress & Status Distribution Bar */}
        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Eligible-Day Completion Rate
              </span>
              <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                {activityStats.completedDays} / {activityStats.eligibleDays} eligible
                days ({activityStats.completionPercentage}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{
                  width: `${Math.min(100, activityStats.completionPercentage)}%`,
                }}
              />
            </div>
          </div>

          {/* Monthly Status Distribution Multi-Segment Bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Full Month Status Distribution ({activityStats.totalDaysInMonth} days)
              </span>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                <span>✓ {completedPctOfMonth}%</span>
                <span>✗ {notCompletedPctOfMonth}%</span>
                <span>– {skippedPctOfMonth}%</span>
              </div>
            </div>
            <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-emerald-600"
                style={{ width: `${completedPctOfMonth}%` }}
                title={`Completed: ${activityStats.completedDays} days`}
              />
              <div
                className="h-full bg-rose-500"
                style={{ width: `${notCompletedPctOfMonth}%` }}
                title={`Not Completed: ${activityStats.notCompletedDays} days`}
              />
              <div
                className="h-full bg-slate-400"
                style={{ width: `${skippedPctOfMonth}%` }}
                title={`Skipped: ${activityStats.skippedDays} days`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Specialized Study Tracker Statistics */}
      {isStudyTracker && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                <span>Study Hours & Target Analytics</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Daily Target: {tracker.dailyTargetHours || 0}h · Monthly Goal:{' '}
                {tracker.monthlyGoal || 0}h · Default Subject:{' '}
                {tracker.defaultSubject || 'General'}
              </p>
            </div>
            <span className="font-mono-tabular text-sm font-bold text-slate-900 dark:text-white">
              Target Achievement: {studyStats.studyTargetAchievementPercentage}%
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 pt-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Total Study Hours
              </p>
              <p className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-white mt-1">
                {studyStats.totalStudyHours}h
              </p>
              <p className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                ({formatDurationMinutes(studyStats.totalStudyMinutes)})
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Avg Hours / Calendar Day
              </p>
              <p className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-white mt-1">
                {studyStats.avgStudyHoursPerCalendarDay}h
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Elapsed calendar days
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Days With Study Logged
              </p>
              <p className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-white mt-1">
                {studyStats.activeStudyDays}
              </p>
              <p className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                Avg {studyStats.avgStudyHoursPerActiveDay}h / active day
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Daily Target Met Days
              </p>
              <p className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-white mt-1">
                {studyStats.targetMetDays}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Days ≥ {tracker.dailyTargetHours || 0}h studied
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Marked ✓ Completed
              </p>
              <p className="font-mono-tabular text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                {studyStats.completedDays}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                User-verified completion
              </p>
            </div>
          </div>

          {Object.keys(studyStats.subjectBreakdown).length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Study Time by Subject
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                {Object.entries(studyStats.subjectBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([subj, mins], i, arr) => (
                    <React.Fragment key={subj}>
                      <span>
                        <strong className="text-slate-900 dark:text-white">
                          {subj}:
                        </strong>{' '}
                        <span className="font-mono-tabular">
                          {formatDurationMinutes(mins)}
                        </span>
                      </span>
                      {i < arr.length - 1 && (
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                      )}
                    </React.Fragment>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
