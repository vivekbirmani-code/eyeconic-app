/**
 * Haptics utility wrapper that handles platform-specific behavior.
 * Haptics are only available on iOS and Android, not on web.
 * This wrapper prevents crashes when running on web platform.
 */

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Re-export types for convenience
export { ImpactFeedbackStyle, NotificationFeedbackType } from 'expo-haptics';

/**
 * Check if haptics are supported on the current platform
 */
export const isHapticsSupported = (): boolean => {
    return Platform.OS !== 'web';
};

/**
 * Trigger impact haptic feedback (light, medium, or heavy)
 */
export const impactAsync = async (
    style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium
): Promise<void> => {
    if (Platform.OS !== 'web') {
        await Haptics.impactAsync(style);
    }
};

/**
 * Trigger notification haptic feedback (success, warning, or error)
 */
export const notificationAsync = async (
    type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success
): Promise<void> => {
    if (Platform.OS !== 'web') {
        await Haptics.notificationAsync(type);
    }
};

/**
 * Trigger selection haptic feedback
 */
export const selectionAsync = async (): Promise<void> => {
    if (Platform.OS !== 'web') {
        await Haptics.selectionAsync();
    }
};

// Pre-bound convenience functions with specific styles
export const lightImpact = () => impactAsync(Haptics.ImpactFeedbackStyle.Light);
export const mediumImpact = () => impactAsync(Haptics.ImpactFeedbackStyle.Medium);
export const heavyImpact = () => impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

export const successNotification = () => notificationAsync(Haptics.NotificationFeedbackType.Success);
export const warningNotification = () => notificationAsync(Haptics.NotificationFeedbackType.Warning);
export const errorNotification = () => notificationAsync(Haptics.NotificationFeedbackType.Error);

// Default export with all functions
export default {
    impactAsync,
    notificationAsync,
    selectionAsync,
    isHapticsSupported,
    lightImpact,
    mediumImpact,
    heavyImpact,
    successNotification,
    warningNotification,
    errorNotification,
    ImpactFeedbackStyle: Haptics.ImpactFeedbackStyle,
    NotificationFeedbackType: Haptics.NotificationFeedbackType,
};
