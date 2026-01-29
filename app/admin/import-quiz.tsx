import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  StatusBar
} from 'react-native';
import { useRouter } from 'expo-router';
import { 
  ChevronLeft, 
  Upload, 
  FileText,
  Check,
  AlertCircle
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';

interface Subject {
  _id: string;
  name: string;
}

export default function ImportQuiz() {
  const { user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  
  // Form State
  const [title, setTitle] = useState('');
  const [testType, setTestType] = useState('daily');
  const [duration, setDuration] = useState('30');
  const [subjectId, setSubjectId] = useState('');
  const [file, setFile] = useState<any>(null);

  useEffect(() => {
    fetchSubjects();
  }, []);

  const fetchSubjects = async () => {
    try {
      const response = await api.get('/subjects/list');
      setSubjects(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching subjects:', error);
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true
      });

      if (result.canceled) return;
      
      const asset = result.assets[0];
      setFile(asset);
      setTitle(asset.name.replace('.xlsx', '').replace('.xls', '')); // Auto-fill title
    } catch (error) {
      console.error('Error picking file:', error);
      Alert.alert('Error', 'Failed to pick file');
    }
  };

  const handleImport = async () => {
    if (!file) {
      Alert.alert('Error', 'Please select an Excel file');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a quiz title');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      } as any);

      formData.append('quizTitle', title);
      formData.append('testType', testType);
      formData.append('duration', duration);
      if (subjectId) {
        formData.append('subjectId', subjectId);
      }
      // Instructions can be added if needed, defaulted by backend for now

      const response = await api.post('/quizzes/import-excel', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      Alert.alert(
        'Success',
        `Quiz imported successfully with ${response.data.questionsCreated} questions!`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error: any) {
      console.error('Import error:', error);
      const msg = error.response?.data?.message || 'Failed to import quiz';
      const details = error.response?.data?.errors?.join('\n') || '';
      Alert.alert('Import Failed', `${msg}\n${details}`);
    } finally {
      setLoading(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Import Quiz</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>1. Upload Guidelines</Text>
          <View style={styles.guidelinesBox}>
            <Text style={styles.guidelineText}>• File must be .xlsx or .xls</Text>
            <Text style={styles.guidelineText}>• Required columns: SUBJECT, QUESTION, OPTION1, OPTION2, CORRECT</Text>
            <Text style={styles.guidelineText}>• CORRECT should be 1, 2, 3, 4 or A, B, C, D</Text>
          </View>

          <Text style={styles.sectionTitle}>2. Quiz Details</Text>
          
          <Text style={styles.label}>Quiz Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Enter quiz title"
          />

          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.label}>Type</Text>
              <View style={styles.typeContainer}>
                {['daily', 'weekly', 'grand'].map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, testType === t && styles.typeChipActive]}
                    onPress={() => setTestType(t)}
                  >
                    <Text style={[styles.typeText, testType === t && styles.typeTextActive]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.label}>Duration (mins)</Text>
              <TextInput
                style={styles.input}
                value={duration}
                onChangeText={setDuration}
                keyboardType="numeric"
                placeholder="30"
              />
            </View>
          </View>

          <Text style={styles.label}>Primary Subject (Optional)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subjectScroll}>
            <TouchableOpacity
              style={[styles.subjectChip, !subjectId && styles.subjectChipActive]}
              onPress={() => setSubjectId('')}
            >
              <Text style={[styles.subjectText, !subjectId && styles.subjectTextActive]}>Mixed / Auto</Text>
            </TouchableOpacity>
            {subjects.map(sub => (
              <TouchableOpacity
                key={sub._id}
                style={[styles.subjectChip, subjectId === sub._id && styles.subjectChipActive]}
                onPress={() => setSubjectId(sub._id)}
              >
                <Text style={[styles.subjectText, subjectId === sub._id && styles.subjectTextActive]}>
                  {sub.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.sectionTitle}>3. Select File</Text>
          <TouchableOpacity style={styles.uploadBox} onPress={pickFile}>
            {file ? (
              <View style={styles.fileInfo}>
                <FileText color="#2563EB" size={32} />
                <Text style={styles.fileName}>{file.name}</Text>
                <Text style={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</Text>
                <TouchableOpacity onPress={() => setFile(null)} style={styles.removeBtn}>
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.uploadPlaceholder}>
                <Upload color="#9CA3AF" size={32} />
                <Text style={styles.uploadText}>Tap to select Excel file</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.importButton, (!file || loading) && styles.disabledButton]}
            onPress={handleImport}
            disabled={!file || loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.importButtonText}>Upload & Create Quiz</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#2563EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 16,
    marginBottom: 12,
  },
  guidelinesBox: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  guidelineText: {
    fontSize: 13,
    color: '#4B5563',
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  typeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  typeChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  typeText: {
    fontSize: 12,
    color: '#6B7280',
  },
  typeTextActive: {
    color: '#2563EB',
    fontWeight: '600',
  },
  subjectScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  subjectChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  subjectChipActive: {
    backgroundColor: '#2563EB',
  },
  subjectText: {
    fontSize: 13,
    color: '#4B5563',
  },
  subjectTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  uploadBox: {
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    marginTop: 8,
    marginBottom: 24,
  },
  uploadPlaceholder: {
    alignItems: 'center',
    gap: 8,
  },
  uploadText: {
    color: '#6B7280',
    fontSize: 15,
  },
  fileInfo: {
    alignItems: 'center',
    gap: 4,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    textAlign: 'center',
  },
  fileSize: {
    fontSize: 13,
    color: '#6B7280',
  },
  removeBtn: {
    marginTop: 8,
    padding: 4,
  },
  removeText: {
    color: '#EF4444',
    fontSize: 13,
  },
  importButton: {
    backgroundColor: '#2563EB',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#93C5FD',
  },
  importButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
  },
});
