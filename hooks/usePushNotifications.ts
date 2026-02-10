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
            console.log('Push notifications skipped - isExpoGo:', isExpoGo, 'Notifications:', !!Notifications);
            return;
        }

        console.log('Registering for push notifications, user:', user?._id);
        registerForPushNotificationsAsync().then(token => {
            if (token) {
                console.log('Push token obtained:', token);
                setExpoPushToken(token);
                // Save token to backend
                if (user?._id) {
                    savePushTokenToBackend(token);
                }
            } else {
                console.log('No push token obtained');
            }
        }).catch(err => {
            console.error('Push notification registration failed:', err);
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
            console.log('Push token saved to backend');
        } catch (error) {
            console.error('Error saving push token:', error);
        }
    };

    return { expoPushToken };
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
    if (!Notifications) return null;

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
