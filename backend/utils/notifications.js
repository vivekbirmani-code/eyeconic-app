// Force Expo Push API to send a "data-only" FCM message by NOT providing a top-level `title` or `body`.
// If `title` or `body` are provided at the root, Android OS intercepts the FCM payload when the app is killed 
// and NEVER calls our custom MyFirebaseMessagingService.
// By placing them inside the `data` payload, the Kotlin service receives the raw data even when killed, 
// and can manually trigger CallForegroundService or native NotificationCompat.Builder.
async function sendPushNotification(expoPushToken, title, body, data = {}) {
    if (!expoPushToken) return;

    // We explicitly move title and body INSIDE the data object
    const customData = {
        ...data,
        type: data.type || 'incoming_call', // Ensure type is present in root of data
        title: title || 'Eyeconic',
        message: body || '', // Map body to message internally to avoid Expo confusion
        categoryId: 'calls',
        _displayInForeground: true
    };

    const message = {
        to: expoPushToken,
        priority: 'high',
        data: customData,
        channelId: 'calls',
        // NO top-level title, body, or sound! This ensures a 100% data-only FCM payload on Android.
    };

    try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });
        const result = await response.json();
        console.log('Expo data-only push sent:', result);
    } catch (error) {
        console.error('Error sending Expo push notification:', error);
    }
}

module.exports = {
    sendPushNotification
};
