const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

const getChannelFromType = (type) => {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'incoming_call' || normalized === 'call') return 'calls';
    if (normalized === 'group' || normalized === 'message' || normalized === 'group_message') return 'messages';
    if (normalized.startsWith('quiz') || normalized === 'test') return 'tests';
    return 'messages';
};

// Send Expo data-only push notifications so Android native handlers work in background/killed states.
async function sendPushNotification(expoPushToken, title, body, data = {}) {
    if (!expoPushToken) return;

    const type = data.type || 'notification';
    const channelId = data.channelId || getChannelFromType(type);
    const customData = {
        ...data,
        type,
        title: title || 'Eyeconic',
        message: body || '',
        channelId,
        _displayInForeground: true,
    };

    const message = {
        to: expoPushToken,
        priority: 'high',
        ttl: 0,
        channelId,
        data: customData,
        // Keep title/body out of root payload to preserve data-only delivery behavior.
    };

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
        if (result?.data?.status === 'error') {
            console.error('Expo push rejected:', result);
        }
    } catch (error) {
        console.error('Error sending Expo push notification:', error);
    }
}

module.exports = {
    sendPushNotification
};
