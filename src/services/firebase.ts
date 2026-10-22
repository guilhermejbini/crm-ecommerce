import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, setLogLevel } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Silence Firestore internal log warnings and backoff notices
try {
  setLogLevel('silent');
} catch {
  // Ignore in case of environments where setLogLevel is not permitted
}

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Use the database ID specified in the configuration if provided
export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);
export default app;
