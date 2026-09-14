import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { DataTable, DataTableColumn } from '@/components/DataTable';

interface QuestionAnalytic {
    questionNumber: number;
    questionText: string;
    topicName?: string;
    percentCorrect: number;
    percentWrong: number;
    percentSkipped: number;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    sampleSize?: number;
}

interface QuestionAnalyticsProps {
    questions: QuestionAnalytic[];
}

// LayoutAnimation needs a one-time opt-in on Android (iOS + web are no-ops /
// enabled by default).
if (Platform.OS === 'android') {
    UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const CHEVRON_DURATION_MS = 200;

/**
 * Rows mounted per "page". A 100-question test no longer mounts every row
 * (≈800 native views) in the single commit that expand/collapse animates —
 * that commit size was the lag — and the expanded section no longer demands
 * scrolling past all 100 rows to reach the participant lists.
 */
const PAGE_SIZE = 20;

// Snappier than the stock 300ms easeInEaseOut preset; the create/delete
// opacity property makes newly mounted rows fade in instead of popping.
const EXPAND_ANIMATION = LayoutAnimation.create(
    220,
    LayoutAnimation.Types.easeInEaseOut,
    LayoutAnimation.Properties.opacity
);

/**
 * Question-wise analytics table behind a collapse/expand control.
 *
 * Expanded content is rendered UNCONDITIONALLY while expanded — visibility
 * never depends on a measured/animated height, so the section can never sit
 * "expanded but invisible" (the failure mode of the previous height-animation
 * implementation, which wedged when the mount→measure chain was slow or
 * interrupted on 100-question tests). The open/close motion is the NATIVE
 * LayoutAnimation: smooth, UI-thread, zero height bookkeeping, and collapse
 * unmounts the rows entirely so the section is fully gone.
 *
 * Rows are paged (PAGE_SIZE per reveal): "Show more" appends a page, "Show
 * all" is the escape hatch for scanning a whole test, "Show less" drops back
 * to one page. Every reveal is animated, so content below the table slides
 * instead of jumping.
 *
 * The section ships EXPANDED by default — question analytics is primary
 * content; collapsing is for shortening the scroll to the participant lists.
 */
function QuestionAnalytics({ questions }: QuestionAnalyticsProps) {
    const [expanded, setExpanded] = useState(true);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const chevronAnim = useRef(new Animated.Value(1)).current;

    const total = questions?.length ?? 0;

    useEffect(() => {
        Animated.timing(chevronAnim, {
            toValue: expanded ? 1 : 0,
            duration: CHEVRON_DURATION_MS,
            useNativeDriver: true,
        }).start();
    }, [expanded, chevronAnim]);

    // Selecting a different test swaps the questions array — restart paging
    // so the new test opens on a single page.
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [questions]);

    // Every visibility change animates natively: the table's appearance and
    // everything below it sliding up/down.
    const withSectionAnimation = (mutate: () => void) => {
        LayoutAnimation.configureNext(EXPAND_ANIMATION);
        mutate();
    };

    const toggleExpanded = () =>
        withSectionAnimation(() => setExpanded((prev) => !prev));

    const showMore = () =>
        withSectionAnimation(() =>
            setVisibleCount((count) => Math.min(count + PAGE_SIZE, total))
        );

    const showAll = () => withSectionAnimation(() => setVisibleCount(total));

    const showLess = () =>
        withSectionAnimation(() => setVisibleCount(PAGE_SIZE));

    const visibleQuestions = useMemo(
        () => (questions ?? []).slice(0, visibleCount),
        [questions, visibleCount]
    );

    const chevronRotate = chevronAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '180deg'],
    });

    // The question column is the flexible one — it absorbs leftover width on
    // larger devices; the fixed stat columns are guaranteed enough room for
    // their headers, so "CORRECT" can never break mid-word. When even the
    // minimums exceed the viewport, the table scrolls horizontally inside the
    // card (see DataTable).
    const columns: DataTableColumn<QuestionAnalytic>[] = useMemo(
        () => [
            {
                key: 'question',
                header: 'Question',
                width: 110,
                grow: true,
                renderCell: (item) => (
                    <View>
                        <Text style={styles.questionNumber}>Q{item.questionNumber}</Text>
                        {item.topicName ? (
                            <Text style={styles.topicName} numberOfLines={2}>
                                {item.topicName}
                            </Text>
                        ) : null}
                        <Text style={styles.counts} numberOfLines={1}>
                            {item.correctCount}C • {item.wrongCount}W • {item.skippedCount}S
                        </Text>
                    </View>
                ),
            },
            {
                key: 'correct',
                header: 'Correct',
                width: 60,
                align: 'center',
                renderCell: (item) => (
                    <Text style={[styles.percentText, styles.correctText]} numberOfLines={1}>
                        {item.percentCorrect}%
                    </Text>
                ),
            },
            {
                key: 'wrong',
                header: 'Wrong',
                width: 60,
                align: 'center',
                renderCell: (item) => (
                    <Text style={[styles.percentText, styles.wrongText]} numberOfLines={1}>
                        {item.percentWrong}%
                    </Text>
                ),
            },
            {
                key: 'skip',
                header: 'Skip',
                width: 60,
                align: 'center',
                renderCell: (item) => (
                    <Text style={[styles.percentText, styles.skippedText]} numberOfLines={1}>
                        {item.percentSkipped}%
                    </Text>
                ),
            },
        ],
        []
    );

    if (!questions || questions.length === 0) {
        return (
            <View style={styles.container}>
                <Text style={styles.sectionTitle}>Question-wise Analytics</Text>
                <Text style={styles.empty}>No question analytics available.</Text>
            </View>
        );
    }

    const sampleSize = questions[0]?.sampleSize ?? 0;
    const remaining = total - visibleCount;
    const showAllEnabled = remaining > PAGE_SIZE;

    return (
        <View style={styles.container}>
            {/* Full-width, full-height-of-row touch target — the whole header
                (title, count badge, chevron) is one button. */}
            <TouchableOpacity
                style={styles.header}
                onPress={toggleExpanded}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`Question-wise Analytics, ${total} questions`}
                accessibilityHint={expanded ? 'Collapses the question-wise table' : 'Expands the question-wise table'}
            >
                <View style={styles.headerLeft}>
                    <Text style={styles.sectionTitle}>Question-wise Analytics</Text>
                    <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{total}</Text>
                    </View>
                </View>
                <View style={styles.chevronBadge}>
                    <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
                        <ChevronDown color="#6B7280" size={20} />
                    </Animated.View>
                </View>
            </TouchableOpacity>
            {expanded ? (
                <View>
                    <Text style={styles.note}>
                        Percentages are based on {sampleSize} completed attempt{sampleSize === 1 ? '' : 's'}.
                    </Text>
                    <DataTable
                        columns={columns}
                        data={visibleQuestions}
                        keyExtractor={(item) => item.questionNumber.toString()}
                        cellPadding={16}
                        style={styles.card}
                    />
                    {total > PAGE_SIZE ? (
                        <View style={styles.pagingRow}>
                            <Text style={styles.pagingLabel}>
                                {visibleCount >= total
                                    ? `Showing all ${total} questions`
                                    : `Showing ${visibleCount} of ${total}`}
                            </Text>
                            <View style={styles.pagingButtons}>
                                {remaining > 0 ? (
                                    <>
                                        <TouchableOpacity
                                            style={styles.pagingButtonPrimary}
                                            onPress={showMore}
                                            activeOpacity={0.7}
                                            accessibilityLabel={`Show ${Math.min(PAGE_SIZE, remaining)} more questions`}
                                        >
                                            <Text style={styles.pagingButtonTextPrimary}>
                                                Show {Math.min(PAGE_SIZE, remaining)} more
                                            </Text>
                                        </TouchableOpacity>
                                        {showAllEnabled ? (
                                            <TouchableOpacity
                                                style={styles.pagingButtonSecondary}
                                                onPress={showAll}
                                                activeOpacity={0.7}
                                                accessibilityLabel={`Show all ${total} questions`}
                                            >
                                                <Text style={styles.pagingButtonTextSecondary}>
                                                    Show all
                                                </Text>
                                            </TouchableOpacity>
                                        ) : null}
                                    </>
                                ) : (
                                    <TouchableOpacity
                                        style={styles.pagingButtonSecondary}
                                        onPress={showLess}
                                        activeOpacity={0.7}
                                        accessibilityLabel="Show fewer questions"
                                    >
                                        <Text style={styles.pagingButtonTextSecondary}>
                                            Show less
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

// Memoized so parent re-renders (live leaderboard refreshes, tab state, etc.)
// never re-diff every mounted row — only a changed `questions` array does.
export default React.memo(QuestionAnalytics);

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexShrink: 1,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1F2937',
        flexShrink: 1,
    },
    countBadge: {
        backgroundColor: '#E0FBF9',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    countBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#01b4ae',
    },
    chevronBadge: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#F3F4F6',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    note: {
        fontSize: 12,
        color: '#6B7280',
        marginHorizontal: 16,
        marginBottom: 12,
    },
    empty: {
        color: '#9CA3AF',
        textAlign: 'center',
        marginHorizontal: 16,
    },
    card: {
        marginHorizontal: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    pagingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        marginHorizontal: 16,
        marginTop: 12,
    },
    pagingLabel: {
        fontSize: 12,
        color: '#6B7280',
    },
    pagingButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    pagingButtonPrimary: {
        backgroundColor: '#01b4ae',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 40,
        justifyContent: 'center',
    },
    pagingButtonSecondary: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 40,
        justifyContent: 'center',
    },
    pagingButtonTextPrimary: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '700',
    },
    pagingButtonTextSecondary: {
        color: '#374151',
        fontSize: 13,
        fontWeight: '600',
    },
    questionNumber: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1F2937',
    },
    topicName: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    counts: {
        fontSize: 11,
        color: '#9CA3AF',
        marginTop: 4,
    },
    percentText: {
        fontSize: 14,
        fontWeight: '600',
    },
    correctText: {
        color: '#10B981',
    },
    wrongText: {
        color: '#EF4444',
    },
    skippedText: {
        color: '#9CA3AF',
    },
});
