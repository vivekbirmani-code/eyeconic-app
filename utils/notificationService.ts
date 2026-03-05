/**
 * notificationService.ts
 *
 * Utility functions for managing background notifications, calls, and ensuring
 * the app is not killed by battery optimizations.
 *
 * Usage:
 *   import { dismissCallNotification, requestBatteryOptimizationExemption } from '@/utils/notificationService';
 */

import { NativeModules, Platform, Alert } from 'react-native';

const { WakeUpModule, BatteryOptimizationModule } = NativeModules;

// ---------------------------------------------------------------------------
// Call Management
// ---------------------------------------------------------------------------

/**
 * Wake up the device screen when the app's activity is alive.
 * For the killed-app scenario, the CallForegroundService handles wake-up
 * natively before the JS bridge is available.
 */
export function wakeUpDevice(): void {
    if (Platform.OS !== 'android') return;
    try {
        WakeUpModule?.activate();
    } catch (e) {
        console.warn('[notificationService] wakeUpDevice failed:', e);
    }
}

/**
 * Cancel the ongoing call foreground service notification.
 * Call this when the user answers or declines an incoming call from the JS side.
 *
 * Example:
 *   // In your call-ended / call-accepted handler:
 *   dismissCallNotification();
 */
export function dismissCallNotification(): void {
    if (Platform.OS !== 'android') return;
    try {
        WakeUpModule?.dismissCallNotification();
    } catch (e) {
        console.warn('[notificationService] dismissCallNotification failed:', e);
    }
}

// ---------------------------------------------------------------------------
// Battery Optimization
// ---------------------------------------------------------------------------

/**
 * Returns true if the app is already excluded from battery optimizations.
 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    try {
        return await BatteryOptimizationModule?.isIgnoringBatteryOptimizations();
    } catch (e) {
        console.warn('[notificationService] isIgnoringBatteryOptimizations failed:', e);
        return false;
    }
}

/**
 * Prompts the user to disable battery optimization for this app.
 *
 * Shows a user-friendly dialog first explaining why this is needed,
 * then opens the system battery optimization settings on confirmation.
 *
 * Call this early in your app lifecycle, e.g., from the home screen
 * or during onboarding.
 *
 * Example:
 *   useEffect(() => {
 *     requestBatteryOptimizationExemption();
 *   }, []);
 */
export async function requestBatteryOptimizationExemption(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
        const alreadyExcluded = await isIgnoringBatteryOptimizations();
        if (alreadyExcluded) {
            console.log('[notificationService] Already excluded from battery optimizations');
            return;
        }

        // Show a plain-language explanation before opening the system dialog
        Alert.alert(
            'Keep Notifications Active',
            'To receive calls and messages even when the app is closed, please allow Eyeconic to run in the background by disabling battery restrictions.',
            [
                {
                    text: 'Not Now',
                    style: 'cancel',
                },
                {
                    text: 'Allow',
                    onPress: async () => {
                        try {
                            await BatteryOptimizationModule?.requestIgnoreBatteryOptimizations();
                        } catch (e) {
                            console.warn('[notificationService] requestIgnoreBatteryOptimizations failed:', e);
                        }
                    },
                },
            ],
            { cancelable: true }
        );
    } catch (e) {
        console.warn('[notificationService] requestBatteryOptimizationExemption failed:', e);
    }
}
