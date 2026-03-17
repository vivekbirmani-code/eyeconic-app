const admin = require('firebase-admin');

let firebaseInitialized = false;

// Hardcoded fallback service account (used when env vars are not set)
const FALLBACK_SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'neetmentorship-a10c5',
  private_key_id: 'c9d961e3f8f7ca02666442324023829dc60c4e1f',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDewklFSMKH5EDQ\n25XVfIlrzau+0MQQ2gw0Ar30Dm930Y1uv8pJjzZXS1CZeTK+ULL2Omph00Tc/WH8\nx7bWfL0wMlaKPd+ud/Gc0mUo55NsGXdOBLPqoI/BuykVCijEo+W4P4GfFEptzzgG\nyiIcz/Ldn31dmzVGSjqdqbUfhKKIVQ7kpKrbNYrK+Us+KQcwONaWJ1jtKbgmB9f0\nb5nqpvIHNrve6KRkqOOECe5SeoSojKQlG9Gm2O50P2Hoq9YgaD/vSE/roLy3ZTWG\n+Mk53z1+wxzKNnA3RxqC1qwxyyIRN/kEyuZcSmcFb8mjAQqwki3LtN4MCLTF+Y8t\nuTUsZCR1AgMBAAECggEAPtJXHJmE9xMJrn1G99Kr5MG3nlQ8/y2nRGHDlVke2ZE5\nDFM9ZtpjLmI4pFe4VlDm76cQym7tHE+/Oy1NpJbAOh/wJQOHGiqMcrgpPEx22IUk\nDtYnsVM/x5iTYPIhBjfcuMX8NdNgnDBU8iE+VpbUvOjWT7hOYXjcqAss3+sldUHU\nzZ4RUfZMFfMHWHsDWUMBtV4/uqyolV/r0Xp1mRcsNI9XazV3TmyD0pt8CUOW86W6\nWsMJI77iarCi6mzPA6w+i6IoAFmAcNaRx6Z2z6GjUplfYljqH5wk6rN9vYYWaMtm\nd1teykR3K+au4QpEpJ4Y3JS/rGBrNydnLn1CXo3ijwKBgQD8oIsJaNHvgt0cmJnZ\nYVSFy1ieZYfCn16hIz58T8/sv0w8Re6tXZ61BLH0zfJ+BxQqNj7lcHXeGf+6B1Nq\nr+7QleRKhsvtYzYGbOVwWP9yBcSvKxNOxIW1kC2bxs4CCraJHvot6KcZR/7+6HTc\nKHOq9Sh4J4HSJs3tfiWR8juLiwKBgQDhu6gDIxkGiHP6r04tyJk+cQMx1DrbJX1a\nOn1igXKI7k6EMD5/yw+NaMh731RWj6008REZvlctcgXnH2+gtdfcWAtb/WgBuIU3\nrCwCYoiXBdPX/mnozC4qVvvqEkagRBbrdVkS9XIEFSIGT/Zqeuw/Dlhs/xlA92f9\nRQ6PSpUP/wKBgQDD1t0R9U1R5Fvu0CnsR7STZ9kSKdk9ufhM6JqHGgQxHvdFfl0R\nzpK696HRClqi8m/ibV0C1tS40eTZ3NYAzdRPpPNuBuNN6uw1vPN8zbFxPiGEPdtg\n455X6yZALbUEBjQNRpNhRYtMYPC/wYreJQnODPFLfCz6shRPuMv9QRCCEwKBgQCl\nNI32Hc3G9j7LjVmOMG3XQSaxZT3d/UYMrxns6ghFJwPXwuc66AZt2+4+mmhDIcwG\nHxgA20k6PWUMjflIiU1+OgG2RXPFLqJw6FUdObf1r5InVk90zVpMKnUcDlwaFzsf\nADc8pN3ZFw5byFH0BBq622jj/J8i6O72cYACZvdJSQKBgBxJJHISY84wIUpmuDSF\nVhS7dhmxE/C4KLIMMGEz0cwzvCooEffPx622T3pkXjtxAvsqmaHHhlNOWjHL71E8\nngTCWo+HoRjVlT61KAC4rXw795PnoGGJlHXSsQz1nJip3lLWy4ohR9vj+VIFAXJf\nA+m5BvxYEmHjFUiKR8y0vNY5\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-adminsdk-fbsvc@neetmentorship-a10c5.iam.gserviceaccount.com',
  client_id: '105358893936955090443',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40neetmentorship-a10c5.iam.gserviceaccount.com',
  universe_domain: 'googleapis.com',
};

function initFirebase() {
  if (firebaseInitialized) return;

  try {
    // Env vars override the hardcoded fallback
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    let serviceAccount;
    if (serviceAccountPath) {
      serviceAccount = require(serviceAccountPath);
      console.log('Firebase Admin SDK: using service account file');
    } else if (serviceAccountJson) {
      serviceAccount = JSON.parse(serviceAccountJson);
      console.log('Firebase Admin SDK: using env JSON');
    } else {
      serviceAccount = FALLBACK_SERVICE_ACCOUNT;
      console.log('Firebase Admin SDK: using hardcoded credentials');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log('Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('Firebase Admin SDK initialization failed:', error.message);
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
