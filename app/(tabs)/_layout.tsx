import { Tabs, Redirect } from 'expo-router';
import { Users, MessageCircle, BookOpen, Home } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useNotifications } from '@/context/NotificationContext';

function TabInner() {
  const { totalUnreadCount } = useNotifications();
  const { user } = useAuth();
  
  const isAdmin = user?.role === 'admin';
  const showUsers = isAdmin;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#6B7280',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#E5E7EB',
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Home color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: 'Users',
          tabBarIcon: ({ color, size }) => (
            <Users color={color} size={size} />
          ),
          // Hide this tab for non-admin users
          href: showUsers ? '/users' : null,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color, size }) => (
            <MessageCircle color={color} size={size} />
          ),
          tabBarBadge: totalUnreadCount > 0 ? totalUnreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="quizzes"
        options={{
          title: 'Quizzes',
          tabBarIcon: ({ color, size }) => (
            <BookOpen color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { user, isLoading } = useAuth();

  // Show loading while checking auth
  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Redirect to login if no user
  if (!user) {
    return <Redirect href="/login" />;
  }

  return (
    <TabInner />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#6B7280',
  },
});