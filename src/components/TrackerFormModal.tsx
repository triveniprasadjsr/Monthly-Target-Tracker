import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CurrencyCode,
  Tracker,
  TrackerType,
  TrackingMethod,
} from '../types/tracker';
import { STUDY_SUBJECT_SUGGESTIONS } from '../utils/dateUtils';
import {
  createTrackerDoc,
  deleteTrackerAndRecords,
  updateTrackerDoc,
} from '../services/firestoreService';

interface TrackerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  editingTracker: Tracker | null;
  currency: CurrencyCode;
  onTrackerCreated: (tracker: Tracker) => void;
  onTrackerUpdated: () => void;
  onTrackerDeleted: (deletedId: string) => void;
}

const TRACKER_TYPE_OPTIONS: {
  value: TrackerType;
  label: string;
  defaultMethod: TrackingMethod;
  hint: string;
}[] = [
  {
    value: 'study',
    label: 'A. Study Tracker',
    defaultMethod: 'study_hours',
    hint: 'Track daily study targets, subjects, hours studied, and completion status.',
  },
  {
    value: 'habit',
    label: 'B. Daily Habit Tracker',
    defaultMethod: 'status',
    hint: 'Track whether a daily habit was performed using ✓, ✗, or –.',
  },
  {
    value: 'goal',
    label: 'C. Personal Goal Tracker',
    defaultMethod: 'status',
    hint: 'Track daily milestones toward a monthly personal goal.',
  },
  {
    value: 'fitness',
    label: 'D. Fitness Tracker',
    defaultMethod: 'status',
    hint: 'Track whether planned workouts or exercises were completed.',
  },
  {
    value: 'expense',
    label: 'E. Expense Tracker',
    defaultMethod: 'expense_log',
    hint: 'Log daily expenses in ₹ (INR), categories, payment methods, and monthly budgets.',
  },
  {
    value: 'custom',
    label: 'F. Custom Tracker',
    defaultMethod: 'status',
    hint: 'Create your own custom category with flexible status or hour tracking.',
  },
];

export const TrackerFormModal: React.FC<TrackerFormModalProps> = ({
  isOpen,
  onClose,
  uid,
  editingTracker,
  currency,
  onTrackerCreated,
  onTrackerUpdated,
  onTrackerDeleted,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<TrackerType>('study');
  const [description, setDescription] = useState('');
  const [trackingMethod, setTrackingMethod] =
    useState<TrackingMethod>('study_hours');
  const [monthlyGoal, setMonthlyGoal] = useState<string>('24');
  const [dailyTargetHours, setDailyTargetHours] = useState<string>('4');
  const [defaultSubject, setDefaultSubject] = useState<string>('Physics');
  const [defaultTask, setDefaultTask] = useState<string>('');
  const [archived, setArchived] = useState<boolean>(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setConfirmDeleteOpen(false);

    if (editingTracker) {
      setName(editingTracker.name);
      setType(editingTracker.type);
      setDescription(editingTracker.description || '');
      setTrackingMethod(editingTracker.trackingMethod);
      setMonthlyGoal(String(editingTracker.monthlyGoal || 0));
      setDailyTargetHours(String(editingTracker.dailyTargetHours || 0));
      setDefaultSubject(editingTracker.defaultSubject || 'Physics');
      setDefaultTask(editingTracker.defaultTask || '');
      setArchived(Boolean(editingTracker.archived));
    } else {
      setName('');
      setType('study');
      setDescription('');
      setTrackingMethod('study_hours');
      setMonthlyGoal('100');
      setDailyTargetHours('4');
      setDefaultSubject('Physics');
      setDefaultTask('Complete 30 Physics MCQs.');
      setArchived(false);
    }
  }, [isOpen, editingTracker]);

  if (!isOpen) return null;

  const handleTypeChange = (nextType: TrackerType) => {
    setType(nextType);
    const meta = TRACKER_TYPE_OPTIONS.find((o) => o.value === nextType);
    if (meta) {
      setTrackingMethod(meta.defaultMethod);
    }
    if (!editingTracker) {
      if (nextType === 'study') {
        setMonthlyGoal('100');
        setDailyTargetHours('4');
      } else if (nextType === 'expense') {
        setMonthlyGoal('15000');
        setDailyTargetHours('0');
      } else {
        setMonthlyGoal('25');
        setDailyTargetHours('0');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMsg('Tracker Name is required.');
      return;
    }

    setSaving(true);
    try {
      if (editingTracker) {
        await updateTrackerDoc(uid, editingTracker.trackerId, {
          name: trimmedName,
          type,
          description,
          trackingMethod,
          monthlyGoal: Number(monthlyGoal) || 0,
          dailyTargetHours:
            type === 'study' || trackingMethod === 'study_hours'
              ? Number(dailyTargetHours) || 0
              : 0,
          defaultSubject:
            type === 'study' || trackingMethod === 'study_hours'
              ? defaultSubject
              : '',
          defaultTask,
          archived,
        });
        onTrackerUpdated();
        onClose();
      } else {
        const created = await createTrackerDoc(uid, {
          name: trimmedName,
          type,
          description,
          trackingMethod,
          monthlyGoal: Number(monthlyGoal) || 0,
          dailyTargetHours:
            type === 'study' || trackingMethod === 'study_hours'
              ? Number(dailyTargetHours) || 0
              : 0,
          defaultSubject:
            type === 'study' || trackingMethod === 'study_hours'
              ? defaultSubject
              : '',
          defaultTask,
        });
        onTrackerCreated(created);
        onClose();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to save tracker.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!editingTracker) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await deleteTrackerAndRecords(uid, editingTracker);
      onTrackerDeleted(editingTracker.trackerId);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to delete tracker.'
      );
    } finally {
      setSaving(false);
    }
  };

  const isStudyMode = type === 'study' || trackingMethod === 'study_hours';
  const isExpenseMode = type === 'expense' || trackingMethod === 'expense_log';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tracker-modal-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2
            id="tracker-modal-title"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            {editingTracker ? `Edit Tracker — ${editingTracker.name}` : 'Create New Tracker'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tracker Name *
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Study Tracker, Morning Fitness, Monthly Expenses"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tracker Type
              </label>
              <select
                value={type}
                onChange={(e) => handleTypeChange(e.target.value as TrackerType)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                {TRACKER_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tracking Method
              </label>
              <select
                value={trackingMethod}
                onChange={(e) =>
                  setTrackingMethod(e.target.value as TrackingMethod)
                }
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="status">Calendar Status (✓ / ✗ / –)</option>
                <option value="study_hours">Study Hours + Calendar Status</option>
                <option value="expense_log">Daily Expense Ledger ({currency})</option>
              </select>
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            {TRACKER_TYPE_OPTIONS.find((o) => o.value === type)?.hint}
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Description (Optional)
            </label>
            <input
              type="text"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief note about what this tracker measures"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </div>

          {/* Goal & Study Specific Configurations */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {isExpenseMode
                    ? `Monthly Expense Budget (${currency})`
                    : isStudyMode
                      ? 'Monthly Study Goal (Hours)'
                      : 'Default Monthly Goal (Days)'}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100000000"
                  step="any"
                  value={monthlyGoal}
                  onChange={(e) => setMonthlyGoal(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              {isStudyMode && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Daily Study Target (Hours)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={dailyTargetHours}
                    onChange={(e) => setDailyTargetHours(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-tabular bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                  />
                </div>
              )}
            </div>

            {isStudyMode && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Default Study Subject
                </label>
                <select
                  value={defaultSubject}
                  onChange={(e) => setDefaultSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                >
                  {STUDY_SUBJECT_SUGGESTIONS.filter(
                    (s) => s !== 'Custom Subject'
                  ).map((subj) => (
                    <option key={subj} value={subj}>
                      {subj}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!isExpenseMode && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Default Daily Task Description (Optional)
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={defaultTask}
                  onChange={(e) => setDefaultTask(e.target.value)}
                  placeholder="e.g., Complete 30 Physics MCQs."
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>
            )}
          </div>

          {editingTracker && (
            <div className="pt-2 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <Archive className="w-3.5 h-3.5 text-slate-500" />
                <span>Archive this tracker (preserves history without deleting)</span>
              </label>

              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="text-xs font-semibold text-rose-600 hover:text-rose-800 flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Permanently</span>
              </button>
            </div>
          )}

          {confirmDeleteOpen && editingTracker && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-3">
              <div className="flex items-start gap-2.5 text-rose-900 dark:text-rose-200 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">
                    Permanently delete "{editingTracker.name}"?
                  </p>
                  <p className="mt-1">
                    Permanent deletion will also remove all daily calendar records
                    and expense entries associated with this tracker from Cloud
                    Firestore. If you want to keep its history, use Archive instead.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handlePermanentDelete}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-1.5"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Confirm Permanent Delete</span>
                </button>
              </div>
            </div>
          )}

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
              <span>{editingTracker ? 'Save Changes' : 'Create Tracker'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
