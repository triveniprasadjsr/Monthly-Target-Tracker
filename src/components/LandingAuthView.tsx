import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  HelpCircle,
  Loader2,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Upload,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { ensureUserProfileDoc } from '../services/firestoreService';
import { compressAvatarImageFile } from '../utils/dateUtils';
import firebaseConfig from '../../firebase-applet-config.json';

type AuthMode = 'landing' | 'signin' | 'signup' | 'reset';

interface LandingAuthViewProps {
  onOpenSetupGuide: () => void;
}

function mapFirebaseAuthError(err: unknown): {
  message: string;
  showConsoleHint?: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password') || raw.includes('auth/user-not-found')) {
    return {
      message: 'Invalid email address or password. Please verify your credentials and try again.',
    };
  }
  if (raw.includes('auth/email-already-in-use')) {
    return {
      message: 'An account with this email address already exists. Please sign in instead.',
    };
  }
  if (raw.includes('auth/invalid-email')) {
    return {
      message: 'Please enter a valid email address.',
    };
  }
  if (raw.includes('auth/weak-password')) {
    return {
      message: 'Password is too weak. Please use at least 6 characters.',
    };
  }
  if (raw.includes('auth/operation-not-allowed')) {
    return {
      message:
        'Email/Password authentication is not yet enabled in your Firebase project console. You can sign in immediately with Google below, or enable Email/Password in the Firebase Console.',
      showConsoleHint: true,
    };
  }
  if (raw.includes('auth/popup-closed-by-user')) {
    return {
      message: 'Sign-in popup was closed before completing authentication.',
    };
  }
  if (raw.includes('auth/network-request-failed')) {
    return {
      message: 'Network error detected. Please check your internet connection and try again.',
    };
  }
  if (raw.includes('auth/too-many-requests')) {
    return {
      message: 'Too many unsuccessful attempts. Please wait a moment or reset your password.',
    };
  }
  return {
    message: raw.replace('Firebase: ', ''),
  };
}

export const LandingAuthView: React.FC<LandingAuthViewProps> = ({
  onOpenSetupGuide,
}) => {
  const [mode, setMode] = useState<AuthMode>('landing');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showProviderHint, setShowProviderHint] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resetMessages = () => {
    setErrorMsg(null);
    setShowProviderHint(false);
    setSuccessMsg(null);
  };

  const switchMode = (nextMode: AuthMode) => {
    resetMessages();
    setMode(nextMode);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    resetMessages();
    try {
      const compressed = await compressAvatarImageFile(file);
      setPhotoDataUrl(compressed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not process image.');
    }
  };

  const handleGoogleSignIn = async () => {
    resetMessages();
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserProfileDoc({
        uid: cred.user.uid,
        displayName: cred.user.displayName || cred.user.email?.split('@')[0] || 'User',
        email: cred.user.email || '',
        phoneNumber: cred.user.phoneNumber || '',
        photoURL: cred.user.photoURL || '',
      });
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setErrorMsg(mapped.message);
      setShowProviderHint(Boolean(mapped.showConsoleHint));
    } finally {
      setLoading(false);
    }
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMsg('Please enter both your email address and password.');
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      await ensureUserProfileDoc({
        uid: cred.user.uid,
        displayName: cred.user.displayName || trimmedEmail.split('@')[0] || 'User',
        email: cred.user.email || trimmedEmail,
        phoneNumber: cred.user.phoneNumber || '',
        photoURL: cred.user.photoURL || '',
      });
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setErrorMsg(mapped.message);
      setShowProviderHint(Boolean(mapped.showConsoleHint));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phoneNumber.trim();

    if (!trimmedName) {
      setErrorMsg('Full Name is required.');
      return;
    }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorMsg('Please enter a valid Email Address.');
      return;
    }
    if (!trimmedPhone || trimmedPhone.length < 7) {
      setErrorMsg('Please enter a valid Phone Number.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please confirm your password.');
      return;
    }

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        trimmedEmail,
        password
      );
      await updateProfile(cred.user, {
        displayName: trimmedName,
      });
      await ensureUserProfileDoc({
        uid: cred.user.uid,
        displayName: trimmedName,
        email: trimmedEmail,
        phoneNumber: trimmedPhone,
        photoURL: photoDataUrl,
      });
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setErrorMsg(mapped.message);
      setShowProviderHint(Boolean(mapped.showConsoleHint));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg('Please enter your registered email address.');
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setSuccessMsg(
        `Password reset instructions have been sent to ${trimmedEmail}. Please check your inbox.`
      );
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setErrorMsg(mapped.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: Zone 1 Brand, Zone 2 Nav Links, Zone 3 Primary Action */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
        <button
          type="button"
          onClick={() => switchMode('landing')}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-slate-900"
        >
          Monthly Tracker
        </button>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#features"
            onClick={() => switchMode('landing')}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Calendar System
          </a>
          <a
            href="#trackers"
            onClick={() => switchMode('landing')}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Study & Expenses
          </a>
          <button
            type="button"
            onClick={onOpenSetupGuide}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Firebase Setup Guide
          </button>
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Sign In
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Create Account
          </button>
        </div>
      </header>

      {mode === 'landing' ? (
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 md:py-16">
          {/* Hero Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-semibold text-slate-500 mb-3">
                Personal Productivity · Study Logs · Expense Ledger
              </p>
              <h1
                className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-tight mb-4"
                style={{ textWrap: 'balance' }}
              >
                Monthly Tracker
              </h1>
              <p className="text-xl font-medium text-slate-700 mb-4">
                Track Your Days. Understand Your Progress.
              </p>
              <p className="text-base text-slate-600 leading-relaxed mb-8 max-w-xl">
                An interactive monthly calendar built for consistent daily execution.
                Track study hours, daily habits, personal milestones, and daily expenses
                with cloud persistence powered by Firebase Authentication and Cloud Firestore.
              </p>

              <div className="flex flex-wrap items-center gap-3 mb-8">
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                >
                  Create Account
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>Cloud Firestore Persistence</span>
                <span aria-hidden="true">·</span>
                <span>Independent Multi-Trackers</span>
                <span aria-hidden="true">·</span>
                <span>Indian Rupee (₹) Expense Ledger</span>
                <span aria-hidden="true">·</span>
                <span>CSV Monthly Reports</span>
              </div>
            </div>

            {/* Interactive Preview Card */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      October 2026 — Study Tracker
                    </h2>
                    <p className="text-xs text-slate-500">
                      Target: 4h / day · Subject: Physics & Electrical Engineering
                    </p>
                  </div>
                  <span className="font-mono-tabular text-xs font-semibold text-emerald-700">
                    88.0% Eligible Completion
                  </span>
                </div>

                {/* Mini Sample Calendar Row */}
                <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-slate-500 mb-2">
                  <div>Sun</div>
                  <div>Mon</div>
                  <div>Tue</div>
                  <div>Wed</div>
                  <div>Thu</div>
                  <div>Fri</div>
                  <div>Sat</div>
                </div>
                <div className="grid grid-cols-7 gap-1.5 mb-6">
                  {[
                    { day: 18, status: 'skipped', label: '–', sub: 'Rest' },
                    { day: 19, status: 'completed', label: '✓', sub: '4.5h' },
                    { day: 20, status: 'completed', label: '✓', sub: '4.0h' },
                    { day: 21, status: 'not_completed', label: '✗', sub: '1.5h' },
                    { day: 22, status: 'completed', label: '✓', sub: '5.0h' },
                    { day: 23, status: 'completed', label: '✓', sub: '4.0h' },
                    { day: 24, status: 'completed', label: '✓', sub: '4.5h' },
                  ].map((item) => (
                    <div
                      key={item.day}
                      className={`p-2 rounded-lg border text-left flex flex-col justify-between min-h-[68px] ${
                        item.status === 'completed'
                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                          : item.status === 'not_completed'
                            ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono-tabular text-xs font-bold">
                          {item.day}
                        </span>
                        <span
                          className={`text-xs font-bold ${
                            item.status === 'completed'
                              ? 'text-emerald-700'
                              : item.status === 'not_completed'
                                ? 'text-rose-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {item.label}
                        </span>
                      </div>
                      <span className="font-mono-tabular text-[11px] text-slate-600">
                        {item.sub}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 grid grid-cols-3 gap-4 text-left">
                <div>
                  <p className="text-xs text-slate-500">Completed Symbol</p>
                  <p className="text-sm font-semibold text-emerald-700 mt-0.5">
                    ✓ Completed
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Not Completed Symbol</p>
                  <p className="text-sm font-semibold text-rose-700 mt-0.5">
                    ✗ Not Completed
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Skipped Symbol</p>
                  <p className="text-sm font-semibold text-slate-700 mt-0.5">
                    – Skipped
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 3-Column Feature Architecture */}
          <section id="features" className="mt-16 pt-12 border-t border-slate-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-800 mb-4">
                  <Calendar className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  01. Interactive Monthly Calendar
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Handles leap years, February lengths, and configurable Sunday or Monday
                  week starts. Tap any date to mark ✓ Completed, ✗ Not Completed, – Skipped,
                  or clear status with immediate Firestore persistence.
                </p>
              </div>

              <div id="trackers" className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-800 mb-4">
                  <BookOpen className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  02. Specialized Study Tracker
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Configure daily target hours, subjects (Physics, Mathematics, Electrical
                  Engineering, or custom), and daily task descriptions. Record actual hours
                  studied independently of task completion status.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-800 mb-4">
                  <Wallet className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  03. Indian Rupee (₹) Expense Tracker
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Log multiple expenses per date with category, payment method, and notes.
                  View daily totals inside calendar cells, track monthly budgets, and analyze
                  category breakdowns in INR.
                </p>
              </div>
            </div>
          </section>
        </main>
      ) : (
        <main className="flex-1 flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  {mode === 'signin'
                    ? 'Sign In to Monthly Tracker'
                    : mode === 'signup'
                      ? 'Create Your Account'
                      : 'Reset Your Password'}
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Track Your Days. Understand Your Progress.
                </p>
              </div>
              <button
                type="button"
                onClick={() => switchMode('landing')}
                aria-label="Back to landing page"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switch Tabs */}
            {mode !== 'reset' && (
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-6">
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    mode === 'signin'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    mode === 'signup'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create Account
                </button>
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs leading-relaxed"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium">{errorMsg}</p>
                    {showProviderHint && (
                      <div className="mt-2 pt-2 border-t border-rose-200 text-rose-800">
                        <p className="mb-1.5">
                          To enable Email/Password in Firebase Console for project{' '}
                          <span className="font-mono-tabular font-semibold">
                            {firebaseConfig.projectId}
                          </span>
                          :
                        </p>
                        <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
                          <li>Open Firebase Console → Authentication → Sign-in method</li>
                          <li>Click Email/Password → Enable → Save</li>
                        </ol>
                        <button
                          type="button"
                          onClick={onOpenSetupGuide}
                          className="mt-2 underline font-semibold text-rose-900 hover:text-rose-700"
                        >
                          View Full Firebase Setup Instructions
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {successMsg && (
              <div
                role="status"
                className="mb-5 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Google Sign-In Button */}
            {mode !== 'reset' && (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleGoogleSignIn}
                  className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
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

                <div className="relative my-5 flex items-center justify-center">
                  <div className="border-t border-slate-200 w-full" />
                  <span className="bg-white px-3 text-[11px] text-slate-400 whitespace-nowrap">
                    or with email & password
                  </span>
                  <div className="border-t border-slate-200 w-full" />
                </div>
              </>
            )}

            {mode === 'signin' && (
              <form onSubmit={handleSignInSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => switchMode('reset')}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Sign In</span>
                </button>
              </form>
            )}

            {mode === 'signup' && (
              <form onSubmit={handleSignUpSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Aarav Sharma"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="aarav@example.com"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required
                      maxLength={30}
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Password *
                    </label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 6 chars"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Confirm Password *
                    </label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                {/* Optional Profile Photo */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Profile Photo (Optional)
                  </label>
                  <div className="flex items-center gap-3">
                    {photoDataUrl ? (
                      <img
                        src={photoDataUrl}
                        alt="Profile preview"
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-full object-cover border border-slate-300 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                        <User className="w-5 h-5" />
                      </div>
                    )}
                    <label className="cursor-pointer px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{photoDataUrl ? 'Change Photo' : 'Upload Photo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>
                    {photoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setPhotoDataUrl('')}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Create Account</span>
                </button>
              </form>
            )}

            {mode === 'reset' && (
              <form onSubmit={handlePasswordResetSubmit} className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Enter the email address associated with your account and we will send
                  you a password reset link via Firebase Authentication.
                </p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Back to Sign In
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Send Reset Link</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </main>
      )}

      <footer className="mt-auto border-t border-slate-200 bg-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-700" />
            <span>Monthly Tracker · Secured by Firebase Authentication & Cloud Firestore</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onOpenSetupGuide}
              className="hover:text-slate-900 underline flex items-center gap-1"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Firebase Setup & Security Guide</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
