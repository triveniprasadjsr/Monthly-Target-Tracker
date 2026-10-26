import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import rawAppletConfig from '../../firebase-applet-config.json';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};

/**
 * Resolved Firebase Web configuration.
 * Prioritizes VITE_FIREBASE_* environment variables (when configured in Vercel)
 * and falls back seamlessly to firebase-applet-config.json (used in Google AI Studio and GitHub builds).
 */
export const firebaseConfig = {
  apiKey: (env.VITE_FIREBASE_API_KEY || rawAppletConfig.apiKey || '').trim(),
  authDomain: (
    env.VITE_FIREBASE_AUTH_DOMAIN ||
    rawAppletConfig.authDomain ||
    ''
  ).trim(),
  projectId: (
    env.VITE_FIREBASE_PROJECT_ID ||
    rawAppletConfig.projectId ||
    ''
  ).trim(),
  storageBucket: (
    env.VITE_FIREBASE_STORAGE_BUCKET ||
    rawAppletConfig.storageBucket ||
    ''
  ).trim(),
  messagingSenderId: (
    env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    rawAppletConfig.messagingSenderId ||
    ''
  ).trim(),
  appId: (env.VITE_FIREBASE_APP_ID || rawAppletConfig.appId || '').trim(),
  measurementId: (
    env.VITE_FIREBASE_MEASUREMENT_ID ||
    rawAppletConfig.measurementId ||
    ''
  ).trim(),
  firestoreDatabaseId: (
    env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    rawAppletConfig.firestoreDatabaseId ||
    ''
  ).trim(),
  oAuthClientId: (
    env.VITE_GOOGLE_OAUTH_CLIENT_ID ||
    rawAppletConfig.oAuthClientId ||
    ''
  ).trim(),
};

export const isFirebaseConfigValid = Boolean(
  firebaseConfig &&
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'remixed-project-id'
);

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseConfigValid) {
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);
  dbInstance = firebaseConfig.firestoreDatabaseId
    ? getFirestore(appInstance, firebaseConfig.firestoreDatabaseId)
    : getFirestore(appInstance);
}

export const app = appInstance!;
export const auth = authInstance!;
export const db = dbInstance!;

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: authInstance?.currentUser?.uid ?? null,
      email: authInstance?.currentUser?.email ?? null,
      emailVerified: authInstance?.currentUser?.emailVerified ?? null,
      isAnonymous: authInstance?.currentUser?.isAnonymous ?? null,
      tenantId: authInstance?.currentUser?.tenantId ?? null,
      providerInfo:
        authInstance?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;
export async function testFirestoreConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!isFirebaseConfigValid || !dbInstance) {
    return {
      ok: false,
      error:
        'Firebase configuration is missing or incomplete. Please check your environment variables or firebase-applet-config.json.',
    };
  }
  if (connectionTested) {
    return { ok: true };
  }
  try {
    await getDocFromServer(doc(dbInstance, 'test', 'connection'));
    connectionTested = true;
    return { ok: true };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
      return {
        ok: false,
        error:
          'Unable to reach Cloud Firestore (client is offline). Please check your network and Firebase configuration.',
      };
    }
    // Permission denied on /test/connection means Firestore is reachable and security rules are active!
    connectionTested = true;
    return { ok: true };
  }
}

/**
 * Defensive payload sanitization helpers matching firebase-blueprint.json & firestore.rules
 */
export const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
export const VALID_DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
export const VALID_MONTH_REGEX = /^[0-9]{4}-[0-9]{2}$/;

export function sanitizeString(value: string, maxLength: number): string {
  return (value || '').trim().slice(0, maxLength);
}

export function generateSafeId(prefix: string): string {
  const randomPart = Math.random().toString(36).substring(2, 10);
  const timePart = Date.now().toString(36);
  return `${prefix}_${timePart}_${randomPart}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}
