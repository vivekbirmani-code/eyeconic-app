const { sendFcmNotification } = require('./firebase');

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

const getChannelFromType = (type) => {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'incoming_call' || normalized === 'call') return 'calls';
    if (normalized === 'group' || normalized === 'message' || normalized === 'group_message') return 'messages';
    if (normalized.startsWith('quiz') || normalized === 'test') return 'tests';
    return 'messages';
};

/**
 * Send a push notification to a user.
 *
 * Prefers direct FCM delivery (works in background & killed state on Android).
 * Falls back to Expo Push API if no FCM token is available.
 *
 * @param {Object} opts
 * @param {string} [opts.expoPushToken] - Expo push token (ExponentPushToken[xxx])
 * @param {string} [opts.fcmToken]      - Raw FCM device token
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {Object} [opts.data]
 */
async function sendPushToUser({ expoPushToken, fcmToken, title, body, data = {} }) {
    const type = data.type || 'notification';
    const channelId = data.channelId || getChannelFromType(type);
    const enrichedData = { ...data, type, channelId };

    // 1. Try direct FCM (most reliable for Android background/killed)
    if (fcmToken) {
        const sent = await sendFcmNotification(fcmToken, title, body, enrichedData);
        if (sent) return; // delivered via FCM, done
    }

    // 2. Fallback: Expo Push API
    if (expoPushToken) {
        await sendExpoPush(expoPushToken, title, body, enrichedData, channelId);
    }
}

/**
 * Legacy wrapper — accepts a single token string (Expo or FCM) for backward
 * compatibility with existing call sites.  New code should use sendPushToUser.
 */
async function sendPushNotification(token, title, body, data = {}) {
    if (!token) return;

    // Detect token type
    const isExpoToken = String(token).startsWith('ExponentPushToken');
    await sendPushToUser({
        expoPushToken: isExpoToken ? token : undefined,
        fcmToken: isExpoToken ? undefined : token,
        title,
        body,
        data,
    });
}

// --- Expo Push API (fallback) ---
async function sendExpoPush(expoPushToken, title, body, data, channelId) {
    const type = data.type || 'notification';
    const isCall = type === 'incoming_call' || type === 'call';

    const customData = {
        ...data,
        title: title || 'Eyeconic',
        message: body || '',
        _displayInForeground: true,
    };

    const message = {
        to: expoPushToken,
        priority: 'high',
        ttl: 0,
        channelId,
        data: customData,
    };

    // For non-call notifications add title/body so Expo generates an FCM
    // notification payload — this lets Android show the notification even
    // when the app process is dead.
    if (!isCall) {
        message.title = title || 'Eyeconic';
        message.body = body || '';
    }

    try {
        const response = await fetch(EXPO_PUSH_API, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        const result = await response.json();
        // Expo returns data as an array of ticket objects
        const tickets = Array.isArray(result?.data) ? result.data : [result?.data];
        for (const ticket of tickets) {
            if (ticket?.status === 'error') {
                console.error('Expo push error:', ticket.message, ticket.details);
            }
        }
    } catch (error) {
        console.error('Error sending Expo push notification:', error);
    }
}

module.exports = {
    sendPushNotification,
    sendPushToUser,
};
