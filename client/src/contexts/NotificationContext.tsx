import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { isFeatureEnabled } from '../config/features';

interface NotificationContextData {
  socket: Socket | null;
  isConnected: boolean;
}

const NotificationContext = createContext<NotificationContextData>({
  socket: null,
  isConnected: false,
});

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    // TEMPORARY FEATURE FREEZE — this socket only serves group chat; skip
    // connecting while chat is disabled (config/features.ts).
    if (!isFeatureEnabled('chat')) {
      return;
    }

    // Connect to WebSocket server using the same URL as the API but without /api
    const socketUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL.replace('/api', '');
    
    const newSocket = io(socketUrl, {
      transports: ['websocket'],
      auth: {
        userId: user._id,
        role: user.role
      }
    });

    newSocket.on('connect', () => {
      console.log('Socket connected successfully');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setIsConnected(false);
    });

    setSocket(newSocket);

    // Cleanup on unmount or user change
    return () => {
      newSocket.disconnect();
    };
  }, [user]);

  return (
    <NotificationContext.Provider value={{ socket, isConnected }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
