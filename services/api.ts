import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// PRODUCTION URL - Replace with your deployed backend URL
// Example: 'https://your-backend.onrender.com/api'
const PRODUCTION_API_URL = 'https://your-backend-url.onrender.com/api';

// Use localhost for web, your computer's IP for mobile devices in development
const getBaseURL = () => {
  // For production builds (APK), use the production URL
  if (!__DEV__) {
    return PRODUCTION_API_URL;
  }

  // Development mode
  if (Platform.OS === 'web') {
    return 'http://localhost:3000/api';
  }

  // Dynamically get the IP address from Expo Go's host URI
  // This works when running 'npx expo start' on your computer
  const debuggerHost = Constants.expoConfig?.hostUri;
  if (debuggerHost) {
    const ip = debuggerHost.split(':')[0];
    return `http://${ip}:3000/api`;
  }

  // Fallback IP (useful for development if hostUri is missing)
  return 'http://10.78.16.198:3000/api';
};

export const api = axios.create({
  baseURL: getBaseURL(),
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for authentication
api.interceptors.request.use(
  (config) => {
    // Headers are automatically handled by AuthContext
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized access - redirect to login
      console.log('Unauthorized access');
    }
    return Promise.reject(error);
  }
);