const admin = require('firebase-admin');

let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized) return;

  try {
    // Option 1: Service account JSON file path via env var
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    // Option 2: Service account JSON content via env var
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountPath) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log('Firebase Admin SDK initialized from service account file');
    } else if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log('Firebase Admin SDK initialized from env JSON');
    } else {
      // Try default application credentials (works in GCP/Cloud Run)
      admin.initializeApp();
      firebaseInitialized = true;
      console.log('Firebase Admin SDK initialized with default credentials');
    }
  } catch (error) {
    console.error('Firebase Admin SDK initialization failed:', error.message);
    console.error(
      'Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON env var. ' +
      'Download service account key from Firebase Console > Project Settings > Service Accounts.'
    );
  }
}

/**
 * Send a push notification directly via Firebase Cloud Messaging.
 * Returns true if sent successfully, false otherwise.
 */
async function sendFcmNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken) return false;
  if (!firebaseInitialized) {
    initFirebase();
    if (!firebaseInitialized) return false;
  }

  const type = String(data.type || '').toLowerCase();
  const isCall = type === 'incoming_call' || type === 'call';

  // Build the FCM message
  const message = {
    token: fcmToken,
    // Data payload — always included, always delivered to onMessageReceived
    data: Object.fromEntries(
      Object.entries({
        ...data,
        title: title || 'Eyeconic',
        body: body || '',
        message: body || '',
      }).map(([k, v]) => [k, String(v)])
    ),
    android: {
      priority: 'high',
      ttl: 0,
    },
  };

  // For non-call notifications: add a notification field so Android shows it
  // automatically even when the app is killed (system tray handles it).
  // For calls: keep data-only so onMessageReceived fires and starts the
  // foreground service.
  if (!isCall) {
    message.android.notification = {
      title: title || 'Eyeconic',
      body: body || '',
      channelId: data.channelId || getAndroidChannelId(type),
      priority: 'high',
      defaultVibrateTimings: true,
      defaultSound: true,
      visibility: 'PUBLIC',
    };
  }

  try {
    await admin.messaging().send(message);
    return true;
  } catch (error) {
    const code = error.code || '';
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') {
      console.warn(`FCM token invalid/expired for token ${fcmToken.substring(0, 20)}..., should be cleaned up`);
    } else {
      console.error('FCM send error:', error.message);
    }
    return false;
  }
}

function getAndroidChannelId(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'incoming_call' || t === 'call') return 'calls';
  if (t === 'group' || t === 'message' || t === 'group_message' || t === 'notification') return 'messages';
  if (t.startsWith('quiz') || t === 'test') return 'tests';
  return 'messages';
}

// Initialize on import
initFirebase();

module.exports = { sendFcmNotification, initFirebase };
