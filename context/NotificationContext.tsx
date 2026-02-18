import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { api } from '@/services/api';
import { getSocketURL } from '@/services/config';
import { io, Socket } from 'socket.io-client';

interface NotificationContextType {
  unreadCounts: { [groupId: string]: number };
  totalUnreadCount: number;
  refreshUnreadCounts: () => Promise<void>;
  markAsRead: (groupId: string) => Promise<void>;
  socket: Socket | null;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [unreadCounts, setUnreadCounts] = useState<{ [groupId: string]: number }>({});
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

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

      const newSocket = io(getSocketURL());
      socketRef.current = newSocket;
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Notification socket connected');
        // Register user so server can emit targeted events
        newSocket.emit('register_user', user._id);
        // Also join rooms for all user's groups (for message notifications)
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

      // When this user is added to a new group — join the socket room
      newSocket.on('group_added', (data: { groupId: string; groupName: string }) => {
        console.log('group_added event received:', data.groupName);
        newSocket.emit('join_room', data.groupId);
        // Refresh unread counts to include the new group
        refreshUnreadCounts();
      });

      // When this user is removed from a group — leave the socket room
      newSocket.on('group_removed', (data: { groupId: string }) => {
        console.log('group_removed event received:', data.groupId);
        newSocket.emit('leave_room', data.groupId);
        refreshUnreadCounts();
      });

      return () => {
        newSocket.disconnect();
        socketRef.current = null;
      };
    } else {
      setUnreadCounts({});
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
    }
  }, [user]);

  const totalUnreadCount = Object.values(unreadCounts).reduce((acc, count) => acc + count, 0);

  return (
    <NotificationContext.Provider value={{ unreadCounts, totalUnreadCount, refreshUnreadCounts, markAsRead, socket }}>
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
