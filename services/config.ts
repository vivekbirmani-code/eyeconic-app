import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Production URL - Your deployed backend on Render
const PRODUCTION_URL = 'https://eyeconic-app.vercel.app/';

// Get the base URL for API calls
export const getApiBaseURL = () => {
    // For production builds (APK), use the production URL
    if (!__DEV__) {
        return `${PRODUCTION_URL}/api`;
    }

    // Development mode
    if (Platform.OS === 'web') {
        return 'http://localhost:3000/api';
    }

    // Dynamically get the IP address from Expo Go's host URI
    const debuggerHost = Constants.expoConfig?.hostUri;
    if (debuggerHost) {
        const ip = debuggerHost.split(':')[0];
        return `http://${ip}:3000/api`;
    }

    // Fallback IP for development
    return 'http://10.78.16.198:3000/api';
};

// Get the socket URL for real-time connections
export const getSocketURL = () => {
    // For production builds (APK), use the production URL
    if (!__DEV__) {
        return PRODUCTION_URL;
    }

    // Development mode
    if (Platform.OS === 'web') {
        return 'http://localhost:3000';
    }

    // Dynamically get the IP address from Expo Go's host URI
    const debuggerHost = Constants.expoConfig?.hostUri;
    if (debuggerHost) {
        const ip = debuggerHost.split(':')[0];
        return `http://${ip}:3000`;
    }

    // Fallback IP for development
    return 'http://10.78.16.198:3000';
};