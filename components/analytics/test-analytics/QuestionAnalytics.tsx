import React, { useEffect, useRef, useState } from 'react';
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
 * The section ships EXPANDED by default — question analytics is primary
 * content; collapsing is for shortening the scroll to the participant lists.
 */
export default function QuestionAnalytics({ questions }: QuestionAnalyticsProps) {
    const [expanded, setExpanded] = useState(true);
    const chevronAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.timing(chevronAnim, {
            toValue: expanded ? 1 : 0,
            duration: CHEVRON_DURATION_MS,
            useNativeDriver: true,
        }).start();
    }, [expanded, chevronAnim]);

    const toggleExpanded = () => {
        // Animates this layout change natively: the table's appearance and
        // everything below it sliding up/down.
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((prev) => !prev);
    };

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
            {expanded ? (
                <View>
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
