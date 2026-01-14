import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';

// Configure notification handling
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

export function usePushNotifications() {
    const { user } = useAuth();
    const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
    const notificationListener = useRef<any>();
    const responseListener = useRef<any>();

    useEffect(() => {
        registerForPushNotificationsAsync().then(token => {
            if (token) {
                setExpoPushToken(token);
                // Save token to backend
                if (user?._id) {
                    savePushTokenToBackend(token);
                }
            }
        });

        // Listen for incoming notifications
        notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
            console.log('Notification received:', notification);
        });

        // Listen for notification responses (when user taps)
        responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
            console.log('Notification response:', response);
            const data = response.notification.request.content.data;

            // Handle call notification
            if (data.type === 'incoming_call') {
                // The call context will handle this via the incoming_call socket event
                console.log('Incoming call notification tapped:', data);
            }
        });

        return () => {
            if (notificationListener.current) {
                Notifications.removeNotificationSubscription(notificationListener.current);
            }
            if (responseListener.current) {
                Notifications.removeNotificationSubscription(responseListener.current);
            }
        };
    }, [user?._id]);

    const savePushTokenToBackend = async (token: string) => {
        try {
            await api.post('/users/push-token', { pushToken: token });
            console.log('Push token saved to backend');
        } catch (error) {
            console.error('Error saving push token:', error);
        }
    };

    return { expoPushToken };
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
    let token: string | null = null;

    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('calls', {
            name: 'Incoming Calls',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#10B981',
            sound: 'default',
        });

        await Notifications.setNotificationChannelAsync('messages', {
            name: 'Messages',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 100, 100, 100],
            lightColor: '#3B82F6',
        });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('Failed to get push notification permission');
        return null;
    }

    try {
        const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId: 'b339dc67-5b70-425b-acd0-585b6954dd02',
        });
        token = tokenData.data;
        console.log('Expo Push Token:', token);
    } catch (error) {
        console.error('Error getting push token:', error);
    }

    return token;
}
