import fs from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { FIREBASE_SERVICE_ACCOUNT_PATH } from './config.js';

try {
  if (fs.existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) {
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8'))) });
    console.log('Firebase Admin initialized successfully.');
  } else {
    console.log('Firebase service account not found; push notifications are disabled.');
  }
} catch (e) {
  console.error('Firebase Admin init failed:', (e as Error).message);
}

export const getFirebaseMessaging = (): Messaging | null => (getApps().length > 0 ? getMessaging() : null);
