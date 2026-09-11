import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
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

// Matches the app's other motion timing (modals, sheets) — fast enough to
// feel instant, slow enough for the height change to read as intentional.
const TOGGLE_DURATION_MS = 220;
const TOGGLE_EASING = Easing.bezier(0.4, 0, 0.2, 1);

/**
 * Question-wise analytics table behind a collapse/expand control.
 *
 * Tests routinely carry 100+ questions; rendering every row inline pushed the
 * participant sections far below the fold. The section ships COLLAPSED by
 * default — this screen's primary job is reaching participant analytics —
 * and expands on demand with a measured-height animation (no layout jumps).
 * Content is only mounted while expanded, so a collapsed 100-question table
 * costs nothing to render.
 *
 * The animated height is a PURE function of (expanded, contentHeight) driven
 * by an effect — never by tap-time closures. That is the fix for the control
 * dying on large tests: with 100 rows the mount→measure window is long, and
 * a second tap (or a late onLayout) during it used to leave the section
 * wedged invisible. State-driven animation recovers from every interleaving.
 */
export default function QuestionAnalytics({ questions }: QuestionAnalyticsProps) {
    const [expanded, setExpanded] = useState(false);
    const [contentHeight, setContentHeight] = useState(0);
    const [contentMounted, setContentMounted] = useState(false);
    const heightAnim = useRef(new Animated.Value(0)).current;
    const chevronAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(chevronAnim, {
            toValue: expanded ? 1 : 0,
            duration: TOGGLE_DURATION_MS,
            easing: TOGGLE_EASING,
            useNativeDriver: true,
        }).start();

        if (expanded) {
            setContentMounted(true);
            if (contentHeight > 0) {
                Animated.timing(heightAnim, {
                    toValue: contentHeight,
                    duration: TOGGLE_DURATION_MS,
                    easing: TOGGLE_EASING,
                    useNativeDriver: false, // height is a layout property
                }).start();
            }
            // contentHeight === 0 → first expansion: the mount triggers an
            // onLayout, which sets contentHeight and re-runs this effect to
            // run the open animation.
            return;
        }

        Animated.timing(heightAnim, {
            toValue: 0,
            duration: TOGGLE_DURATION_MS,
            easing: TOGGLE_EASING,
            useNativeDriver: false,
        }).start(({ finished }) => {
            // Unmount only when the collapse actually completed — an
            // interrupted animation (quick re-toggle) keeps the content
            // alive so re-expanding is instant.
            if (finished) setContentMounted(false);
        });
    }, [expanded, contentHeight, heightAnim, chevronAnim]);

    const handleContentLayout = (event: LayoutChangeEvent) => {
        const height = event.nativeEvent.layout.height;
        // Zero-height layouts (initial pass, mid-collapse) are noise; a
        // repeated measurement must not restart a running animation.
        if (height > 0) {
            setContentHeight((prev) => (prev === height ? prev : height));
        }
    };

    const toggleExpanded = () => setExpanded((prev) => !prev);

    if (!questions || questions.length === 0) {
        return (
            <View style={styles.container}>
                <Text style={styles.sectionTitle}>Question-wise Analytics</Text>
                <Text style={styles.empty}>No question analytics available.</Text>
            </View>
        );
    }

    const sampleSize = questions[0]?.sampleSize ?? 0;

    const chevronRotate = chevronAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '180deg'],
    });

    // The question column is the flexible one — it absorbs leftover width on
    // larger devices; the fixed stat columns are guaranteed enough room for
    // their headers, so "CORRECT" can never break mid-word. When even the
    // minimums exceed the viewport, the table scrolls horizontally inside the
    // card (see DataTable).
    const columns: Array<DataTableColumn<QuestionAnalytic>> = [
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
    ];

    return (
        <View style={styles.container}>
            <TouchableOpacity
                style={styles.header}
                onPress={toggleExpanded}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`Question-wise Analytics, ${questions.length} questions`}
                accessibilityHint={expanded ? 'Collapses the question-wise table' : 'Expands the question-wise table'}
            >
                <Text style={styles.sectionTitle}>
                    Question-wise Analytics ({questions.length})
                </Text>
                <Animated.View style={styles.chevronWrap}>
                    <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
                        <ChevronDown color="#6B7280" size={22} />
                    </Animated.View>
                </Animated.View>
            </TouchableOpacity>
            {contentMounted ? (
                <Animated.View style={[styles.content, { height: heightAnim }]}>
                    <View onLayout={handleContentLayout} collapsable={false}>
                        <Text style={styles.note}>
                            Percentages are based on {sampleSize} completed attempt{sampleSize === 1 ? '' : 's'}.
                        </Text>
                        <DataTable
                            columns={columns}
                            data={questions}
                            keyExtractor={(item) => item.questionNumber.toString()}
                            cellPadding={16}
                            style={styles.card}
                        />
                    </View>
                </Animated.View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
        paddingVertical: 8,
        paddingRight: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1F2937',
        marginLeft: 16,
        marginRight: 8,
        flexShrink: 1,
    },
    chevronWrap: {
        padding: 4,
    },
    content: {
        overflow: 'hidden',
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
