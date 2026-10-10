import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
  Switch,
} from 'react-native';
import { ScreenContainer, FullScreenContainer } from '@/components/layout';
import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  Upload,
  FileText,
  Check,
  AlertCircle,
  Image as ImageIcon,
  Share2,
  X
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '@/utils/theme';
import { api, normalizeApiError } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import ShareQuizModal, { ShareQuizTarget } from '@/components/ShareQuizModal';
import ImageUploadSummaryModal, { ImageImportSummary } from '@/components/ImageUploadSummaryModal';
import { DateTimeField } from '@/components/DateTimeField';

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
  const [lockSectionsAfterSubmission, setLockSectionsAfterSubmission] = useState(true);
  const [subjectId, setSubjectId] = useState('');
  const [file, setFile] = useState<any>(null);
  const [quizSections, setQuizSections] = useState<QuizSection[]>([]);

  // Time Window
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);

  // Preview Modal State
  const [showPreview, setShowPreview] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<PreviewQuestion[]>([]);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);

  // Post-import Share Quiz popup (same sheet as Past Tests)
  const [createdQuiz, setCreatedQuiz] = useState<ShareQuizTarget | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);

  // Image Upload Summary popup (stacks on the Import Complete modal). Only
  // opened when the imported file actually carried images.
  const [imageSummary, setImageSummary] = useState<ImageImportSummary | null>(null);
  const [imageSummaryVisible, setImageSummaryVisible] = useState(false);

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

  // Leaves the Import Complete screen entirely (and clears the share target).
  const finishImport = () => {
    setShareModalVisible(false);
    setCreatedQuiz(null);
    setImageSummaryVisible(false);
    setImageSummary(null);
    setShowPreview(false);
    router.back();
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
      // Section locking travels as a string (multer form field); backend
      // coerces and defaults missing to ON.
      formData.append('lockSectionsAfterSubmission', String(lockSectionsAfterSubmission));
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
      setShareModalVisible(false);

      // Image summary popup (question/solution image outcomes) — only when
      // the file carried images; a no-image file never opens it.
      const summary: ImageImportSummary | undefined = response.data.imageSummary;
      setImageSummary(summary || null);
      setImageSummaryVisible(!!summary && Number(summary.total) > 0);

      // Keep the freshly imported quiz around so the Import Complete screen
      // can offer the Share Quiz sheet (internal students / public link).
      const importedQuiz = response.data?.quiz;
      setCreatedQuiz(
        importedQuiz?._id && importedQuiz.title
          ? {
              _id: importedQuiz._id,
              title: importedQuiz.title,
              assignedStudents: Array.isArray(importedQuiz.assignedStudents)
                ? importedQuiz.assignedStudents
                    .map((s: any) => (typeof s === 'string' ? s : s?._id))
                    .filter(Boolean)
                : [],
            }
          : null
      );
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
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Admin access required</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container}>
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
            <View style={styles.guideBlock}>
              <Text style={styles.guideHeading}>File</Text>
              <Text style={styles.guideBody}>.xlsx or .xls · one question per row · headers in row 1</Text>
            </View>

            <View style={styles.guideBlock}>
              <Text style={styles.guideHeading}>Required every row</Text>
              <View style={styles.chipWrap}>
                {['SUBJECT', 'TOPIC', 'SUBTOPIC', 'SYSTEM', 'QUESTION_TYPE', 'DIFFICULTY', 'QUESTION', 'CORRECT'].map((col) => (
                  <View key={col} style={styles.requiredChip}>
                    <Text style={styles.requiredChipText}>{col}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.guideHint}>SUBJECT must match an existing subject. DIFFICULTY: Easy, Medium, or Hard.</Text>
            </View>

            <View style={styles.guideBlock}>
              <Text style={styles.guideHeading}>Also required by type</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>MCQ / Image / Multiple</Text>  OPTION1, OPTION2 (at least 2 options)</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>Assertion & Reason</Text>  ASSERTION, REASON</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>Match the Following</Text>  COLUMN_A, COLUMN_B</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>Image-based</Text>  Q_IMAGE</Text>
            </View>

            <View style={styles.guideBlock}>
              <Text style={styles.guideHeading}>Optional</Text>
              <View style={styles.chipWrap}>
                {['TAGS', 'SOLUTION', 'OPTION3–6', 'Q_IMAGE', 'QID'].map((col) => (
                  <View key={col} style={styles.optionalChip}>
                    <Text style={styles.optionalChipText}>{col}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.guideBlock}>
              <Text style={styles.guideHeading}>Question types</Text>
              <Text style={styles.guideHint}>Use the id, or a close label. A few accepted examples:</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>mcq_single</Text>  mcq · mcq-single correct · MCQ-Single Correct</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>assertion_reason</Text>  Assertion & Reason · Assertions/Reason · Assertion and Reasoning</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>match_the_following</Text>  Match the Following</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>image_based</Text>  Image-Based</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>multiple_correct</Text>  Multiple Correct</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>numerical</Text>  Numeric</Text>
            </View>

            <View style={styles.guideBlock}>
              <Text style={styles.guideHeading}>CORRECT</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>MCQ / Image</Text>  1–6 or A–F</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>Multiple</Text>  1,3 or A,C</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>Match</Text>  1-C,2-A,3-D,4-B</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>Numerical</Text>  a number, e.g. 12.5</Text>
              <Text style={styles.guideLine}><Text style={styles.guideKey}>Assertion</Text>  1–4 (or A–D if you include options)</Text>
            </View>

            <View style={styles.guideBlock}>
              <Text style={styles.guideHeading}>Example (MCQ)</Text>
              {[
                ['SUBJECT', 'ANATOMY'],
                ['TOPIC', 'Upper Limb'],
                ['SUBTOPIC', 'Nerves'],
                ['SYSTEM', 'Musculoskeletal'],
                ['QUESTION_TYPE', 'mcq_single'],
                ['DIFFICULTY', 'Medium'],
                ['QUESTION', 'Which nerve supplies…'],
                ['OPTION1', 'Median nerve'],
                ['OPTION2', 'Ulnar nerve'],
                ['CORRECT', '1'],
                ['TAGS', 'nerve, upper limb'],
              ].map(([col, ex]) => (
                <View key={col} style={styles.exampleRow}>
                  <Text style={styles.exampleCol}>{col}</Text>
                  <Text style={styles.exampleVal}>{ex}</Text>
                </View>
              ))}
            </View>

            <View style={styles.guideCallout}>
              <View style={{ marginTop: 1 }}>
                <AlertCircle color={colors.primaryDark} size={16} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.guideCalloutTitle}>TOPIC and TAGS</Text>
                <Text style={styles.guideCalloutText}>
                  TOPIC is required — the topic this question belongs to.{'\n'}
                  TAGS are optional keywords for filtering and grouping questions. Accurate tags are strongly recommended.
                </Text>
              </View>
            </View>
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

          {/* Lock Sections After Submission Toggle */}
          <View style={styles.toggleContainer}>
            <View style={styles.toggleLabelContainer}>
              <Text style={styles.toggleLabel}>Lock Sections After Submission</Text>
              <Text style={styles.toggleHelperText}>
                Students complete sections in order, each with its own timer. Once a section is submitted (or its time ends), they cannot return to it. Applies only when sections are configured.
              </Text>
            </View>
            <Switch
              value={lockSectionsAfterSubmission}
              onValueChange={setLockSectionsAfterSubmission}
              trackColor={{ false: '#D1D5DB', true: colors.primary }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#D1D5DB"
            />
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
          <DateTimeField
            label="Start Date & Time (Optional)"
            value={scheduledDate}
            placeholder="Select start date & time"
            onCommit={setScheduledDate}
          />

          <DateTimeField
            label="End Date & Time (Optional)"
            value={expiryDate}
            placeholder="Select end date & time"
            onCommit={setExpiryDate}
          />

          {scheduledDate && expiryDate && expiryDate <= scheduledDate && (
            <Text style={{ color: colors.danger, fontSize: 12, marginBottom: 8 }}>
              ⚠️ End date must be after start date
            </Text>
          )}

          <Text style={styles.sectionTitle}>3. Select File</Text>
          <TouchableOpacity style={styles.uploadBox} onPress={pickFile}>
            {file ? (
              <View style={styles.fileInfo}>
                <FileText color={colors.primary} size={32} />
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
            style={[styles.importButton, !file && styles.disabledButton, loading && styles.importingButton]}
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
        <FullScreenContainer style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Import Complete</Text>
            <TouchableOpacity onPress={finishImport}>
              <X color="#6B7280" size={24} />
            </TouchableOpacity>
          </View>

          {importStats && (
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{importStats.total}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: colors.successTint }]}>
                <Text style={[styles.statValue, { color: colors.successDark }]}>{importStats.questionsCreated}</Text>
                <Text style={styles.statLabel}>Created</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: colors.warningTint }]}>
                <Text style={[styles.statValue, { color: colors.warningDark }]}>{importStats.duplicatesUpdated}</Text>
                <Text style={styles.statLabel}>Updated</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: colors.purpleTint }]}>
                <Text style={[styles.statValue, { color: colors.purple }]}>{importStats.duplicatesSkipped}</Text>
                <Text style={styles.statLabel}>Reused</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: colors.primaryTint }]}>
                <Text style={[styles.statValue, { color: colors.primaryDark }]}>{importStats.questionsWithImages}</Text>
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
                item.status === 'created' && { borderLeftColor: colors.success },
                item.status === 'updated' && { borderLeftColor: colors.warning },
                item.status === 'skipped' && { borderLeftColor: colors.purple }
              ]}>
                <View style={styles.previewContent}>
                  <Text style={styles.previewNumber}>Q{index + 1}</Text>
                  <Text style={styles.previewText} numberOfLines={2}>{item.question}</Text>
                </View>
                <View style={styles.previewMeta}>
                  {item.hasQuestionImage && <ImageIcon size={16} color={colors.primary} />}
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

          <View style={styles.previewActions}>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={finishImport}
              disabled={shareModalVisible}
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareButton, !createdQuiz && styles.shareButtonDisabled]}
              onPress={() => setShareModalVisible(true)}
              disabled={!createdQuiz || shareModalVisible}
            >
              <Share2 size={18} color="#FFF" />
              <Text style={styles.shareButtonText}>Share Quiz</Text>
            </TouchableOpacity>
          </View>

          {/* Share sheet is nested INSIDE this Modal's tree so it stacks on
              top of the Import Complete modal on iOS. */}
          <ShareQuizModal
            visible={shareModalVisible}
            quiz={createdQuiz}
            onClose={() => setShareModalVisible(false)}
          />

          {/* Image summary popup stacks on the Import Complete modal the same
              way; dismissing it falls back to the Import Complete screen. */}
          <ImageUploadSummaryModal
            visible={imageSummaryVisible}
            summary={imageSummary}
            onClose={() => setImageSummaryVisible(false)}
          />
        </FullScreenContainer>
      </Modal>
    </ScreenContainer>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.primary,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 16,
    marginBottom: 12,
  },
  guidelinesBox: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  guideBlock: {
    gap: 4,
  },
  guideHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  guideBody: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 17,
  },
  guideHint: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 15,
    marginTop: 2,
  },
  guideLine: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 18,
  },
  guideKey: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  requiredChip: {
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  requiredChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  optionalChip: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  optionalChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4B5563',
  },
  exampleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 2,
    gap: 8,
  },
  exampleCol: {
    width: 108,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  exampleVal: {
    flex: 1,
    fontSize: 11,
    color: '#4B5563',
  },
  guideCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
    borderRadius: 8,
    padding: 10,
  },
  guideCalloutTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
    marginBottom: 2,
  },
  guideCalloutText: {
    fontSize: 12,
    color: colors.primaryText,
    lineHeight: 17,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Toggle styles (same pattern as create-quiz.tsx)
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  toggleLabelContainer: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  toggleHelperText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  infoBox: {
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryTintBorder,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  infoText: {
    fontSize: 13,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  infoHint: {
    marginTop: 4,
    fontSize: 12,
    color: colors.primaryText,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  smallChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
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
    backgroundColor: colors.primary,
    marginLeft: 'auto',
  },
  addSectionButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionConfigCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.dangerTint,
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
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  typeTextActive: {
    color: '#FFF',
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
    backgroundColor: colors.bg,
    marginRight: 8,
  },
  subjectChipActive: {
    backgroundColor: colors.primary,
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
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    marginTop: 8,
    marginBottom: 24,
  },
  uploadPlaceholder: {
    alignItems: 'center',
    gap: 8,
  },
  uploadText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  fileInfo: {
    alignItems: 'center',
    gap: 4,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  fileSize: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  removeBtn: {
    marginTop: 8,
    padding: 4,
  },
  removeText: {
    color: colors.danger,
    fontSize: 13,
  },
  importButton: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  importButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
  },
  // Preview Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.primary,
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
    backgroundColor: colors.surface,
  },
  statBox: {
    flex: 1,
    minWidth: 80,
    backgroundColor: colors.bg,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  previewList: {
    flex: 1,
    padding: 12,
  },
  previewItem: {
    backgroundColor: colors.surface,
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.border,
  },
  previewContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  previewNumber: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.primary,
  },
  previewText: {
    flex: 1,
    fontSize: 13,
    color: colors.textBody,
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
    backgroundColor: colors.successTint,
    color: colors.successDark,
  },
  statusUpdated: {
    backgroundColor: colors.warningTint,
    color: colors.warningDark,
  },
  statusSkipped: {
    backgroundColor: colors.purpleTint,
    color: colors.purple,
  },
  // Import Complete footer: Done (secondary) + Share Quiz (primary)
  previewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  doneButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  doneButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  shareButton: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  shareButtonDisabled: {
    opacity: 0.5,
  },
  shareButtonText: {
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
});
