import axios from 'axios';

export const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor for authentication
api.interceptors.request.use(
    (config) => {
        // We'll manage tokens here via localStorage instead of AsyncStorage
        const token = localStorage.getItem('userToken');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
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
            console.log('Unauthorized access - dispatching log out');
            localStorage.removeItem('userToken');
            window.dispatchEvent(new Event('unauthorizedUser'));
        }
        return Promise.reject(error);
    }
);
