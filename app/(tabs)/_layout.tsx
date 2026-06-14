import { Tabs, Redirect } from 'expo-router';
import { Users, MessageCircle, BookOpen, Home, UserCheck, ClipboardList, TrendingUp, Sparkles, BarChart2 } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useNotifications } from '@/context/NotificationContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function TabInner() {
  const { totalUnreadCount, unseenQuizCount } = useNotifications();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const isFree = user?.isFreeUser === true;
  const isAdmin = user?.role === 'admin' && !isFree;
  const isMentor = user?.role === 'mentor' && !isFree;
  const isStudent = user?.role === 'student' && !isFree;
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
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 5,
          paddingTop: 10,
          paddingHorizontal: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: 2,
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
          title: isFree ? 'Home' : 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Home color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="transformations"
        options={{
          title: 'Transformations',
          tabBarIcon: ({ color, size }) => (
            <Sparkles color={color} size={22} />
          ),
          href: isFree ? '/transformations' : null,
        }}
      />
      <Tabs.Screen
        name="graphs"
        options={{
          title: 'Graphs',
          tabBarIcon: ({ color, size }) => (
            <BarChart2 color={color} size={22} />
          ),
          href: isFree ? '/graphs' : null,
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
        name="admin-overview"
        options={{
          title: 'Overview',
          tabBarIcon: ({ color, size }) => (
            <TrendingUp color={color} size={22} />
          ),
          // Hide this tab for non-admin users
          href: isAdmin ? '/admin-overview' : null,
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
          href: isFree ? null : '/groups',
        }}
      />
      <Tabs.Screen
        name="mentor-dashboard"
        options={{
          title: 'My Students',
          tabBarIcon: ({ color, size }) => (
            <UserCheck color={color} size={22} />
          ),
          // Hide this tab for non-mentor users
          href: isMentor ? '/mentor-dashboard' : null,
        }}
      />
      <Tabs.Screen
        name="student-assignments"
        options={{
          title: 'My Tasks',
          tabBarIcon: ({ color, size }) => (
            <ClipboardList color={color} size={22} />
          ),
          // Hide this tab for non-student users
          href: isStudent ? '/student-assignments' : null,
        }}
      />
      <Tabs.Screen
        name="quizzes"
        options={{
          title: isFree ? 'Quizzes' : 'Tests',
          tabBarIcon: ({ color, size }) => (
            <BookOpen color={color} size={22} />
          ),
          tabBarBadge: unseenQuizCount > 0 ? unseenQuizCount : undefined,
          href: isFree ? null : '/quizzes',
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