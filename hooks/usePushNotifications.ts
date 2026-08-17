import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';

// Check if running in Expo Go
const isExpoGo = Constants.appOwnership === 'expo';

// Dynamically import Notifications to prevent crash in Expo Go
let Notifications: any = null;
try {
    Notifications = require('expo-notifications');

    // Only set handler if not in Expo Go (push notifications don't work there)
    if (!isExpoGo) {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: true,
            }),
        });
    }
} catch (e) {
    console.log('expo-notifications not available');
}

export function usePushNotifications() {
    const { user } = useAuth();
    const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
    const notificationListener = useRef<any>();
    const responseListener = useRef<any>();

    useEffect(() => {
        // Skip push notification setup in Expo Go
        if (isExpoGo || !Notifications) {
            console.log('Push notifications skipped - isExpoGo:', isExpoGo);
            return;
        }

        console.log('Registering for push notifications, user:', user?._id);
        registerForPushNotificationsAsync().then(({ expoToken, fcmToken }) => {
            if (!expoToken && !fcmToken) {
                console.warn(
                    'Push token registration returned no tokens. Ensure notification permission is granted and Android FCM setup is configured.'
                );
            }

            if (expoToken) {
                console.log('Expo Push Token:', expoToken);
                setExpoPushToken(expoToken);
                // Save Expo push token to backend
                if (user?._id) {
                    savePushTokenToBackend(expoToken);
                }
            }
            if (fcmToken) {
                console.log('Raw FCM Token:', fcmToken.substring(0, 30) + '...');
                // Save raw FCM token to backend — this is what enables direct FCM delivery
                if (user?._id) {
                    saveFcmTokenToBackend(fcmToken);
                }
            }
        }).catch(err => {
            console.error('Push notification registration failed:', err);
            console.error('If this is Android, verify FCM setup (google-services.json / EAS credentials).');
        });

        // Listen for incoming notifications
        notificationListener.current = Notifications.addNotificationReceivedListener((notification: any) => {
            console.log('Notification received:', notification);
        });

        // Listen for notification responses (when user taps)
        responseListener.current = Notifications.addNotificationResponseReceivedListener((response: any) => {
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
                notificationListener.current.remove();
            }
            if (responseListener.current) {
                responseListener.current.remove();
            }
        };
    }, [user?._id]);

    const savePushTokenToBackend = async (token: string) => {
        try {
            await api.post('/users/push-token', { pushToken: token });
            console.log('Expo push token saved to backend');
        } catch (error) {
            console.error('Error saving Expo push token:', error);
        }
    };

    const saveFcmTokenToBackend = async (token: string) => {
        try {
            await api.post('/users/fcm-token', { fcmToken: token });
            console.log('Raw FCM token saved to backend');
        } catch (error) {
            console.error('Error saving raw FCM token:', error);
        }
    };

    return { expoPushToken };
}

async function registerForPushNotificationsAsync(): Promise<{ expoToken: string | null; fcmToken: string | null }> {
    if (!Notifications) return { expoToken: null, fcmToken: null };

    let expoToken: string | null = null;
    let fcmToken: string | null = null;

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

        await Notifications.setNotificationChannelAsync('tests', {
            name: 'Test Notifications',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 200, 200, 200],
            lightColor: '#10B981',
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
        return { expoToken: null, fcmToken: null };
    }

    // Get Expo push token — resolve project ID from Expo/EAS config (app.json extra.eas.projectId)
    const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;

    if (!projectId) {
        console.error('EAS project ID not found in Expo config; cannot register for Expo push notifications.');
        return { expoToken: null, fcmToken: null };
    }

    try {
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        expoToken = tokenData.data;
    } catch (error) {
        console.error('Error getting Expo push token:', error);
    }

    // Get the raw FCM device token — this is what we use for direct Firebase Admin delivery
    if (Platform.OS === 'android') {
        try {
            const fcmTokenData = await Notifications.getDevicePushTokenAsync();
            fcmToken = fcmTokenData.data;
        } catch (error) {
            console.error('Error getting raw FCM device token:', error);
        }
    }

    return { expoToken, fcmToken };
}
