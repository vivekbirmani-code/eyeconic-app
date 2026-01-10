import { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  SafeAreaView, 
  Modal,
  TextInput, 
  ScrollView,
  Alert,
  Platform,
  StatusBar
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { LogOut, AlertTriangle, Check } from 'lucide-react-native';

interface StudentProfile {
  mbbsBatch: string;
  collegeName: string;
  attemptNo: string;
  batchType: string;
  grandTestsGiven: string;
  averageCorrects: string;
  averageScore: string;
  weakestSubjects: string;
  targetBranch: string;
  subscriptions: string;
}

export default function Dashboard() {
  const { user, logout, refreshUser } = useAuth();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [profile, setProfile] = useState<StudentProfile>({
    mbbsBatch: '',
    collegeName: '',
    attemptNo: '1',
    batchType: 'FOUNDATION',
    grandTestsGiven: '',
    averageCorrects: '',
    averageScore: '',
    weakestSubjects: '',
    targetBranch: '',
    subscriptions: ''
  });

  // Check if student needs to complete profile
  useEffect(() => {
    // Show modal if student and profile is not complete (includes undefined)
    if (user?.role === 'student' && user?.isProfileComplete !== true) {
      setShowProfileModal(true);
    }
  }, [user]);

  const handleLogout = () => {
    logout();
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrator';
      case 'mentor': return 'Mentor';
      case 'student': return 'Student';
      default: return 'User';
    }
  };

  const handleSubmitProfile = async () => {
    if (!profile.mbbsBatch || !profile.collegeName || !profile.batchType) {
      Alert.alert('Error', 'Please fill in all required fields (MBBS Batch, College Name, Batch Type)');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.put('/users/profile', {
        ...profile,
        attemptNo: parseInt(profile.attemptNo) || 1,
        averageScore: parseInt(profile.averageScore) || 0
      });
      
      // Refresh user data to update isProfileComplete
      if (refreshUser) {
        await refreshUser();
      }
      
      setShowProfileModal(false);
      Alert.alert('Success', 'Profile completed successfully!');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to save profile';
      Alert.alert('Error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const batchTypes = ['FOUNDATION', 'REGULAR', 'CRASH COURSE', 'TEST SERIES'];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <LogOut color="#FFFFFF" size={20} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Welcome Back!</Text>
          <Text style={styles.cardText}>Name: {user?.name}</Text>
          <Text style={styles.cardText}>Email: {user?.email}</Text>
          <Text style={styles.cardText}>Role: {getRoleDisplayName(user?.role || '')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick Actions</Text>
          <Text style={styles.cardText}>
            {user?.role === 'admin' && 'Manage users, groups, and quizzes'}
            {user?.role === 'mentor' && 'View your groups and interact with students'}
            {user?.role === 'student' && 'Join groups and attempt quizzes'}
          </Text>
        </View>
      </View>

      {/* Student Profile Completion Modal */}
      <Modal visible={showProfileModal} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={styles.urgentBanner}>
              <AlertTriangle color="#DC2626" size={24} />
              <Text style={styles.urgentText}>Complete Your Profile</Text>
            </View>
            <Text style={styles.modalSubtitle}>
              Please fill in your details to continue using the app
            </Text>
          </View>

          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
            {/* Basic Info */}
            <Text style={styles.sectionTitle}>Basic Information</Text>
            
            <Text style={styles.inputLabel}>MBBS Batch *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 2019"
              placeholderTextColor="#9CA3AF"
              value={profile.mbbsBatch}
              onChangeText={(text) => setProfile({...profile, mbbsBatch: text})}
            />

            <Text style={styles.inputLabel}>College Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., AIIMS Delhi"
              placeholderTextColor="#9CA3AF"
              value={profile.collegeName}
              onChangeText={(text) => setProfile({...profile, collegeName: text})}
            />

            <Text style={styles.inputLabel}>Attempt Number</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 2"
              placeholderTextColor="#9CA3AF"
              value={profile.attemptNo}
              onChangeText={(text) => setProfile({...profile, attemptNo: text})}
              keyboardType="numeric"
            />

            <Text style={styles.inputLabel}>Batch Type *</Text>
            <View style={styles.batchTypeContainer}>
              {batchTypes.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.batchTypeButton,
                    profile.batchType === type && styles.batchTypeButtonActive
                  ]}
                  onPress={() => setProfile({...profile, batchType: type})}
                >
                  <Text style={[
                    styles.batchTypeText,
                    profile.batchType === type && styles.batchTypeTextActive
                  ]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Performance Info */}
            <Text style={styles.sectionTitle}>Performance Data</Text>

            <Text style={styles.inputLabel}>No. of Grand Tests Given</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 7-8"
              placeholderTextColor="#9CA3AF"
              value={profile.grandTestsGiven}
              onChangeText={(text) => setProfile({...profile, grandTestsGiven: text})}
            />

            <Text style={styles.inputLabel}>Average Corrects</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 90-110"
              placeholderTextColor="#9CA3AF"
              value={profile.averageCorrects}
              onChangeText={(text) => setProfile({...profile, averageCorrects: text})}
            />

            <Text style={styles.inputLabel}>Average Score</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 420"
              placeholderTextColor="#9CA3AF"
              value={profile.averageScore}
              onChangeText={(text) => setProfile({...profile, averageScore: text})}
              keyboardType="numeric"
            />

            {/* Target Info */}
            <Text style={styles.sectionTitle}>Targets & Preferences</Text>

            <Text style={styles.inputLabel}>Weakest Subjects</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Biochem, Pharma, Opthal"
              placeholderTextColor="#9CA3AF"
              value={profile.weakestSubjects}
              onChangeText={(text) => setProfile({...profile, weakestSubjects: text})}
            />

            <Text style={styles.inputLabel}>Target Branch</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Radio, Orthopedics"
              placeholderTextColor="#9CA3AF"
              value={profile.targetBranch}
              onChangeText={(text) => setProfile({...profile, targetBranch: text})}
            />

            <Text style={styles.inputLabel}>Subscriptions</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Marrow, PrepLadder"
              placeholderTextColor="#9CA3AF"
              value={profile.subscriptions}
              onChangeText={(text) => setProfile({...profile, subscriptions: text})}
            />

            <TouchableOpacity 
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmitProfile}
              disabled={isSubmitting}
            >
              <Check color="#FFFFFF" size={20} />
              <Text style={styles.submitButtonText}>
                {isSubmitting ? 'Saving...' : 'Complete Profile'}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
  },
  logoutButton: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    padding: 10,
  },
  content: {
    flex: 1,
    padding: 20,
    gap: 20,
  },
  card: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2563EB',
    marginBottom: 10,
  },
  cardText: {
    fontSize: 16,
    color: '#000000',
    marginBottom: 5,
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FEF2F2',
  },
  urgentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  urgentText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#DC2626',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563EB',
    marginTop: 20,
    marginBottom: 15,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#000000',
    marginBottom: 15,
  },
  batchTypeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 15,
  },
  batchTypeButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  batchTypeButtonActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  batchTypeText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
  },
  batchTypeTextActive: {
    color: '#FFFFFF',
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: '#10B981',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 10,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});