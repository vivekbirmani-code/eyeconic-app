import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Clock, PlayCircle, ListChecks, Trophy, ChevronRight } from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import TimeSlider from '@/components/intern/TimeSlider';
import {
  getInternStatus,
  setInternTime,
  type InternStatus,
  type SetInternTimeResult,
} from '@/services/intern';

/**
 * Intern Mode time slicer — lives in the group description area of the Group
 * Info screen. Renders nothing unless the signed-in student is an intern
 * (mentor-toggled). The chosen minutes drive today's video allocation.
 */

const MIN_MINUTES = 30;
const MAX_MINUTES = 720;
const STEP_MINUTES = 15;
const PRESETS = [30, 60, 120, 240, 480, 720];

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function InternTimeSlicer() {
  const router = useRouter();
  const [status, setStatus] = useState<InternStatus | null>(null);
  const [mode, setMode] = useState<'loading' | 'hidden' | 'ready'>('loading');
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<SetInternTimeResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const me = await getInternStatus();
          if (cancelled) return;
          if (!me.isIntern) {
            setMode('hidden');
            return;
          }
          setStatus(me);
          setSliderValue((prev) => prev ?? me.today?.minutes ?? 120);
          setMode('ready');
        } catch {
          if (!cancelled) setMode('hidden'); // fail silent: group info stays usable
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (mode !== 'ready' || sliderValue === null) {
    // Non-interns (and loading) see nothing — the slicer is intern-only.
    return null;
  }

  const todayMinutes = status?.today?.minutes ?? null;
  const todayPlan = status?.today?.plan ?? [];
  const todayVideoIds = new Set(todayPlan.map((t) => t._id));

  const submit = async () => {
    setIsSaving(true);
    try {
      const res = await setInternTime(sliderValue);
      setResult(res);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Refresh status so the "today" summary below stays in sync.
      try {
        const me = await getInternStatus();
        if (me.isIntern) setStatus(me);
      } catch {}
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', error?.response?.data?.message || 'Could not set your study time');
    } finally {
      setIsSaving(false);
    }
  };

  const renderResult = () => {
    if (!result) return null;

    if (result.reason === 'PLAYLIST_FINISHED') {
      return (
        <View style={[styles.resultBox, styles.resultDone]}>
          <Trophy color="#059669" size={18} />
          <Text style={styles.resultDoneText}>
            All your videos are completed. Ask your mentor to extend your subjects.
          </Text>
        </View>
      );
    }

    if (result.reason === 'NEXT_VIDEO_LONGER_THAN_TIME') {
      return (
        <View style={[styles.resultBox, styles.resultWarn]}>
          <Clock color="#B45309" size={18} />
          <Text style={styles.resultWarnText}>
            No video fits in {formatMinutes(result.minutes)} today — your next video needs{' '}
            {formatMinutes(result.nextVideo?.durationMin ?? 0)}. Increase your time to include it.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <ListChecks color="#01b4ae" size={18} />
          <Text style={styles.resultTitle}>
            {result.plan.length} {result.plan.length === 1 ? 'video' : 'videos'} •{' '}
            {formatMinutes(result.totalMinutes)} planned
          </Text>
        </View>
        {result.plan.slice(0, 3).map((t) => (
          <Text key={t._id} style={styles.resultItem} numberOfLines={1}>
            • {t.title}
          </Text>
        ))}
        {result.plan.length > 3 && (
          <Text style={styles.resultItem}>…and {result.plan.length - 3} more</Text>
        )}
        <TouchableOpacity
          style={styles.viewTasksButton}
          onPress={() => router.push('/(tabs)/student-assignments' as any)}
        >
          <Text style={styles.viewTasksText}>View in My Tasks</Text>
          <ChevronRight color="#FFFFFF" size={16} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <PlayCircle color="#01b4ae" size={20} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>Today's Study Time</Text>
          <Text style={styles.cardSubtitle}>
            How much time can you give today? We'll line up your videos.
          </Text>
        </View>
      </View>

      {todayMinutes !== null && (
        <Text style={styles.currentLine}>
          Set today: <Text style={styles.currentBold}>{formatMinutes(todayMinutes)}</Text>
          {todayPlan.length > 0
            ? ` • ${todayPlan.length} ${todayPlan.length === 1 ? 'video' : 'videos'} • ${todayPlan.filter((t) => t.status === 'watched').length} watched`
            : ' • no videos fit yet'}
        </Text>
      )}

      <Text style={styles.valueText}>{formatMinutes(sliderValue)}</Text>

      <TimeSlider
        min={MIN_MINUTES}
        max={MAX_MINUTES}
        step={STEP_MINUTES}
        value={sliderValue}
        onChange={(v) => {
          setSliderValue(v);
          Haptics.selectionAsync();
        }}
        disabled={isSaving}
      />

      <View style={styles.presetRow}>
        {PRESETS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.presetChip, sliderValue === p && styles.presetChipActive]}
            onPress={() => {
              setSliderValue(p);
              Haptics.selectionAsync();
            }}
            disabled={isSaving}
          >
            <Text style={[styles.presetText, sliderValue === p && styles.presetTextActive]}>
              {formatMinutes(p)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.setButton, isSaving && styles.setButtonDisabled]}
        onPress={submit}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <>
            <Clock color="#FFFFFF" size={18} />
            <Text style={styles.setButtonText}>
              {todayMinutes !== null ? 'Update Today’s Plan' : 'Set Today’s Plan'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {renderResult()}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginHorizontal: 15,
    marginTop: 14,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E0F7F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderText: {
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
  currentLine: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  currentBold: {
    fontWeight: '700',
    color: '#0d9488',
  },
  valueText: {
    fontSize: 34,
    fontWeight: '800',
    color: '#01b4ae',
    textAlign: 'center',
    marginBottom: 4,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 14,
  },
  presetChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  presetChipActive: {
    backgroundColor: '#E0F7F6',
    borderColor: '#01b4ae',
  },
  presetText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  presetTextActive: {
    color: '#0d9488',
  },
  setButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#01b4ae',
    borderRadius: 12,
    paddingVertical: 13,
  },
  setButtonDisabled: {
    opacity: 0.6,
  },
  setButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  resultCard: {
    marginTop: 14,
    backgroundColor: '#F0FDFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
    padding: 12,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F766E',
    flexShrink: 1,
  },
  resultItem: {
    fontSize: 13,
    color: '#0F766E',
    marginBottom: 2,
  },
  viewTasksButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#01b4ae',
    borderRadius: 10,
    paddingVertical: 9,
    marginTop: 10,
  },
  viewTasksText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  resultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  resultWarn: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  resultWarnText: {
    flex: 1,
    fontSize: 13,
    color: '#B45309',
    fontWeight: '500',
  },
  resultDone: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  resultDoneText: {
    flex: 1,
    fontSize: 13,
    color: '#047857',
    fontWeight: '600',
  },
});
