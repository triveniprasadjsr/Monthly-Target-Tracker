import React, { useEffect, useState } from 'react';
import { deleteUser, signOut, updateProfile } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import {
  AlertCircle,
  AlertTriangle,
  Download,
  Loader2,
  LogOut,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import { auth, db } from '../lib/firebase';
import type {
  CurrencyCode,
  DailyRecord,
  ExpenseRecord,
  ThemePreference,
  Tracker,
  UserProfile,
  UserSettings,
} from '../types/tracker';
import {
  compressAvatarImageFile,
  exportMonthlyRecordsToCsv,
  MONTH_NAMES,
  WEEKDAY_NAMES_SUN,
} from '../utils/dateUtils';
import {
  deleteTrackerAndRecords,
  updateUserProfileDoc,
  updateUserSettingsDoc,
} from '../services/firestoreService';
import firebaseConfig from '../../firebase-applet-config.json';

/* =========================================================
 * 1. EDIT PROFILE MODAL
 * ========================================================= */
interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onProfileUpdated: (next: UserProfile) => void;
  onSuccessToast: (msg: string) => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  profile,
  onProfileUpdated,
  onSuccessToast,
}) => {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [phoneNumber, setPhoneNumber] = useState(profile.phoneNumber);
  const [photoURL, setPhotoURL] = useState(profile.photoURL);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(profile.displayName);
    setPhoneNumber(profile.phoneNumber);
    setPhotoURL(profile.photoURL);
    setErrorMsg(null);
  }, [isOpen, profile]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const compressed = await compressAvatarImageFile(file);
      setPhotoURL(compressed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid image file.');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setErrorMsg('Full Name cannot be empty.');
      return;
    }

    setSaving(true);
    try {
      await updateUserProfileDoc(profile.uid, {
        displayName: trimmedName,
        phoneNumber: phoneNumber.trim(),
        photoURL: photoURL.trim(),
        email: profile.email,
      });
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, {
          displayName: trimmedName,
        }).catch(() => {});
      }
      onProfileUpdated({
        ...profile,
        displayName: trimmedName,
        phoneNumber: phoneNumber.trim(),
        photoURL: photoURL.trim(),
      });
      onSuccessToast('Profile updated in Cloud Firestore');
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to update profile.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-title"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2
            id="edit-profile-title"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            Edit User Profile
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
          <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          {/* Avatar Upload */}
          <div className="flex items-center gap-4">
            {photoURL ? (
              <img
                src={photoURL}
                alt={displayName}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-cover border border-slate-300 dark:border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                <User className="w-6 h-6" />
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {photoURL && (
                  <button
                    type="button"
                    onClick={() => setPhotoURL('')}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Automatically resized and saved to your private Firestore profile.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Full Name *
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              maxLength={30}
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Email Address (Verified Account Identity)
            </label>
            <input
              type="email"
              disabled
              value={profile.email}
              className="w-full px-3 py-2 text-sm bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 cursor-not-allowed"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save Profile</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* =========================================================
 * 2. SETTINGS MODAL
 * ========================================================= */
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  settings: UserSettings;
  trackers: Tracker[];
  onSettingsUpdated: (next: UserSettings) => void;
  onOpenEditProfile: () => void;
  onSuccessToast: (msg: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  uid,
  settings,
  trackers,
  onSettingsUpdated,
  onOpenEditProfile,
  onSuccessToast,
}) => {
  const [theme, setTheme] = useState<ThemePreference>(settings.theme);
  const [currency, setCurrency] = useState<CurrencyCode>(settings.currency);
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(settings.weekStartsOn);
  const [defaultTrackerId, setDefaultTrackerId] = useState<string>(
    settings.defaultTrackerId
  );
  const [timezone, setTimezone] = useState<string>(settings.timezone);
  const [excludedWeekdays, setExcludedWeekdays] = useState<number[]>(
    settings.excludedWeekdays || []
  );

  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTheme(settings.theme);
    setCurrency(settings.currency);
    setWeekStartsOn(settings.weekStartsOn);
    setDefaultTrackerId(settings.defaultTrackerId);
    setTimezone(
      settings.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'Asia/Kolkata'
    );
    setExcludedWeekdays(settings.excludedWeekdays || []);
    setConfirmDeleteAccount(false);
    setErrorMsg(null);
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const toggleExcludedDay = (dayIdx: number) => {
    if (excludedWeekdays.includes(dayIdx)) {
      setExcludedWeekdays(excludedWeekdays.filter((d) => d !== dayIdx));
    } else if (excludedWeekdays.length < 6) {
      setExcludedWeekdays([...excludedWeekdays, dayIdx]);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      await updateUserSettingsDoc(uid, {
        theme,
        currency,
        weekStartsOn,
        defaultTrackerId,
        timezone,
        excludedWeekdays,
      });
      onSettingsUpdated({
        ...settings,
        theme,
        currency,
        weekStartsOn,
        defaultTrackerId,
        timezone,
        excludedWeekdays,
      });
      onSuccessToast('Settings saved to Cloud Firestore');
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to save settings.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      // 1. Delete all trackers and their records
      for (const trk of trackers) {
        await deleteTrackerAndRecords(uid, trk);
      }
      // 2. Delete any remaining expenses
      const expQ = query(
        collection(db, 'users', uid, 'expenses'),
        where('uid', '==', uid)
      );
      const expSnap = await getDocs(expQ);
      for (const d of expSnap.docs) {
        await deleteDoc(d.ref);
      }
      // 3. Delete settings
      await deleteDoc(doc(db, 'users', uid, 'settings', 'preferences'));
      // 4. Delete user profile document
      await deleteDoc(doc(db, 'users', uid));
      // 5. Delete Firebase Auth user (or sign out if re-auth required)
      if (auth.currentUser) {
        try {
          await deleteUser(auth.currentUser);
        } catch {
          await signOut(auth);
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to complete account deletion.'
      );
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2
            id="settings-modal-title"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            Application & Calendar Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSaveSettings} className="mt-4 space-y-5">
          {/* Profile Settings Shortcut */}
          <div className="flex items-center justify-between p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-white">
                Profile Information
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Update your name, phone number, or profile photo
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenEditProfile();
              }}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100"
            >
              Edit Profile
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Appearance */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Appearance Theme
              </label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as ThemePreference)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="light">Light Mode</option>
                <option value="dark">Dark Mode</option>
                <option value="system">System Preference</option>
              </select>
            </div>

            {/* Default Currency */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Default Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="INR">Indian Rupee (₹ INR)</option>
                <option value="USD">US Dollar ($ USD)</option>
                <option value="EUR">Euro (€ EUR)</option>
                <option value="GBP">British Pound (£ GBP)</option>
              </select>
            </div>

            {/* Week Starting Day */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Week Starting Day
              </label>
              <select
                value={weekStartsOn}
                onChange={(e) =>
                  setWeekStartsOn(Number(e.target.value) === 1 ? 1 : 0)
                }
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
              </select>
            </div>

            {/* Default Tracker */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Default Selected Tracker
              </label>
              <select
                value={defaultTrackerId}
                onChange={(e) => setDefaultTrackerId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="">First Active Tracker</option>
                {trackers
                  .filter((t) => !t.archived)
                  .map((t) => (
                    <option key={t.trackerId} value={t.trackerId}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Timezone Preference */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Timezone Preference (Local Date Calculation)
            </label>
            <input
              type="text"
              maxLength={80}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono-tabular bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </div>

          {/* Excluded Days from Eligible Calculation */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Excluded Days (Excluded from Eligible-Day Completion %)
            </label>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
              Select rest days (such as Sunday) that should not be counted against
              your Eligible Days denominator.
            </p>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_NAMES_SUN.map((day) => {
                const isSelected = excludedWeekdays.includes(day.index);
                return (
                  <button
                    key={day.index}
                    type="button"
                    onClick={() => toggleExcludedDay(day.index)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Account Actions */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmDeleteAccount(!confirmDeleteAccount)}
                className="text-xs font-semibold text-rose-600 hover:underline flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Account</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Settings</span>
              </button>
            </div>
          </div>

          {confirmDeleteAccount && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-3">
              <div className="flex items-start gap-2 text-xs text-rose-900 dark:text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">
                    Confirm Permanent Account & Data Deletion
                  </p>
                  <p className="mt-1">
                    This action permanently deletes your profile, all trackers,
                    daily calendar records, expenses, and settings from Cloud
                    Firestore.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAccount(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleDeleteAccount}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                >
                  Permanently Delete My Account
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

/* =========================================================
 * 3. EXPORT MONTHLY REPORT MODAL
 * ========================================================= */
interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  tracker: Tracker;
  year: number;
  monthIndex: number;
  recordsByDate: Record<string, DailyRecord>;
  expenses: ExpenseRecord[];
  onSuccessToast: (msg: string) => void;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  tracker,
  year,
  monthIndex,
  recordsByDate,
  expenses,
  onSuccessToast,
}) => {
  if (!isOpen) return null;

  const isExpense =
    tracker.type === 'expense' || tracker.trackingMethod === 'expense_log';
  const recordCount = isExpense
    ? expenses.length
    : Object.keys(recordsByDate).length;

  const handleExport = () => {
    exportMonthlyRecordsToCsv({
      tracker,
      year,
      monthIndex,
      recordsByDate,
      expenses,
    });
    onSuccessToast(
      `Exported ${MONTH_NAMES[monthIndex]} ${year} CSV for ${tracker.name}`
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2
            id="export-modal-title"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            Export Monthly Report (CSV)
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs text-slate-600 dark:text-slate-300">
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Selected Tracker:</span>
              <span className="font-bold text-slate-900 dark:text-white">
                {tracker.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Report Period:</span>
              <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                {MONTH_NAMES[monthIndex]} {year}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Format:</span>
              <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                CSV (Spreadsheet Compatible)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Saved Entries in Period:</span>
              <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                {recordCount}
              </span>
            </div>
          </div>

          <p className="leading-relaxed">
            {isExpense
              ? 'Includes Date, Day, Expense Title, Category, Payment Method, Amount, Notes, and Monthly Total.'
              : tracker.type === 'study'
                ? 'Includes all dates in the month with Day, Status, Study Subject, Duration (Minutes & Hours), Task Description, Notes, and Summary.'
                : 'Includes all dates in the month with Day, Status, Task Description, Notes, and Monthly Summary.'}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 rounded-lg flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download CSV</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================================================
 * 4. FIREBASE SETUP & SECURITY GUIDE MODAL
 * ========================================================= */
interface FirebaseSetupGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FirebaseSetupGuideModal: React.FC<FirebaseSetupGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="firebase-guide-title"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h2
              id="firebase-guide-title"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              Firebase Configuration & Zero-Trust Security Architecture
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <p className="font-bold text-slate-900 dark:text-white mb-1">
              Connected Firebase Project Configuration
            </p>
            <p className="font-mono-tabular text-[11px] text-slate-600 dark:text-slate-400">
              Project ID: {firebaseConfig.projectId || 'Not configured'} · Database ID:{' '}
              {firebaseConfig.firestoreDatabaseId || '(default)'}
            </p>
          </div>

          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            10-Step Firebase Setup & Hardening Checklist
          </h3>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              <strong>Create or Select a Firebase Project:</strong> Provisioned via
              Google Cloud / Firebase Console (
              <span className="font-mono-tabular">{firebaseConfig.projectId}</span>).
            </li>
            <li>
              <strong>Register the Web Application:</strong> Registered with client
              configuration stored in{' '}
              <span className="font-mono-tabular">firebase-applet-config.json</span>.
            </li>
            <li>
              <strong>Enable Email/Password Authentication:</strong> In Firebase
              Console → Authentication → Sign-in method, enable{' '}
              <strong>Email/Password</strong> so users can register and sign in with
              email and password.
            </li>
            <li>
              <strong>Enable Google Authentication:</strong> Enabled automatically for
              one-click Google Sign-In via <span className="font-mono-tabular">signInWithPopup</span>.
            </li>
            <li>
              <strong>Cloud Firestore Database:</strong> Provisioned in native mode
              with deterministic document paths:{' '}
              <span className="font-mono-tabular">
                users/&#123;uid&#125;/trackers/&#123;trackerId&#125;/dailyRecords/&#123;YYYY-MM-DD&#125;
              </span>{' '}
              and <span className="font-mono-tabular">users/&#123;uid&#125;/expenses/&#123;expenseId&#125;</span>.
            </li>
            <li>
              <strong>Profile Photos:</strong> Profile avatars are automatically
              cropped and compressed client-side and stored inside the owner-isolated{' '}
              <span className="font-mono-tabular">users/&#123;uid&#125;</span> document.
            </li>
            <li>
              <strong>Web Config vs. Server Secrets:</strong> Firebase web configuration
              values (<span className="font-mono-tabular">apiKey</span>,{' '}
              <span className="font-mono-tabular">projectId</span>) identify the Firebase
              project to the client SDK and are not server-side secrets. Never expose
              Firebase Admin SDK service-account private keys in frontend code.
            </li>
            <li>
              <strong>Firestore Security Rules (<span className="font-mono-tabular">firestore.rules</span>):</strong>{' '}
              Enforces strict owner isolation (<span className="font-mono-tabular">request.auth.uid == uid</span>),
              schema blueprints, field size bounds, immutable fields, and server timestamps
              (<span className="font-mono-tabular">request.time</span>).
            </li>
            <li>
              <strong>Authorized Domains:</strong> Ensure your deployment domain is
              listed under Firebase Console → Authentication → Settings → Authorized
              domains.
            </li>
            <li>
              <strong>Review & Test Before Production Sharing:</strong> Always review
              and test <span className="font-mono-tabular">firestore.rules</span> in the
              Firebase Rules Playground before sharing the application broadly.
            </li>
          </ol>
        </div>

        <div className="flex justify-end mt-6 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 rounded-lg"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
