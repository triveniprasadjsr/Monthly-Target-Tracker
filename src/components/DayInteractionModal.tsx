import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Edit2,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CurrencyCode,
  DailyRecord,
  DailyStatus,
  ExpenseRecord,
  Tracker,
} from '../types/tracker';
import {
  EXPENSE_CATEGORIES,
  formatCurrency,
  formatDurationMinutes,
  formatReadableDate,
  getTodayLocalDateId,
  PAYMENT_METHODS,
  STUDY_SUBJECT_SUGGESTIONS,
} from '../utils/dateUtils';
import {
  createExpenseRecordDoc,
  deleteExpenseRecordDoc,
  updateExpenseRecordDoc,
  upsertDailyRecordDoc,
} from '../services/firestoreService';

interface DayInteractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  tracker: Tracker;
  dateId: string;
  existingRecord?: DailyRecord;
  dateExpenses: ExpenseRecord[];
  currency: CurrencyCode;
  onSuccessToast: (msg: string) => void;
}

export const DayInteractionModal: React.FC<DayInteractionModalProps> = ({
  isOpen,
  onClose,
  uid,
  tracker,
  dateId,
  existingRecord,
  dateExpenses,
  currency,
  onSuccessToast,
}) => {
  const isExpenseTracker =
    tracker.type === 'expense' || tracker.trackingMethod === 'expense_log';
  const isStudyTracker =
    tracker.type === 'study' || tracker.trackingMethod === 'study_hours';
  const isFutureDate = dateId > getTodayLocalDateId();

  // Status & Study state
  const [status, setStatus] = useState<DailyStatus>(
    existingRecord?.status ?? 'not_marked'
  );
  const [subject, setSubject] = useState<string>(
    existingRecord?.subject || tracker.defaultSubject || 'Physics'
  );
  const [customSubject, setCustomSubject] = useState<string>('');
  const [studyHours, setStudyHours] = useState<string>('0');
  const [studyMinutes, setStudyMinutes] = useState<string>('0');
  const [taskDescription, setTaskDescription] = useState<string>(
    existingRecord?.taskDescription || tracker.defaultTask || ''
  );
  const [notes, setNotes] = useState<string>(existingRecord?.notes || '');

  // Expense form state
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseTitle, setExpenseTitle] = useState<string>('');
  const [expenseAmount, setExpenseAmount] = useState<string>('');
  const [expenseCategory, setExpenseCategory] = useState<string>('Education');
  const [expensePaymentMethod, setExpensePaymentMethod] = useState<string>('UPI');
  const [expenseNotes, setExpenseNotes] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setStatus(existingRecord?.status ?? 'not_marked');

    const initialSubj =
      existingRecord?.subject || tracker.defaultSubject || 'Physics';
    if (
      STUDY_SUBJECT_SUGGESTIONS.includes(initialSubj) &&
      initialSubj !== 'Custom Subject'
    ) {
      setSubject(initialSubj);
      setCustomSubject('');
    } else if (initialSubj) {
      setSubject('Custom Subject');
      setCustomSubject(initialSubj);
    } else {
      setSubject('Physics');
      setCustomSubject('');
    }

    const totalMins = existingRecord?.studyDurationMinutes ?? 0;
    setStudyHours(String(Math.floor(totalMins / 60)));
    setStudyMinutes(String(totalMins % 60));
    setTaskDescription(
      existingRecord?.taskDescription ?? tracker.defaultTask ?? ''
    );
    setNotes(existingRecord?.notes ?? '');

    // Reset expense form
    setEditingExpenseId(null);
    setExpenseTitle('');
    setExpenseAmount('');
    setExpenseCategory('Education');
    setExpensePaymentMethod('UPI');
    setExpenseNotes('');
  }, [isOpen, existingRecord, tracker, dateId]);

  if (!isOpen) return null;

  /**
   * Quick status tap handler for instant calendar updates
   */
  const handleQuickStatusSelect = async (nextStatus: DailyStatus) => {
    setStatus(nextStatus);
    if (!isStudyTracker) {
      // Immediately persist status for standard activity trackers
      setSaving(true);
      setErrorMsg(null);
      try {
        await upsertDailyRecordDoc({
          uid,
          trackerId: tracker.trackerId,
          dateId,
          status: nextStatus,
          subject: '',
          taskDescription,
          studyDurationMinutes: 0,
          notes,
          existingRecord,
        });
        onSuccessToast(
          nextStatus === 'not_marked'
            ? `Cleared status for ${dateId}`
            : `Saved ${nextStatus.replace('_', ' ')} for ${dateId}`
        );
        onClose();
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Failed to save status to Cloud Firestore.'
        );
      } finally {
        setSaving(false);
      }
    }
  };

  /**
   * Full form save for Study Tracker or Activity Tracker with task/notes
   */
  const handleSaveDailyDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);

    const hrs = Math.max(0, Math.min(24, Number(studyHours) || 0));
    const mins = Math.max(0, Math.min(59, Number(studyMinutes) || 0));
    const totalDurationMinutes = Math.min(1440, Math.round(hrs * 60 + mins));
    const finalSubject =
      subject === 'Custom Subject'
        ? customSubject.trim() || 'Custom'
        : subject;

    try {
      await upsertDailyRecordDoc({
        uid,
        trackerId: tracker.trackerId,
        dateId,
        status,
        subject: isStudyTracker ? finalSubject : '',
        taskDescription,
        studyDurationMinutes: isStudyTracker ? totalDurationMinutes : 0,
        notes,
        existingRecord,
      });
      onSuccessToast(`Saved record for ${dateId}`);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to save daily record to Cloud Firestore.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const trimmedTitle = expenseTitle.trim();
    const numericAmount = Number(expenseAmount);

    if (!trimmedTitle) {
      setErrorMsg('Please enter an expense title (e.g., Stationery).');
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorMsg('Please enter a valid positive amount.');
      return;
    }

    setSaving(true);
    try {
      if (editingExpenseId) {
        await updateExpenseRecordDoc({
          uid,
          expenseId: editingExpenseId,
          dateId,
          title: trimmedTitle,
          amount: numericAmount,
          category: expenseCategory,
          paymentMethod: expensePaymentMethod,
          notes: expenseNotes,
        });
        onSuccessToast(`Updated expense "${trimmedTitle}"`);
      } else {
        await createExpenseRecordDoc({
          uid,
          trackerId: tracker.trackerId,
          dateId,
          title: trimmedTitle,
          amount: numericAmount,
          category: expenseCategory,
          paymentMethod: expensePaymentMethod,
          notes: expenseNotes,
        });
        onSuccessToast(`Added ${formatCurrency(numericAmount, currency)} for ${trimmedTitle}`);
      }
      setEditingExpenseId(null);
      setExpenseTitle('');
      setExpenseAmount('');
      setExpenseNotes('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to save expense entry.'
      );
    } finally {
      setSaving(false);
    }
  };

  const startEditExpense = (exp: ExpenseRecord) => {
    setEditingExpenseId(exp.expenseId);
    setExpenseTitle(exp.title);
    setExpenseAmount(String(exp.amount));
    setExpenseCategory(exp.category);
    setExpensePaymentMethod(exp.paymentMethod || 'UPI');
    setExpenseNotes(exp.notes || '');
  };

  const handleDeleteExpense = async (exp: ExpenseRecord) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await deleteExpenseRecordDoc(uid, exp.expenseId);
      if (editingExpenseId === exp.expenseId) {
        setEditingExpenseId(null);
        setExpenseTitle('');
        setExpenseAmount('');
        setExpenseNotes('');
      }
      onSuccessToast(`Deleted expense "${exp.title}"`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to delete expense.'
      );
    } finally {
      setSaving(false);
    }
  };

  const dailyExpenseTotal = dateExpenses.reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-modal-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-xl max-h-[90vh] overflow-y-auto p-5 sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {tracker.name} · <span className="font-mono-tabular">{dateId}</span>
            </p>
            <h2
              id="day-modal-title"
              className="text-base font-bold text-slate-900 dark:text-white mt-0.5"
            >
              {formatReadableDate(dateId)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isFutureDate && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs">
            Note: This is a future date ({dateId}). Future dates are excluded from
            eligible failure calculations until the date arrives.
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="break-all">{errorMsg}</span>
          </div>
        )}

        {isExpenseTracker ? (
          /* EXPENSE TRACKER VIEW */
          <div className="mt-4 space-y-5">
            {/* Daily Expenses List */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Recorded Expenses ({dateExpenses.length})
                </h3>
                <span className="font-mono-tabular text-sm font-bold text-slate-900 dark:text-white">
                  Daily Total: {formatCurrency(dailyExpenseTotal, currency)}
                </span>
              </div>

              {dateExpenses.length === 0 ? (
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                  No expenses recorded for {dateId} yet. Add an entry below.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  {dateExpenses.map((exp) => (
                    <div
                      key={exp.expenseId}
                      className="p-3 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 dark:text-white truncate">
                          {exp.title}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {exp.category}
                          {exp.paymentMethod ? ` · ${exp.paymentMethod}` : ''}
                          {exp.notes ? ` · ${exp.notes}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono-tabular font-bold text-slate-900 dark:text-white">
                          {formatCurrency(exp.amount, currency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEditExpense(exp)}
                          aria-label={`Edit ${exp.title}`}
                          className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(exp)}
                          aria-label={`Delete ${exp.title}`}
                          className="p-1.5 text-rose-600 hover:text-rose-800 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add / Edit Expense Form */}
            <form
              onSubmit={handleExpenseSubmit}
              className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3.5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  {editingExpenseId ? 'Edit Expense Entry' : 'Add New Expense'}
                </h3>
                {editingExpenseId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingExpenseId(null);
                      setExpenseTitle('');
                      setExpenseAmount('');
                      setExpenseNotes('');
                    }}
                    className="text-xs text-slate-500 hover:text-slate-900 underline"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Expense Title *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={150}
                    value={expenseTitle}
                    onChange={(e) => setExpenseTitle(e.target.value)}
                    placeholder="e.g., Stationery, Textbooks, Lunch"
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Amount ({currency}) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    max="100000000"
                    step="any"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="150"
                    className="w-full px-3 py-2 text-sm font-mono-tabular bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={expensePaymentMethod}
                    onChange={(e) => setExpensePaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={expenseNotes}
                  onChange={(e) => setExpenseNotes(e.target.value)}
                  placeholder="Optional details or receipt reference"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg"
                >
                  Done
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>{editingExpenseId ? 'Update Expense' : 'Add Expense'}</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* ACTIVITY & STUDY TRACKER VIEW */
          <form onSubmit={handleSaveDailyDetails} className="mt-4 space-y-5">
            {/* Status Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Select Status for {dateId}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleQuickStatusSelect('completed')}
                  className={`py-2.5 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    status === 'completed'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  <Check className="w-4 h-4 shrink-0" />
                  <span className="whitespace-nowrap">✓ Completed</span>
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleQuickStatusSelect('not_completed')}
                  className={`py-2.5 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    status === 'not_completed'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-rose-50/70 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 border-rose-200 dark:border-rose-800 hover:bg-rose-100'
                  }`}
                >
                  <X className="w-4 h-4 shrink-0" />
                  <span className="whitespace-nowrap">✗ Not Completed</span>
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleQuickStatusSelect('skipped')}
                  className={`py-2.5 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    status === 'skipped'
                      ? 'bg-slate-700 text-white border-slate-700'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Minus className="w-4 h-4 shrink-0" />
                  <span className="whitespace-nowrap">– Skipped</span>
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleQuickStatusSelect('not_marked')}
                  className={`py-2.5 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    status === 'not_marked'
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">Clear Status</span>
                </button>
              </div>
              {isStudyTracker && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                  Calendar status is controlled independently of your recorded study hours.
                </p>
              )}
            </div>

            {/* Study Tracker Specialized Fields */}
            {isStudyTracker && (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Study Session Log
                  </span>
                  {tracker.dailyTargetHours > 0 && (
                    <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                      Daily Target: {tracker.dailyTargetHours}h (
                      {formatDurationMinutes(
                        (Number(studyHours) || 0) * 60 + (Number(studyMinutes) || 0)
                      )}{' '}
                      logged)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Study Subject
                    </label>
                    <select
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    >
                      {STUDY_SUBJECT_SUGGESTIONS.map((subj) => (
                        <option key={subj} value={subj}>
                          {subj}
                        </option>
                      ))}
                    </select>
                  </div>

                  {subject === 'Custom Subject' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Custom Subject Name
                      </label>
                      <input
                        type="text"
                        maxLength={100}
                        value={customSubject}
                        onChange={(e) => setCustomSubject(e.target.value)}
                        placeholder="e.g., Thermodynamics"
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Hours Studied
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        value={studyHours}
                        onChange={(e) => setStudyHours(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono-tabular bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Minutes (0–59)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={studyMinutes}
                        onChange={(e) => setStudyMinutes(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono-tabular bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Task Description & Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Daily Task Description (Optional)
              </label>
              <input
                type="text"
                maxLength={500}
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder={
                  isStudyTracker
                    ? 'e.g., Complete 30 Physics MCQs.'
                    : 'e.g., 45 minutes morning run and mobility routine'
                }
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Notes (Optional)
              </label>
              <textarea
                rows={2}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reflections, obstacles, or key takeaways for this day..."
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Daily Record</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
