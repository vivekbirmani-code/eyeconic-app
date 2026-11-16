import React, { useState, useEffect } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { ScreenContainer } from '@/components/layout';
import { KpiStatCard } from '@/components/KpiStatCard';
import {
  BookOpen,
  Calendar,
  CheckCircle,
  Clock,
  TrendingUp,
  Check,
  X,
  Video,
  PlayCircle,
  ListChecks
} from 'lucide-react-native';
import * as Haptics from '@/utils/haptics';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import {
  getInternStatus,
  getInternTasks,
  markInternTaskWatched,
  type InternTask
} from '@/services/intern';
import { formatMinutes } from '@/components/intern/InternTimeSlicer';

interface Subject {
  _id: string;
  name: string;
  year: string;
}

interface Assignment {
  _id: string;
  title: string;
  description?: string;
  subject: Subject;
  mentor: {
    _id: string;
    name: string;
    email: string;
  };
  taskType: string;
  duration: number;
  scheduledDate: string;
  status: 'pending' | 'completed' | 'verified' | 'redo';
  completedAt?: string;
  verifiedAt?: string;
  mentorComment?: string;
  redoReason?: string;
  createdAt: string;
}

type TabType = 'all' | 'thisWeek' | 'completed' | 'studyVideos';
type GroupBy = 'week' | 'subject';

interface InternToday {
  date: string;
  minutes: number;
  videoIds: string[];
}

const STAT_CARD_GAP = 12;
const STAT_HORIZONTAL_PADDING = 16;
const STAT_CARD_MIN_WIDTH = 96;
const STAT_CARD_MAX_WIDTH = 120;

function StudentAssignments() {
  const { width: screenWidth } = useWindowDimensions();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('week');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleting, setIsCompleting] = useState<string | null>(null);
  // Intern Mode: video tasks live beside mentor assignments in this screen.
  const [isIntern, setIsIntern] = useState(false);
  const [internTasks, setInternTasks] = useState<InternTask[]>([]);
  const [internToday, setInternToday] = useState<InternToday | null>(null);
  const [internLoading, setInternLoading] = useState(false);
  const [watchingTaskId, setWatchingTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === 'student') {
      fetchAssignments();
      fetchInternStatus();
    }
  }, [user]);

  const fetchInternStatus = async () => {
    try {
      const me = await getInternStatus();
      if (me.isIntern) {
        setIsIntern(true);
        loadInternTasks();
      }
    } catch {
      // Non-intern or unreachable: the Study Videos tab simply stays hidden.
    }
  };

  const loadInternTasks = async () => {
    setInternLoading(true);
    try {
      const data = await getInternTasks();
      setInternTasks(data.tasks || []);
      setInternToday(data.today || null);
    } catch (error) {
      console.error('Error fetching intern tasks:', error);
    } finally {
      setInternLoading(false);
    }
  };

  const completeInternTask = (taskId: string) => {
    Alert.alert(
      'Mark as Watched',
      'Have you finished watching this video?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Watched',
          onPress: async () => {
            setWatchingTaskId(taskId);
            try {
              await markInternTaskWatched(taskId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              loadInternTasks();
            } catch (error: any) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Error', error?.response?.data?.message || 'Failed to mark watched');
            } finally {
              setWatchingTaskId(null);
            }
          }
        }
      ]
    );
  };

  const fetchAssignments = async () => {
    setIsLoading(true);
    try {
      const response = await api.get(`/assignments/student/${user?._id}`);
      setAssignments(response.data);
    } catch (error) {
      console.error('Error fetching assignments:', error);
      Alert.alert('Error', 'Failed to fetch assignments');
    } finally {
      setIsLoading(false);
    }
  };

  const completeAssignment = async (assignmentId: string) => {
    setIsCompleting(assignmentId);
    try {
      await api.put(`/assignments/${assignmentId}/complete`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Assignment marked as completed!');
      fetchAssignments();
    } catch (error: any) {
      console.error('Error completing assignment:', error);
      Alert.alert('Error', error?.response?.data?.message || 'Failed to complete assignment');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsCompleting(null);
    }
  };

  const getFilteredAssignments = () => {
    let filtered = assignments;

    if (activeTab === 'thisWeek') {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() + diffToMonday);
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      filtered = assignments.filter(a => {
        const scheduledDate = new Date(a.scheduledDate);
        return scheduledDate >= weekStart && scheduledDate <= weekEnd;
      });
    } else if (activeTab === 'completed') {
      filtered = assignments.filter(a => a.status === 'verified');
    }

    return filtered;
  };

  const getStats = () => {
    const total = assignments.length;
    const pending = assignments.filter(a => a.status === 'pending' || a.status === 'redo').length;
    const completed = assignments.filter(a => a.status === 'completed').length;
    const verified = assignments.filter(a => a.status === 'verified').length;
    const completionRate = total > 0 ? Math.round((verified / total) * 100) : 0;

    return { total, pending, completed, verified, completionRate };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'verified': return '#10B981';
      case 'completed': return '#3B82F6';
      case 'redo': return '#F59E0B';
      case 'pending': return '#6B7280';
      default: return '#6B7280';
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case 'verified': return '#D1FAE5';
      case 'completed': return '#DBEAFE';
      case 'redo': return '#FEF3C7';
      case 'pending': return '#F3F4F6';
      default: return '#F3F4F6';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'verified':
        return <CheckCircle color="#10B981" size={18} />;
      case 'completed':
        return <Clock color="#3B82F6" size={18} />;
      case 'redo':
        return <X color="#F59E0B" size={18} />;
      default:
        return <Clock color="#6B7280" size={18} />;
    }
  };

  const renderAssignmentCard = ({ item }: { item: Assignment }) => {
    const canComplete = item.status === 'pending' || item.status === 'redo';

    return (
      <View style={styles.assignmentCard}>
        <View style={styles.assignmentHeader}>
          <View style={styles.subjectBadge}>
            <BookOpen color="#01b4ae" size={14} />
            <Text style={styles.subjectText} numberOfLines={1}>{item.subject.name}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusBgColor(item.status) }]}>
            {getStatusIcon(item.status)}
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.assignmentBody}>
          <Text style={styles.assignmentTitle}>{item.title}</Text>
          {item.description && (
            <Text style={styles.assignmentDescription}>{item.description}</Text>
          )}

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Type:</Text>
              <Text style={styles.metaValue}>{item.taskType}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Duration:</Text>
              <Text style={styles.metaValue}>{item.duration} min</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Scheduled:</Text>
              <Text style={styles.metaValue}>
                {new Date(item.scheduledDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Mentor:</Text>
              <Text style={styles.metaValue}>{item.mentor.name}</Text>
            </View>
          </View>

          {item.status === 'completed' && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ✓ Completed on {new Date(item.completedAt!).toLocaleDateString()}
              </Text>
              <Text style={styles.infoSubtext}>Waiting for mentor verification</Text>
            </View>
          )}

          {item.status === 'verified' && (
            <View style={[styles.infoBox, { backgroundColor: '#D1FAE5', borderColor: '#10B981' }]}>
              <Text style={[styles.infoText, { color: '#047857' }]}>
                ✓ Verified on {new Date(item.verifiedAt!).toLocaleDateString()}
              </Text>
              {item.mentorComment && (
                <Text style={[styles.infoSubtext, { color: '#059669' }]}>
                  Comment: {item.mentorComment}
                </Text>
              )}
            </View>
          )}

          {item.status === 'redo' && (
            <View style={[styles.infoBox, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
              <Text style={[styles.infoText, { color: '#92400E' }]}>
                ⚠ Redo Requested
              </Text>
              {item.redoReason && (
                <Text style={[styles.infoSubtext, { color: '#B45309' }]}>
                  Reason: {item.redoReason}
                </Text>
              )}
            </View>
          )}
        </View>

        {canComplete && (
          <TouchableOpacity
            style={styles.completeButton}
            onPress={() => {
              Alert.alert(
                'Mark as Completed',
                'Have you finished this assignment?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Yes, Mark Complete',
                    onPress: () => completeAssignment(item._id)
                  }
                ]
              );
            }}
            disabled={isCompleting === item._id}
          >
            {isCompleting === item._id ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Check color="#FFFFFF" size={18} />
                <Text style={styles.completeButtonText}>Mark as Done</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ---- Intern Mode: Study Videos tab ----

  const todayVideoIds = new Set(internToday?.videoIds || []);
  const internTodayTasks = internTasks.filter((t) => todayVideoIds.has(t.video));
  const internPendingCount = internTasks.filter((t) => t.status === 'pending').length;
  const internWatchedCount = internTasks.filter((t) => t.status === 'watched').length;
  const internTodayWatched = internTodayTasks.filter((t) => t.status === 'watched').length;

  const renderInternTaskCard = ({ item }: { item: InternTask }) => {
    const isToday = todayVideoIds.has(item.video);
    const isWatched = item.status === 'watched';

    return (
      <View style={styles.assignmentCard}>
        <View style={styles.assignmentHeader}>
          <View style={styles.subjectBadge}>
            <Video color="#01b4ae" size={14} />
            <Text style={styles.subjectText} numberOfLines={1}>{item.subject}</Text>
          </View>
          {isToday ? (
            <View style={[styles.statusBadge, { backgroundColor: '#E0F7F6' }]}>
              <ListChecks color="#01b4ae" size={16} />
              <Text style={[styles.statusText, { color: '#0d9488', fontWeight: '700' }]}>TODAY</Text>
            </View>
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: isWatched ? '#D1FAE5' : '#F3F4F6' }]}>
              {isWatched
                ? <CheckCircle color="#10B981" size={16} />
                : <Clock color="#6B7280" size={16} />}
              <Text style={[styles.statusText, { color: isWatched ? '#059669' : '#6B7280' }]}>
                {isWatched ? 'WATCHED' : 'CARRY OVER'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.assignmentBody}>
          <Text style={styles.assignmentTitle}>{item.title}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Source:</Text>
              <Text style={styles.metaValue}>{item.source}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Type:</Text>
              <Text style={styles.metaValue}>{item.type}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Duration:</Text>
              <Text style={styles.metaValue}>{item.durationMin} min</Text>
            </View>
          </View>
          {isWatched && item.watchedAt && (
            <View style={[styles.infoBox, { backgroundColor: '#D1FAE5', borderColor: '#10B981' }]}>
              <Text style={[styles.infoText, { color: '#047857' }]}>
                ✓ Watched on {new Date(item.watchedAt).toLocaleDateString()}
              </Text>
            </View>
          )}
        </View>

        {!isWatched && (
          <TouchableOpacity
            style={styles.completeButton}
            onPress={() => completeInternTask(item._id)}
            disabled={watchingTaskId === item._id}
          >
            {watchingTaskId === item._id ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <PlayCircle color="#FFFFFF" size={18} />
                <Text style={styles.completeButtonText}>Mark as Watched</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const internListHeader = () => (
    <View style={styles.internTodaySummary}>
      {internToday ? (
        <>
          <Clock color="#0d9488" size={18} />
          <Text style={styles.internTodayText}>
            Today: <Text style={styles.internTodayBold}>{formatMinutes(internToday.minutes)}</Text>{' '}
            chosen • {internTodayTasks.length} {internTodayTasks.length === 1 ? 'video' : 'videos'} planned •{' '}
            {internTodayWatched} watched
          </Text>
        </>
      ) : (
        <Text style={styles.internTodayHint}>
          No time set for today yet — open any of your groups, tap the group name, and set today's
          study time.
        </Text>
      )}
    </View>
  );

  // Today's plan first (playlist order), then carry-over pending, then watched.
  const orderedInternTasks = [
    ...internTodayTasks,
    ...internTasks.filter((t) => t.status === 'pending' && !todayVideoIds.has(t.video)),
    ...internTasks.filter((t) => t.status === 'watched' && !todayVideoIds.has(t.video)),
  ];

  if (user?.role !== 'student') {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.errorText}>Access Denied - Students Only</Text>
      </ScreenContainer>
    );
  }

  const stats = getStats();
  const filteredAssignments = getFilteredAssignments();

  const statCardWidth = Math.min(
    STAT_CARD_MAX_WIDTH,
    Math.max(
      STAT_CARD_MIN_WIDTH,
      Math.floor(
        (screenWidth - STAT_HORIZONTAL_PADDING * 2 - STAT_CARD_GAP * 3) / 3.15
      )
    )
  );

  const internWatchedMinutes = internTasks
    .filter((t) => t.status === 'watched')
    .reduce((sum, t) => sum + t.durationMin, 0);

  const kpiCards =
    activeTab === 'studyVideos'
      ? ([
          {
            key: 'today',
            icon: ListChecks,
            value: `${internTodayWatched}/${internTodayTasks.length}`,
            label: 'Today',
            backgroundColor: '#E0F7F6',
            iconColor: '#01b4ae',
            valueColor: '#01b4ae',
            labelColor: '#0d9488',
          },
          {
            key: 'toWatch',
            icon: Video,
            value: internPendingCount,
            label: 'To Watch',
            backgroundColor: '#FEF3C7',
            iconColor: '#F59E0B',
            valueColor: '#D97706',
            labelColor: '#92400E',
          },
          {
            key: 'watched',
            icon: CheckCircle,
            value: internWatchedCount,
            label: 'Watched',
            backgroundColor: '#D1FAE5',
            iconColor: '#10B981',
            valueColor: '#059669',
            labelColor: '#047857',
          },
          {
            key: 'watchedMinutes',
            icon: TrendingUp,
            value: formatMinutes(internWatchedMinutes),
            label: 'Studied',
            backgroundColor: '#DBEAFE',
            iconColor: '#2563EB',
            valueColor: '#1E40AF',
            labelColor: '#1E3A8A',
          },
        ] as const)
      : ([
          {
            key: 'total',
            icon: BookOpen,
            value: stats.total,
            label: 'Total',
            backgroundColor: '#DBEAFE',
            iconColor: '#2563EB',
            valueColor: '#1E40AF',
            labelColor: '#1E3A8A',
          },
          {
            key: 'pending',
            icon: Clock,
            value: stats.pending,
            label: 'Pending',
            backgroundColor: '#FEF3C7',
            iconColor: '#F59E0B',
            valueColor: '#D97706',
            labelColor: '#92400E',
          },
          {
            key: 'verified',
            icon: CheckCircle,
            value: stats.verified,
            label: 'Verified',
            backgroundColor: '#D1FAE5',
            iconColor: '#10B981',
            valueColor: '#059669',
            labelColor: '#047857',
          },
          {
            key: 'completion',
            icon: TrendingUp,
            value: `${stats.completionRate}%`,
            label: 'Completion',
            backgroundColor: '#E0F7F6',
            iconColor: '#01b4ae',
            valueColor: '#01b4ae',
            labelColor: '#0d9488',
          },
        ] as const);

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Assignments</Text>
        <Text style={styles.headerSubtitle}>Track your learning progress</Text>
      </View>

      {/* Stats Cards */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.statsScroll}
        contentContainerStyle={styles.statsContent}
      >
        {kpiCards.map((card) => (
          <KpiStatCard
            key={card.key}
            icon={card.icon}
            value={card.value}
            label={card.label}
            backgroundColor={card.backgroundColor}
            iconColor={card.iconColor}
            valueColor={card.valueColor}
            labelColor={card.labelColor}
            width={statCardWidth}
          />
        ))}
      </ScrollView>

      {/* Tab Navigation — horizontally scrollable with a per-tab floor, so
          single-word labels ("Completed") never break mid-word on narrow
          phones or at large font scales (same pattern as mentor-dashboard's
          tab bar). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabContainer}
        contentContainerStyle={styles.tabContainerContent}
      >
        <TouchableOpacity
          style={[styles.tab, activeTab === 'all' && styles.tabActive]}
          onPress={() => {
            setActiveTab('all');
            Haptics.selectionAsync();
          }}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]} numberOfLines={1}>
            All ({assignments.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'thisWeek' && styles.tabActive]}
          onPress={() => {
            setActiveTab('thisWeek');
            Haptics.selectionAsync();
          }}
        >
          <Calendar color={activeTab === 'thisWeek' ? '#01b4ae' : '#6B7280'} size={16} />
          <Text style={[styles.tabText, activeTab === 'thisWeek' && styles.tabTextActive]} numberOfLines={1}>
            This Week
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'completed' && styles.tabActive]}
          onPress={() => {
            setActiveTab('completed');
            Haptics.selectionAsync();
          }}
        >
          <CheckCircle color={activeTab === 'completed' ? '#01b4ae' : '#6B7280'} size={16} />
          <Text style={[styles.tabText, activeTab === 'completed' && styles.tabTextActive]} numberOfLines={1}>
            Completed
          </Text>
        </TouchableOpacity>

        {isIntern && (
          <TouchableOpacity
            style={[styles.tab, activeTab === 'studyVideos' && styles.tabActive]}
            onPress={() => {
              setActiveTab('studyVideos');
              Haptics.selectionAsync();
              loadInternTasks();
            }}
          >
            <Video color={activeTab === 'studyVideos' ? '#01b4ae' : '#6B7280'} size={16} />
            <Text style={[styles.tabText, activeTab === 'studyVideos' && styles.tabTextActive]} numberOfLines={1}>
              Study Videos
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Content */}
      <View style={styles.content}>
        {activeTab === 'studyVideos' ? (
          internLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#01b4ae" />
              <Text style={styles.loadingText}>Loading study videos...</Text>
            </View>
          ) : (
            <FlatList
              data={orderedInternTasks}
              renderItem={renderInternTaskCard}
              keyExtractor={(item) => item._id}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={internListHeader}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Video color="#9CA3AF" size={48} />
                  <Text style={styles.emptyText}>
                    {internToday ? 'All caught up for now' : 'No study time set today'}
                  </Text>
                  <Text style={styles.emptyHint}>
                    {internToday
                      ? 'Videos you have not watched yet will appear here as soon as they fit your daily time'
                      : 'Open any of your groups, tap the group name, and set how much time you can give today'}
                  </Text>
                </View>
              }
            />
          )
        ) : isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#01b4ae" />
            <Text style={styles.loadingText}>Loading assignments...</Text>
          </View>
        ) : (
          <FlatList
            data={filteredAssignments}
            renderItem={renderAssignmentCard}
            keyExtractor={item => item._id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <BookOpen color="#9CA3AF" size={48} />
                <Text style={styles.emptyText}>No assignments yet</Text>
                <Text style={styles.emptyHint}>
                  {activeTab === 'thisWeek'
                    ? 'No assignments scheduled for this week'
                    : activeTab === 'completed'
                      ? 'Complete assignments to see them here'
                      : 'Your mentor will assign tasks soon'
                  }
                </Text>
              </View>
            }
          />
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFCFC',
  },
  header: {
    backgroundColor: '#01b4ae',
    padding: 20,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#E0F7F6',
  },
  statsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  statsContent: {
    paddingHorizontal: STAT_HORIZONTAL_PADDING,
    paddingVertical: 16,
    gap: STAT_CARD_GAP,
    alignItems: 'flex-start',
  },
  tabContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexGrow: 0,
  },
  tabContainerContent: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  tab: {
    // Natural width with a floor, instead of flex:1 equal cells — the floor
    // keeps single-word labels on one line; the horizontal ScrollView above
    // takes over when even the floors don't fit.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    minWidth: 88,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#01b4ae',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabTextActive: {
    color: '#01b4ae',
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 14,
  },
  assignmentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  assignmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  subjectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E0F7F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    // Shrinks before the status badge does, so long subject names ("Forensic
    // Medicine & Toxicology") ellipsize inside the pill instead of pushing
    // the badge off the card on narrow screens.
    flexShrink: 1,
  },
  subjectText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#01b4ae',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
    // The subject pill yields first; the badge keeps its size.
    flexShrink: 0,
    marginLeft: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  assignmentBody: {
    padding: 14,
    gap: 10,
  },
  assignmentTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  assignmentDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
  },
  metaItem: {
    flex: 1,
    flexDirection: 'row',
  },
  metaLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginRight: 4,
  },
  metaValue: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '600',
    flex: 1,
  },
  infoBox: {
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#3B82F6',
    padding: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  infoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E40AF',
    marginBottom: 2,
  },
  infoSubtext: {
    fontSize: 12,
    color: '#3B82F6',
  },
  completeButton: {
    flexDirection: 'row',
    backgroundColor: '#10B981',
    margin: 14,
    marginTop: 0,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  completeButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  emptyHint: {
    marginTop: 8,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 18,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 50,
  },
  // Intern Mode — Study Videos summary strip above the task list.
  internTodaySummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 12,
    padding: 12,
    marginBottom: 4,
  },
  internTodayText: {
    flex: 1,
    fontSize: 13,
    color: '#0F766E',
  },
  internTodayBold: {
    fontWeight: '800',
    color: '#0d9488',
  },
  internTodayHint: {
    flex: 1,
    fontSize: 13,
    color: '#0F766E',
    fontStyle: 'italic',
  },
});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('mentorship')(StudentAssignments);
