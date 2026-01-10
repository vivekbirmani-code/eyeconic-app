import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { api } from '@/services/api';
import { io, Socket } from 'socket.io-client';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

interface NotificationContextType {
  unreadCounts: { [groupId: string]: number };
  totalUnreadCount: number;
  refreshUnreadCounts: () => Promise<void>;
  markAsRead: (groupId: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [unreadCounts, setUnreadCounts] = useState<{ [groupId: string]: number }>({});
  const [socket, setSocket] = useState<Socket | null>(null);

  const refreshUnreadCounts = useCallback(async () => {
    if (!user) return;
    try {
      const response = await api.get('/groups');
      const counts: { [groupId: string]: number } = {};
      response.data.forEach((group: any) => {
        counts[group._id] = group.unreadCount || 0;
      });
      setUnreadCounts(counts);
    } catch (error) {
      console.error('Failed to fetch unread counts:', error);
    }
  }, [user]);

  const markAsRead = async (groupId: string) => {
    if (!user) return;
    try {
      await api.post(`/groups/${groupId}/read`);
      setUnreadCounts(prev => ({
        ...prev,
        [groupId]: 0
      }));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  useEffect(() => {
    if (user) {
      refreshUnreadCounts();

      const getSocketURL = () => {
        if (Platform.OS === 'web') return 'http://localhost:3000';
        const hostUri = Constants.expoConfig?.hostUri;
        if (hostUri) {
          const ip = hostUri.split(':')[0];
          return `http://${ip}:3000`;
        }
        return 'http://10.78.16.198:3000'; // Fallback to the one in api.ts
      };

      const newSocket = io(getSocketURL());
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Notification socket connected');
        // Join rooms for all user's groups to receive message notifications
        user.groups?.forEach((groupId: string) => {
          newSocket.emit('join_room', groupId);
        });
      });

      newSocket.on('receive_message', (data: any) => {
        // If message is from someone else, increment unread count for that group
        if (data.sender._id !== user._id) {
          setUnreadCounts(prev => ({
            ...prev,
            [data.group]: (prev[data.group] || 0) + 1
          }));
        }
      });

      return () => {
        newSocket.disconnect();
      };
    } else {
      setUnreadCounts({});
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
    }
  }, [user]);

  const totalUnreadCount = Object.values(unreadCounts).reduce((acc, count) => acc + count, 0);

  return (
    <NotificationContext.Provider value={{ unreadCounts, totalUnreadCount, refreshUnreadCounts, markAsRead }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
