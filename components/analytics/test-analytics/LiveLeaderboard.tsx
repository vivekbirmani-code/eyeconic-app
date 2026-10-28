import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Clock, Download, Radio, RefreshCw, Trophy } from 'lucide-react-native';
import { api } from '@/services/api';
import { downloadApiReport, getReportDownloadErrorMessage } from '@/services/downloads';
import { subscribeLeaderboardRoom } from '@/services/leaderboardSubscription';
import { useNotifications } from '@/context/NotificationContext';
import ExportLeaderboardDialog, {
  type ExportAudience,
  type ExportFormat,
} from './ExportLeaderboardDialog';
import { formatPercent, LeaderboardEntry, LeaderboardResponse } from '@/types/analytics';

// Bursts of submissions collapse into one refetch: events arriving inside
// this window (and events landing while a refetch is already in flight)
// schedule a single trailing fetch.
const REFRESH_COALESCE_MS = 600;
// How long a changed row stays tinted after an update lands.
const HIGHLIGHT_DURATION_MS = 1600;
// Cadence for the "Updated X ago" label — coarse enough that only the header
// re-renders, and just twice a minute.
const UPDATED_LABEL_TICK_MS = 30000;

const MEDAL_COLORS = ['#F59E0B', '#94A3B8', '#CD7F32'] as const;

type FetchStatus = 'loading' | 'ready' | 'error';

function formatMarks(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return String(Number(num.toFixed(2)));
}

function formatMinutes(minutes: number): string {
  const num = Number(minutes);
  if (!Number.isFinite(num) || num <= 0) return '0 min';
  return `${Number(num.toFixed(1))} min`;
}

function relativeUpdatedLabel(timestamp: number | null): string {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 15) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ago`;
}

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  position: number;
  highlighted: boolean;
  updateId: number;
  onPress: (attemptId: string) => void;
}

/**
 * One leaderboard row. Memoized so a live refresh only re-renders rows whose
 * props actually changed (FlatList keys by attempt id; unchanged rows keep
 * their exact props and skip rendering entirely).
 */
const LeaderboardRow = React.memo(function LeaderboardRow({
  entry,
  position,
  highlighted,
  updateId,
  onPress,
}: LeaderboardRowProps) {
  const highlightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Flash only rows that changed in THIS update. The background is an
    // animated value (not a style swap), so there is no layout shift and
    // untouched rows never animate.
    if (highlighted) {
      highlightAnim.setValue(1);
      Animated.timing(highlightAnim, {
        toValue: 0,
        duration: HIGHLIGHT_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false, // backgroundColor is not native-driver safe
      }).start();
    }
  }, [updateId, highlighted, highlightAnim]);

  const scorePct = entry.scorePercentage ?? entry.percentage;
  const isTopThree = position <= 3;

  return (
    <TouchableOpacity
      style={styles.rowTouchable}
      activeOpacity={0.7}
      onPress={() => onPress(entry._id)}
    >
      <Animated.View
        style={[
          styles.row,
          {
            backgroundColor: highlightAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['#FFFFFF', '#E0FBF9'],
            }),
          },
        ]}
      >
        <View
          style={[
            styles.rankBadge,
            { backgroundColor: isTopThree ? MEDAL_COLORS[position - 1] : '#F3F4F6' },
          ]}
        >
          <Text style={[styles.rankText, { color: isTopThree ? '#FFFFFF' : '#6B7280' }]}>
            {position}
          </Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>
            {(entry.studentName || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleRow}>
            <View style={styles.rowNameWrap}>
              <Text style={styles.rowName} numberOfLines={1}>
                {entry.studentName}
              </Text>
              {entry.participantType === 'external' ? <GuestBadge /> : null}
            </View>
            <Text style={[styles.rowScore, (scorePct ?? 0) >= 60 ? styles.passScore : styles.failScore]}>
              {formatPercent(scorePct)}
            </Text>
          </View>
          <Text style={styles.rowMeta}>
            {formatMarks(entry.marksObtained)}/{formatMarks(entry.totalMarks)} marks
            {'  •  '}Acc {formatPercent(entry.accuracy, 'N/A')}
          </Text>
          <Text style={styles.rowMeta}>
            C {entry.correct} / W {entry.incorrect} / S {entry.skipped}
          </Text>
          <View style={styles.rowFooter}>
            <View style={styles.rowTime}>
              <Clock color="#9CA3AF" size={12} />
              <Text style={styles.rowFooterText}>{formatMinutes(entry.timeSpent)}</Text>
            </View>
            <Text style={styles.rowFooterText}>
              {entry.completedAt
                ? new Date(entry.completedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : ''}
            </Text>
          </View>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
});

/** "GUEST" chip for external (public-quiz) rows — same visual language as the
 * Public Participants list (GuestParticipantList). */
function GuestBadge() {
  return (
    <View style={styles.guestBadge}>
      <Text style={styles.guestBadgeText}>GUEST</Text>
    </View>
  );
}

interface LiveLeaderboardProps {
  testId: string;
  onStudentClick: (attemptId: string) => void;
  /** Viewer's role — 'admin' unlocks the External (public-quiz guest) audience. */
  userRole?: string;
  /** Completed public-quiz guests for this test, from the admin analytics
   * payload. Drives the external EXPORT's empty check (the export serves the
   * same lead list analytics carries); the board itself ranks guests live. */
  guestParticipantCount?: number;
}

/**
 * Real-time leaderboard for the selected test in Test Analytics.
 *
 * Data comes from GET /quizzes/analytics/test/:id/leaderboard — one shared
 * ranking core, so ranking and tie-breakers have a single source of truth.
 * Admin boards rank internal (registered) and external (public-quiz guest)
 * participants TOGETHER — external rows carry participantType 'external' and
 * a GUEST chip, and open the same attempt detail via their attempt id;
 * mentors receive registered students only (external data is admin-only
 * backend-side). Real-time updates are nudges, not payloads: a submission —
 * internal or external — emits quiz_leaderboard_updated to the test's
 * leaderboard room, and this component coalesces those nudges into a single
 * trailing refetch (plus one resync refetch on socket reconnect, which covers
 * anything missed while offline).
 */
export default function LiveLeaderboard({
  testId,
  onStudentClick,
  userRole,
  guestParticipantCount,
}: LiveLeaderboardProps) {
  const { socket } = useNotifications();

  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [status, setStatus] = useState<FetchStatus>('loading');
  const [live, setLive] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [updatedLabel, setUpdatedLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [highlights, setHighlights] = useState<Set<string>>(new Set());
  const [updateId, setUpdateId] = useState(0);
  // Export dialog — picks the audience (internal registered students /
  // external public-quiz guests, admin-only) and the file format. Rendered as
  // a screen-level RN Modal (see ExportLeaderboardDialog): the chooser has no
  // inputs, so the Android Modal keyboard pitfalls don't apply, and a
  // host-level Modal is the only way to scrim + center over the whole
  // viewport from inside this card (an in-tree overlay anchors to this
  // component's bounds within the analytics ScrollView).
  const [dialogVisible, setDialogVisible] = useState(false);
  const [exportAudience, setExportAudience] = useState<ExportAudience>('internal');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('excel');
  const [exporting, setExporting] = useState<{ audience: ExportAudience; format: ExportFormat } | null>(null);
  const isAdmin = userRole === 'admin';

  // Latest-response guard: a slow response for a previous test (or a response
  // overtaken by a live refresh) must never overwrite newer state.
  const requestSeq = useRef(0);
  const fetchInFlight = useRef(false);
  const fetchAgainAfter = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Previous row fingerprints, to decide which rows changed in an update.
  // Empty on first load → no highlight flash for the initial render.
  const prevFingerprints = useRef<Map<string, string>>(new Map());
  // Stable tap handler for memoized rows.
  const onPressLatest = useRef(onStudentClick);
  onPressLatest.current = onStudentClick;
  const handleRowPress = useCallback((attemptId: string) => {
    onPressLatest.current(attemptId);
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    const seq = ++requestSeq.current;
    fetchInFlight.current = true;
    try {
      const response = await api.get<LeaderboardResponse>(
        `/quizzes/analytics/test/${testId}/leaderboard`
      );
      if (seq !== requestSeq.current) return; // stale response

      const nextRows = Array.isArray(response.data?.leaderboard) ? response.data.leaderboard : [];

      // Diff against the previous snapshot: a row is "changed" when it is new
      // or its rank/score moved. Changed rows get the highlight flash; the
      // rest re-render invisibly. The very first load diff nothing.
      const hadPrevious = prevFingerprints.current.size > 0;
      const changed = new Set<string>();
      if (hadPrevious) {
        const nextFingerprints = new Map<string, string>();
        nextRows.forEach((entry, index) => {
          nextFingerprints.set(
            entry._id,
            `${index + 1}:${entry.scorePercentage ?? entry.percentage}:${entry.marksObtained}`
          );
        });
        nextFingerprints.forEach((fingerprint, attemptId) => {
          if (prevFingerprints.current.get(attemptId) !== fingerprint) {
            changed.add(attemptId);
          }
        });
        prevFingerprints.current = nextFingerprints;
      } else {
        nextRows.forEach((entry, index) => {
          prevFingerprints.current.set(
            entry._id,
            `${index + 1}:${entry.scorePercentage ?? entry.percentage}:${entry.marksObtained}`
          );
        });
      }

      setRows(nextRows);
      setHighlights(changed);
      setUpdateId((id) => id + 1);
      setLastUpdatedAt(Date.now());
      setStatus('ready');
    } catch {
      if (seq !== requestSeq.current) return;
      // Keep the last good rows on a failed live refresh — only a load with
      // nothing to show surfaces the error state.
      setStatus((current) => (current === 'ready' ? current : 'error'));
    } finally {
      fetchInFlight.current = false;
      // A submission landed while this fetch was in flight — chain exactly
      // one more. Always through the ref so a changed testId never fetches
      // its predecessor's URL.
      if (fetchAgainAfter.current) {
        fetchAgainAfter.current = false;
        fetchRef.current();
      }
    }
  }, [testId]);

  // Ref indirection declared after fetchLeaderboard so it can self-chain.
  const fetchRef = useRef(fetchLeaderboard);
  fetchRef.current = fetchLeaderboard;

  // Reset and (re)load whenever the selected test changes. A pending refresh
  // timer belonged to the previous test — cancel it so it cannot fire a
  // duplicate fetch of the new one.
  useEffect(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    prevFingerprints.current = new Map();
    setRows([]);
    setHighlights(new Set());
    setLastUpdatedAt(null);
    setStatus('loading');
    setDialogVisible(false);
    fetchRef.current();
  }, [testId]);

  // Coalesced live refresh: events inside the window collapse into one
  // trailing fetch; events during an in-flight fetch chain exactly one more.
  const scheduleRefresh = useCallback(() => {
    if (fetchInFlight.current) {
      fetchAgainAfter.current = true;
      return;
    }
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      fetchRef.current();
    }, REFRESH_COALESCE_MS);
  }, []);

  // Socket wiring: join the test's leaderboard room and refresh on update
  // nudges. The shared subscription module owns the reconnect contract —
  // Socket.IO rooms do not survive a disconnect, so every (re)connect
  // re-joins the room and triggers one coalesced resync refetch covering
  // anything missed while offline. (The previous inline wiring registered
  // its 'connect' handler only when the socket was offline at mount, so a
  // connected socket that later dropped and reconnected never re-joined and
  // the board froze at stale rows until a manual refresh.)
  useEffect(() => {
    return subscribeLeaderboardRoom(socket, testId, {
      onUpdate: scheduleRefresh,
      onResync: scheduleRefresh,
      onLiveChange: setLive,
    });
  }, [socket, testId, scheduleRefresh]);

  // Clear a pending refresh timer on unmount so no fetch fires late.
  useEffect(() => {
    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, []);

  // "Updated X ago" label — recompute on a coarse tick only.
  useEffect(() => {
    setUpdatedLabel(relativeUpdatedLabel(lastUpdatedAt));
    if (!lastUpdatedAt) return;
    const interval = setInterval(() => {
      setUpdatedLabel(relativeUpdatedLabel(lastUpdatedAt));
    }, UPDATED_LABEL_TICK_MS);
    return () => clearInterval(interval);
  }, [lastUpdatedAt]);

  const handleManualRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    Promise.resolve(fetchRef.current()).finally(() => setRefreshing(false));
  }, [refreshing]);

  // Export taps the same server-side ranking the board renders (the export
  // routes reuse the leaderboard endpoint's loader), so the file always
  // matches the live board — the rows on screen are only used to decide
  // whether there is anything to export. The empty check runs per audience at
  // Export-press time: an admin can have zero internal rows but guests to
  // export, or the reverse.
  const handleExportPress = useCallback(() => {
    if (exporting) return;
    setDialogVisible(true);
  }, [exporting]);

  // Internal rows only — external participants ride `rows` too on admin
  // boards, but the internal export audience serves registered students only.
  const internalRowCount = useMemo(
    () => rows.filter((r) => r.participantType !== 'external').length,
    [rows]
  );

  const handleExport = useCallback(async () => {
    if (exporting) return;
    const count = exportAudience === 'internal' ? internalRowCount : (guestParticipantCount ?? 0);
    if (count === 0) {
      Alert.alert(
        'Nothing to export',
        exportAudience === 'internal'
          ? 'No students have submitted this test yet, so there is no leaderboard to export.'
          : 'No public-quiz guests have completed this test yet, so there is no list to export.'
      );
      return;
    }
    setDialogVisible(false);
    setExporting({ audience: exportAudience, format: exportFormat });
    try {
      await downloadApiReport(
        `/quizzes/analytics/test/${testId}/leaderboard/export/${exportFormat}` +
          (exportAudience === 'external' ? '?cohort=external' : '')
      );
    } catch (error) {
      Alert.alert('Export failed', getReportDownloadErrorMessage(error));
    } finally {
      setExporting(null);
    }
  }, [exporting, exportAudience, exportFormat, internalRowCount, guestParticipantCount, testId]);

  const renderRow = useCallback(
    ({ item, index }: { item: LeaderboardEntry; index: number }) => (
      <LeaderboardRow
        entry={item}
        position={index + 1}
        highlighted={highlights.has(item._id)}
        updateId={updateId}
        onPress={handleRowPress}
      />
    ),
    [highlights, updateId, handleRowPress]
  );

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Trophy color="#01b4ae" size={18} />
            <View>
              <Text style={styles.title}>Live Leaderboard</Text>
              <Text style={styles.subtitle}>
                {rows.length > 0
                  ? `${rows.length} participant${rows.length === 1 ? '' : 's'}`
                  : 'Ranked by score, then accuracy'}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.livePill, live ? styles.livePillOn : styles.livePillOff]}>
              <Radio color={live ? '#01b4ae' : '#9CA3AF'} size={12} />
              <Text style={[styles.livePillText, { color: live ? '#01b4ae' : '#9CA3AF' }]}>
                {live ? 'LIVE' : 'OFFLINE'}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={handleExportPress}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Export leaderboard"
              >
                {exporting ? (
                  <ActivityIndicator color="#6B7280" size="small" />
                ) : (
                  <Download color="#6B7280" size={18} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={handleManualRefresh}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Refresh leaderboard"
              >
                {refreshing ? (
                  <ActivityIndicator color="#6B7280" size="small" />
                ) : (
                  <RefreshCw color="#6B7280" size={18} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {updatedLabel !== '' && <Text style={styles.updatedLabel}>{updatedLabel}</Text>}

        {status === 'loading' && rows.length === 0 ? (
          <ActivityIndicator color="#01b4ae" style={styles.loader} />
        ) : status === 'error' && rows.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Trophy color="#9CA3AF" size={40} />
            <Text style={styles.emptyText}>Couldn’t load the leaderboard.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleManualRefresh} activeOpacity={0.7}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Trophy color="#9CA3AF" size={40} />
            {/* Empty means empty for BOTH cohorts: admins' boards rank public
                participants too, so guests having submitted would put rows
                here. Mentors never receive external rows (admin-only data). */}
            <Text style={styles.emptyText}>No submissions yet</Text>
            <Text style={styles.emptyHint}>
              {live
                ? 'Rankings appear here the moment a participant submits.'
                : 'Reconnect to see rankings update as participants submit.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item._id}
            renderItem={renderRow}
            extraData={updateId}
            ItemSeparatorComponent={RowSeparator}
            scrollEnabled={false}
            initialNumToRender={12}
            ListFooterComponent={<View style={styles.listFooter} />}
          />
        )}
      </View>

      {/* Export chooser — audience + format. Rendered as a host-level RN
          Modal so the scrim and centering cover the whole viewport instead of
          this card's bounds inside the analytics ScrollView. */}
      <ExportLeaderboardDialog
        visible={dialogVisible}
        isAdmin={isAdmin}
        audience={exportAudience}
        format={exportFormat}
        exporting={!!exporting}
        internalCount={internalRowCount}
        externalCount={guestParticipantCount ?? 0}
        onAudienceChange={setExportAudience}
        onFormatChange={setExportFormat}
        onCancel={() => {
          if (!exporting) setDialogVisible(false);
        }}
        onExport={handleExport}
      />
    </View>
  );
}

function RowSeparator() {
  return <View style={styles.rowSeparator} />;
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 8,
    gap: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  // Control stack pinned to the card's right edge: LIVE pill on top, export
  // + refresh buttons in a row directly below it, all flush to the same right
  // edge.
  headerRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  livePillOn: {
    backgroundColor: '#E0FBF9',
    borderColor: '#01b4ae',
  },
  livePillOff: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
  },
  livePillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  updatedLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  loader: {
    marginVertical: 32,
  },
  // ---- Rows ----
  rowTouchable: {
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 10,
    gap: 10,
  },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '700',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowNameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  rowName: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
  },
  rowScore: {
    fontSize: 15,
    fontWeight: '700',
  },
  passScore: {
    color: '#10B981',
  },
  failScore: {
    color: '#EF4444',
  },
  rowMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 8,
  },
  rowTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowFooterText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  rowSeparator: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginLeft: 100,
  },
  guestBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  guestBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  listFooter: {
    height: 4,
  },
  // ---- States ----
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    backgroundColor: '#01b4ae',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
