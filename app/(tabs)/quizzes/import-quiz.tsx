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
  StatusBar,
  Modal,
  FlatList
} from 'react-native';
import { useRouter } from 'expo-router';
import { 
  ChevronLeft, 
  Upload, 
  FileText,
  Check,
  AlertCircle,
  Image as ImageIcon,
  X
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { api, normalizeApiError } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import DateTimePicker from '@react-native-community/datetimepicker';

interface Subject {
  _id: string;
  name: string;
}

interface PreviewQuestion {
  _id: string;
  question: string;
  hasQuestionImage: boolean;
  hasOptionImages: boolean;
  status: 'created' | 'updated' | 'skipped';
}

interface ImportStats {
  total: number;
  questionsCreated: number;
  duplicatesSkipped: number;
  duplicatesUpdated: number;
  questionsWithImages: number;
}

interface QuizSection {
  name: string;
  duration: number;
  selectionType: 'mixed' | 'manual';
}

export default function ImportQuiz() {
  const { user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  
  // Form State
  const [title, setTitle] = useState('');
  const [testType, setTestType] = useState('daily');
  const [duration, setDuration] = useState('30');
  const [positiveMarks, setPositiveMarks] = useState('4');
  const [negativeMarks, setNegativeMarks] = useState('1');
  const [subjectId, setSubjectId] = useState('');
  const [file, setFile] = useState<any>(null);
  const [quizSections, setQuizSections] = useState<QuizSection[]>([]);

  // Time Window
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [tempDate, setTempDate] = useState<Date>(new Date());
  
  // Preview Modal State
  const [showPreview, setShowPreview] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<PreviewQuestion[]>([]);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);

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

  const initializeSections = (count: number) => {
    const totalDuration = parseInt(duration, 10) || 0;
    const equalTime = count > 0 ? Math.floor(totalDuration / count) : 0;
    const nextSections: QuizSection[] = [];

    for (let i = 0; i < count; i++) {
      nextSections.push({
        name: `Section ${i + 1}`,
        duration: i === count - 1 ? totalDuration - (equalTime * (count - 1)) : equalTime,
        selectionType: 'mixed'
      });
    }

    setQuizSections(nextSections);
  };

  const updateSection = (index: number, updates: Partial<QuizSection>) => {
    setQuizSections(prev =>
      prev.map((section, i) => (i === index ? { ...section, ...updates } : section))
    );
  };

  const addSection = () => {
    const nextIndex = quizSections.length + 1;
    setQuizSections(prev => [
      ...prev,
      { name: `Section ${nextIndex}`, duration: 0, selectionType: 'mixed' }
    ]);
  };

  const removeSection = (index: number) => {
    setQuizSections(prev => prev.filter((_, i) => i !== index));
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
    if (scheduledDate && expiryDate && expiryDate <= scheduledDate) {
      Alert.alert('Error', 'End date must be after start date');
      return;
    }

    const totalDuration = parseInt(duration, 10) || 0;
    if (totalDuration <= 0) {
      Alert.alert('Error', 'Duration must be greater than 0');
      return;
    }

    let sectionPayload: Array<{ name: string; duration: number; selectionType: 'mixed' }> = [];
    if (quizSections.length > 0) {
      sectionPayload = quizSections.map(section => ({
        name: section.name.trim(),
        duration: Number(section.duration) || 0,
        selectionType: 'mixed'
      }));

      const invalidSection = sectionPayload.find(section => !section.name || section.duration <= 0);
      if (invalidSection) {
        Alert.alert('Error', 'Each section must have a valid name and duration');
        return;
      }

      const allocated = sectionPayload.reduce((sum, section) => sum + section.duration, 0);
      if (allocated !== totalDuration) {
        Alert.alert(
          'Error',
          `Section duration total (${allocated} mins) must match quiz duration (${totalDuration} mins)`
        );
        return;
      }
    }

    setLoading(true);
    setProgressMessage('Uploading file and processing images...');
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
      formData.append('positiveMarks', positiveMarks);
      formData.append('negativeMarks', negativeMarks);
      if (subjectId) {
        formData.append('subjectId', subjectId);
      }
      if (scheduledDate) {
        formData.append('scheduledDate', scheduledDate.toISOString());
      }
      if (expiryDate) {
        formData.append('expiryDate', expiryDate.toISOString());
      }
      if (sectionPayload.length > 0) {
        formData.append('sections', JSON.stringify(sectionPayload));
      }
      // Instructions can be added if needed, defaulted by backend for now

      setProgressMessage('Processing questions and uploading images to cloud...\nThis may take a few minutes.');
      const response = await api.post('/quizzes/import-excel', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000, // 5 minutes timeout for image uploads
      });

      // Show preview modal with stats
      setImportStats(response.data.stats);
      setPreviewQuestions(response.data.previewQuestions || []);
      setShowPreview(true);
    } catch (error: unknown) {
      const normalized = normalizeApiError(error);
      const axiosData = (error as { response?: { data?: { code?: string; errors?: string[] } } })?.response?.data;
      const validationErrors = axiosData?.errors;
      const isImportValidation = axiosData?.code === 'IMPORT_VALIDATION_ERROR' || normalized.code === 'VALIDATION_ERROR';

      if (isImportValidation && validationErrors?.length) {
        const formatted = validationErrors
          .map((entry) => entry.replace(/^Row (\d+): /, 'Row $1\n• '))
          .join('\n\n');
        Alert.alert('Excel validation failed', formatted);
      } else {
        Alert.alert('Import Failed', normalized.userMessage);
      }

      if (!isImportValidation) {
        console.error('Import error:', normalized.code, normalized.userMessage);
      }
    } finally {
      setLoading(false);
      setProgressMessage('');
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

          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.label}>Positive Marks</Text>
              <TextInput
                style={styles.input}
                value={positiveMarks}
                onChangeText={setPositiveMarks}
                keyboardType="numeric"
                placeholder="4"
              />
            </View>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.label}>Negative Marks</Text>
              <TextInput
                style={styles.input}
                value={negativeMarks}
                onChangeText={setNegativeMarks}
                keyboardType="numeric"
                placeholder="1"
              />
            </View>
          </View>

          <Text style={styles.label}>Sections (Optional)</Text>
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Total Duration: {parseInt(duration, 10) || 0} mins | Allocated: {quizSections.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)} mins
            </Text>
            <Text style={styles.infoHint}>
              Imported questions are auto-distributed across sections when you set sections.
            </Text>
          </View>

          <View style={styles.quickCountRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <TouchableOpacity
                key={n}
                style={[styles.smallChip, quizSections.length === n && styles.smallChipActive]}
                onPress={() => initializeSections(n)}
              >
                <Text style={[styles.smallChipText, quizSections.length === n && styles.smallChipTextActive]}>
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.addSectionButton} onPress={addSection}>
              <Text style={styles.addSectionButtonText}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {quizSections.map((section, idx) => (
            <View key={`${section.name}-${idx}`} style={styles.sectionConfigCard}>
              <View style={styles.sectionRow}>
                <TextInput
                  style={[styles.input, { flex: 2, marginRight: 8 }]}
                  value={section.name}
                  onChangeText={(val) => updateSection(idx, { name: val })}
                  placeholder="Section Name"
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={String(section.duration || '')}
                  onChangeText={(val) => updateSection(idx, { duration: parseInt(val, 10) || 0 })}
                  keyboardType="numeric"
                  placeholder="Mins"
                />
                <TouchableOpacity style={styles.sectionDeleteButton} onPress={() => removeSection(idx)}>
                  <X color="#EF4444" size={16} />
                </TouchableOpacity>
              </View>
            </View>
          ))}

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

          {/* Time Window */}
          <Text style={styles.label}>Start Date & Time (Optional)</Text>
          <TouchableOpacity
            style={styles.datePickerButton}
            onPress={() => {
              setTempDate(scheduledDate || new Date());
              setPickerMode('date');
              setShowStartPicker(true);
            }}
          >
            <Text style={[styles.datePickerText, !scheduledDate && { color: '#9CA3AF' }]}>
              {scheduledDate ? scheduledDate.toLocaleString() : 'Select start date & time'}
            </Text>
          </TouchableOpacity>
          {showStartPicker && (
            <DateTimePicker
              value={tempDate}
              mode={pickerMode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event: any, selected?: Date) => {
                if (event.type === 'dismissed') {
                  setShowStartPicker(false);
                  return;
                }
                if (selected) {
                  if (pickerMode === 'date') {
                    setTempDate(selected);
                    setPickerMode('time');
                  } else {
                    setScheduledDate(selected);
                    setShowStartPicker(false);
                    setPickerMode('date');
                  }
                }
              }}
            />
          )}

          <Text style={styles.label}>End Date & Time (Optional)</Text>
          <TouchableOpacity
            style={styles.datePickerButton}
            onPress={() => {
              setTempDate(expiryDate || new Date());
              setPickerMode('date');
              setShowEndPicker(true);
            }}
          >
            <Text style={[styles.datePickerText, !expiryDate && { color: '#9CA3AF' }]}>
              {expiryDate ? expiryDate.toLocaleString() : 'Select end date & time'}
            </Text>
          </TouchableOpacity>
          {showEndPicker && (
            <DateTimePicker
              value={tempDate}
              mode={pickerMode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event: any, selected?: Date) => {
                if (event.type === 'dismissed') {
                  setShowEndPicker(false);
                  return;
                }
                if (selected) {
                  if (pickerMode === 'date') {
                    setTempDate(selected);
                    setPickerMode('time');
                  } else {
                    setExpiryDate(selected);
                    setShowEndPicker(false);
                    setPickerMode('date');
                  }
                }
              }}
            />
          )}

          {scheduledDate && expiryDate && expiryDate <= scheduledDate && (
            <Text style={{ color: '#EF4444', fontSize: 12, marginBottom: 8 }}>
              ⚠️ End date must be after start date
            </Text>
          )}

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
            style={[styles.importButton, loading && styles.importingButton, (!file || loading) && styles.disabledButton]}
            onPress={handleImport}
            disabled={!file || loading}
          >
            {loading ? (
              <View style={{ alignItems: 'center' }}>
                <ActivityIndicator color="#FFF" />
                <Text style={styles.progressText}>{progressMessage}</Text>
              </View>
            ) : (
              <Text style={styles.importButtonText}>Upload & Create Quiz</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Preview Modal */}
      <Modal visible={showPreview} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Import Complete</Text>
            <TouchableOpacity onPress={() => { setShowPreview(false); router.back(); }}>
              <X color="#6B7280" size={24} />
            </TouchableOpacity>
          </View>

          {importStats && (
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{importStats.total}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: '#D1FAE5' }]}>
                <Text style={[styles.statValue, { color: '#059669' }]}>{importStats.questionsCreated}</Text>
                <Text style={styles.statLabel}>Created</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: '#FEF3C7' }]}>
                <Text style={[styles.statValue, { color: '#D97706' }]}>{importStats.duplicatesUpdated}</Text>
                <Text style={styles.statLabel}>Updated</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: '#F3E8FF' }]}>
                <Text style={[styles.statValue, { color: '#9333EA' }]}>{importStats.duplicatesSkipped}</Text>
                <Text style={styles.statLabel}>Reused</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: '#DBEAFE' }]}>
                <Text style={[styles.statValue, { color: '#2563EB' }]}>{importStats.questionsWithImages}</Text>
                <Text style={styles.statLabel}>With Images</Text>
              </View>
            </View>
          )}

          <FlatList
            data={previewQuestions}
            keyExtractor={item => item._id}
            style={styles.previewList}
            renderItem={({ item, index }) => (
              <View style={[
                styles.previewItem,
                item.status === 'created' && { borderLeftColor: '#10B981' },
                item.status === 'updated' && { borderLeftColor: '#F59E0B' },
                item.status === 'skipped' && { borderLeftColor: '#9333EA' }
              ]}>
                <View style={styles.previewContent}>
                  <Text style={styles.previewNumber}>Q{index + 1}</Text>
                  <Text style={styles.previewText} numberOfLines={2}>{item.question}</Text>
                </View>
                <View style={styles.previewMeta}>
                  {item.hasQuestionImage && <ImageIcon size={16} color="#2563EB" />}
                  {item.hasOptionImages && <ImageIcon size={14} color="#6B7280" />}
                  <Text style={[
                    styles.statusBadge,
                    item.status === 'created' && styles.statusCreated,
                    item.status === 'updated' && styles.statusUpdated,
                    item.status === 'skipped' && styles.statusSkipped
                  ]}>{item.status === 'skipped' ? 'REUSED' : item.status}</Text>
                </View>
              </View>
            )}
          />

          <TouchableOpacity 
            style={styles.doneButton}
            onPress={() => { setShowPreview(false); router.back(); }}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
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
  infoBox: {
    backgroundColor: '#EBF5FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  infoText: {
    fontSize: 13,
    color: '#1E40AF',
    fontWeight: '600',
  },
  infoHint: {
    marginTop: 4,
    fontSize: 12,
    color: '#1E40AF',
  },
  quickCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  smallChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  smallChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  smallChipText: {
    fontSize: 12,
    color: '#4B5563',
  },
  smallChipTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  addSectionButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    marginLeft: 'auto',
  },
  addSectionButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionConfigCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 10,
    marginBottom: 8,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionDeleteButton: {
    marginLeft: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
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
  // Preview Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#2563EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8,
    backgroundColor: '#FFF',
  },
  statBox: {
    flex: 1,
    minWidth: 80,
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  previewList: {
    flex: 1,
    padding: 12,
  },
  previewItem: {
    backgroundColor: '#FFF',
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#E5E7EB',
  },
  previewContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  previewNumber: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2563EB',
  },
  previewText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
  },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    justifyContent: 'flex-end',
  },
  statusBadge: {
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  statusCreated: {
    backgroundColor: '#D1FAE5',
    color: '#059669',
  },
  statusUpdated: {
    backgroundColor: '#FEF3C7',
    color: '#D97706',
  },
  statusSkipped: {
    backgroundColor: '#F3E8FF',
    color: '#9333EA',
  },
  doneButton: {
    backgroundColor: '#2563EB',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  importingButton: {
    minHeight: 80,
    paddingVertical: 16,
  },
  progressText: {
    color: '#FFF',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  datePickerText: {
    fontSize: 15,
    color: '#1F2937',
    flex: 1,
  },
});
