import { Tabs, Redirect } from 'expo-router';
import { Users, MessageCircle, BookOpen, Home } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
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
        tabBarActiveTintColor: '#01b4ae',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: {
            width: 0,
            height: -2,
          },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          height: Platform.OS === 'ios' ? 80 : 75,
          paddingBottom: Platform.OS === 'ios' ? 15 : 12,
          paddingTop: 12,
          paddingHorizontal: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: 3,
          marginBottom: 0,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Home color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: 'Users',
          tabBarIcon: ({ color, size }) => (
            <Users color={color} size={22} />
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
            <MessageCircle color={color} size={22} />
          ),
          tabBarBadge: totalUnreadCount > 0 ? totalUnreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="quizzes"
        options={{
          title: 'Quizzes',
          tabBarIcon: ({ color, size }) => (
            <BookOpen color={color} size={22} />
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