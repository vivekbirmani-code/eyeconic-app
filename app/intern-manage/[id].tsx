import React, { useCallback, useMemo, useState } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  GraduationCap,
  Plus,
  X,
  Save,
  Clock,
  CheckCircle,
  ListChecks,
  Trophy,
} from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { useAuth } from '@/context/AuthContext';
import UserAvatar from '@/components/UserAvatar';
import { formatMinutes } from '@/components/intern/InternTimeSlicer';
import {
  getInternConfig,
  getInternCatalogSummary,
  saveInternConfig,
  type InternConfigResponse,
  type CatalogSourceSummary,
} from '@/services/intern';

/**
 * Intern Mode management (mentor/admin). Opened from the mentor's My Students
 * cards and the admin's User Details. One screen for both roles:
 *  - the intern toggle, and when ON
 *  - the study scope builder: one or more video sources, EACH with its own
 *    subject list (all subjects preselected when a source is added), and
 *  - the student's progress: today's slicer choice, watched/pending videos.
 */

interface ScopeDraft {
  sourceKey: string;
  source: string;
  subjects: string[];
}

function InternManageScreen() {
  const { id: studentId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [config, setConfig] = useState<InternConfigResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogSourceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Draft scope while the toggle is on (or being turned on).
  const [draft, setDraft] = useState<ScopeDraft[] | null>(null);
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const allowed = user?.role === 'mentor' || user?.role === 'admin';

  const load = useCallback(async () => {
    if (!studentId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [cfg, sources] = await Promise.all([
        getInternConfig(studentId),
        getInternCatalogSummary(),
      ]);
      setConfig(cfg);
      setCatalog(sources);
      setDraft(
        cfg.scope.map((s) => ({ sourceKey: s.sourceKey, source: s.source, subjects: [...s.subjects] }))
      );
    } catch (error: any) {
      setLoadError(error?.response?.data?.message || 'Failed to load intern settings');
    } finally {
      setIsLoading(false);
    }
  }, [studentId]);

  useFocusEffect(
    useCallback(() => {
      if (allowed) load();
    }, [allowed, load])
  );

  const draftKey = useMemo(
    () => JSON.stringify(draft ?? []),
    [draft]
  );
  const savedKey = useMemo(
    () =>
      JSON.stringify(
        (config?.scope || []).map((s) => ({
          sourceKey: s.sourceKey,
          source: s.source,
          subjects: [...s.subjects].sort(),
        }))
      ),
    [config]
  );
  const canSave =
    !!draft &&
    draft.length > 0 &&
    draft.every((d) => d.subjects.length > 0) &&
    draftKey !== savedKey;

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Access Denied - Mentors and Admins Only</Text>
      </View>
    );
  }

  if (isLoading && !config) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#01b4ae" />
        <Text style={styles.loadingText}>Loading intern settings...</Text>
      </View>
    );
  }

  if (loadError || !config) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{loadError || 'Student not found'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const catalogByKey = new Map(catalog.map((s) => [s.sourceKey, s]));
  const addedKeys = new Set((draft || []).map((d) => d.sourceKey));
  const remainingSources = catalog.filter((s) => !addedKeys.has(s.sourceKey));

  const addSource = (source: CatalogSourceSummary) => {
    if (!draft) return;
    // Boss-confirmed default: every subject of the source is preselected;
    // the mentor deselects what this intern will not study.
    setDraft([
      ...draft,
      { sourceKey: source.sourceKey, source: source.source, subjects: source.subjects.map((s) => s.subject) },
    ]);
    setIsPickerVisible(false);
    Haptics.selectionAsync();
  };

  const toggleSubject = (sourceKey: string, subject: string) => {
    setDraft((prev) =>
      (prev || []).map((d) =>
        d.sourceKey === sourceKey
          ? {
              ...d,
              subjects: d.subjects.includes(subject)
                ? d.subjects.filter((s) => s !== subject)
                : [...d.subjects, subject],
            }
          : d
      )
    );
    Haptics.selectionAsync();
  };

  const saveScope = async () => {
    if (!draft) return;
    if (draft.length === 0 || draft.some((d) => d.subjects.length === 0)) {
      Alert.alert(
        'Incomplete scope',
        'Pick at least one source, and keep at least one subject per source.'
      );
      return;
    }
    setIsSaving(true);
    try {
      await saveInternConfig(studentId, {
        isIntern: true,
        scope: draft.map((d) => ({ sourceKey: d.sourceKey, subjects: d.subjects })),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', error?.response?.data?.message || 'Failed to save intern settings');
    } finally {
      setIsSaving(false);
    }
  };

  const turnOff = () => {
    Alert.alert(
      'Turn off Intern Mode?',
      'The student will lose the time slicer and daily video plans. Their watched history and the saved scope are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn Off',
          style: 'destructive',
          onPress: async () => {
            setIsSaving(true);
            try {
              await saveInternConfig(studentId, { isIntern: false, scope: [] });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await load();
            } catch (error: any) {
              Alert.alert('Error', error?.response?.data?.message || 'Failed to update');
            } finally {
              setIsSaving(false);
            }
          },
        },
      ]
    );
  };

  const progress = config.progress;
  const totalDraftMinutes = (draft || []).reduce((sum, d) => {
    const src = catalogByKey.get(d.sourceKey);
    if (!src) return sum;
    return sum + src.subjects.filter((s) => d.subjects.includes(s.subject)).reduce((a, s) => a + s.minutes, 0);
  }, 0);
  const totalDraftVideos = (draft || []).reduce((sum, d) => {
    const src = catalogByKey.get(d.sourceKey);
    if (!src) return sum;
    return sum + src.subjects.filter((s) => d.subjects.includes(s.subject)).reduce((a, s) => a + s.videos, 0);
  }, 0);

  const renderToggleCard = () => (
    <View style={styles.card}>
      <View style={styles.toggleRow}>
        <View style={styles.cardIcon}>
          <GraduationCap color="#01b4ae" size={22} />
        </View>
        <View style={styles.toggleText}>
          <Text style={styles.cardTitle}>Intern Mode</Text>
          <Text style={styles.cardSubtitle}>
            {config.isIntern
              ? 'This student picks daily study time and gets videos to watch.'
              : 'Turn on to give this student the daily study time slicer.'}
          </Text>
        </View>
        <Switch
          value={config.isIntern || !!draft}
          onValueChange={(value) => {
            Haptics.selectionAsync();
            if (value) {
              // Turn on: show the builder (existing scope preloaded).
              setDraft(
                config.scope.length
                  ? config.scope.map((s) => ({ sourceKey: s.sourceKey, source: s.source, subjects: [...s.subjects] }))
                  : []
              );
            } else if (config.isIntern) {
              turnOff();
            } else {
              setDraft(null);
            }
          }}
          trackColor={{ false: '#E5E7EB', true: '#99F6E4' }}
          thumbColor={config.isIntern ? '#01b4ae' : '#FFFFFF'}
          disabled={isSaving}
        />
      </View>

      {(config.isIntern || draft !== null) && (
        <Text style={styles.draftSummary}>
          Selected playlist:{' '}
          <Text style={styles.draftSummaryBold}>
            {totalDraftVideos} videos • ~{Math.round(totalDraftMinutes / 60)}h
          </Text>
        </Text>
      )}
    </View>
  );

  const renderScopeBuilder = () => {
    if (!draft) return null;

    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Study Scope</Text>
        <Text style={styles.sectionHint}>
          Add each video source this student studies from, and keep the subjects they will study.
          All subjects are selected by default.
        </Text>

        {(draft as ScopeDraft[]).map((d) => {
          const src = catalogByKey.get(d.sourceKey);
          const srcVideos =
            src?.subjects
              .filter((s) => d.subjects.includes(s.subject))
              .reduce((a, s) => a + s.videos, 0) ?? 0;
          return (
            <View key={d.sourceKey} style={styles.sourceBlock}>
              <View style={styles.sourceHeader}>
                <Text style={styles.sourceName}>{d.source}</Text>
                <Text style={styles.sourceMeta}>{srcVideos} videos</Text>
                <TouchableOpacity
                  style={styles.removeSource}
                  onPress={() => {
                    setDraft(draft.filter((x) => x.sourceKey !== d.sourceKey));
                    Haptics.selectionAsync();
                  }}
                  accessibilityLabel={`Remove source ${d.source}`}
                >
                  <X color="#EF4444" size={18} />
                </TouchableOpacity>
              </View>
              <View style={styles.subjectChips}>
                {(src?.subjects || []).map((s) => {
                  const active = d.subjects.includes(s.subject);
                  return (
                    <TouchableOpacity
                      key={s.subject}
                      style={[styles.subjectChip, active && styles.subjectChipActive]}
                      onPress={() => toggleSubject(d.sourceKey, s.subject)}
                    >
                      <Text style={[styles.subjectChipText, active && styles.subjectChipTextActive]}>
                        {s.subject}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {d.subjects.length === 0 && (
                <Text style={styles.subjectsEmpty}>Keep at least one subject</Text>
              )}
            </View>
          );
        })}

        {isPickerVisible ? (
          <View style={styles.pickerPanel}>
            <Text style={styles.pickerTitle}>Choose a video source</Text>
            {remainingSources.length === 0 && (
              <Text style={styles.pickerEmpty}>All sources are already added</Text>
            )}
            {remainingSources.map((s) => (
              <TouchableOpacity key={s.sourceKey} style={styles.pickerRow} onPress={() => addSource(s)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickerRowName}>{s.source}</Text>
                  <Text style={styles.pickerRowMeta}>
                    {s.videos} videos • ~{Math.round(s.minutes / 60)}h • {s.subjects.length} subjects
                  </Text>
                </View>
                <Plus color="#01b4ae" size={20} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.pickerCancel}
              onPress={() => setIsPickerVisible(false)}
            >
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addSourceButton}
            onPress={() => setIsPickerVisible(true)}
            disabled={remainingSources.length === 0}
          >
            <Plus color="#01b4ae" size={18} />
            <Text style={styles.addSourceText}>Add Video Source</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.saveButton, (!canSave || isSaving) && styles.saveButtonDisabled]}
          onPress={saveScope}
          disabled={!canSave || isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Save color="#FFFFFF" size={18} />
              <Text style={styles.saveButtonText}>Save Intern Settings</Text>
            </>
          )}
        </TouchableOpacity>
        {config.isIntern && (
          <TouchableOpacity style={styles.turnOffButton} onPress={turnOff} disabled={isSaving}>
            <Text style={styles.turnOffText}>Turn Off Intern Mode</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderProgress = () => {
    if (!config.isIntern || !progress) return null;
    const done = progress.finishedAll;

    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Progress</Text>

        {config.today ? (
          <View style={styles.progressRow}>
            <Clock color="#0d9488" size={18} />
            <Text style={styles.progressText}>
              Today: <Text style={styles.progressBold}>{formatMinutes(config.today.minutes)}</Text> chosen •{' '}
              {config.today.planCount} {config.today.planCount === 1 ? 'video' : 'videos'} planned
            </Text>
          </View>
        ) : (
          <View style={styles.progressRow}>
            <Clock color="#9CA3AF" size={18} />
            <Text style={styles.progressMuted}>No study time set today yet</Text>
          </View>
        )}

        <View style={styles.progressRow}>
          <ListChecks color="#F59E0B" size={18} />
          <Text style={styles.progressText}>
            To watch: <Text style={styles.progressBold}>{progress.pendingCount} videos</Text> ({formatMinutes(progress.pendingMinutes)})
          </Text>
        </View>
        <View style={styles.progressRow}>
          <CheckCircle color="#10B981" size={18} />
          <Text style={styles.progressText}>
            Watched: <Text style={styles.progressBold}>{progress.watchedCount} videos</Text> ({formatMinutes(progress.watchedMinutes)}) of {progress.scopeVideos} in scope
          </Text>
        </View>

        {done && (
          <View style={styles.finishedBadge}>
            <Trophy color="#059669" size={18} />
            <Text style={styles.finishedText}>Entire scope completed</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
        >
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Intern Mode</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {config.name} • {config.email}
          </Text>
        </View>
        <UserAvatar name={config.name || '?'} role="student" size={40} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {renderToggleCard()}
        {renderScopeBuilder()}
        {renderProgress()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFCFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#01b4ae',
    padding: 16,
    paddingTop: 56,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#E0F7F6',
    marginTop: 2,
  },
  backButton: {
    padding: 5,
  },
  content: {
    padding: 16,
    gap: 14,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#FAFCFC',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: '#01b4ae',
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E0F7F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  draftSummary: {
    marginTop: 12,
    fontSize: 13,
    color: '#0F766E',
  },
  draftSummaryBold: {
    fontWeight: '800',
    color: '#0d9488',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 12,
  },
  sourceBlock: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#FAFCFC',
  },
  sourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sourceName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  sourceMeta: {
    fontSize: 12,
    color: '#6B7280',
  },
  removeSource: {
    padding: 4,
  },
  subjectChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  subjectChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  subjectChipActive: {
    backgroundColor: '#E0F7F6',
    borderColor: '#01b4ae',
  },
  subjectChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  subjectChipTextActive: {
    color: '#0d9488',
  },
  subjectsEmpty: {
    marginTop: 6,
    fontSize: 12,
    color: '#EF4444',
  },
  addSourceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#01b4ae',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
  },
  addSourceText: {
    color: '#01b4ae',
    fontWeight: '700',
    fontSize: 14,
  },
  pickerPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
    backgroundColor: '#F0FDFA',
    padding: 12,
    marginBottom: 10,
  },
  pickerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F766E',
    marginBottom: 8,
  },
  pickerEmpty: {
    fontSize: 13,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#CCFBF1',
    gap: 8,
  },
  pickerRowName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  pickerRowMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  pickerCancel: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  pickerCancelText: {
    color: '#6B7280',
    fontWeight: '600',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 4,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  turnOffButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  turnOffText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 14,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  progressText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
  },
  progressBold: {
    fontWeight: '800',
    color: '#0F172A',
  },
  progressMuted: {
    flex: 1,
    fontSize: 13,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  finishedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    padding: 10,
  },
  finishedText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#047857',
  },
});
// Mentorship flag: intern mode extends the My Students / student tasks surface.
export default withFeatureGate('mentorship')(InternManageScreen);
