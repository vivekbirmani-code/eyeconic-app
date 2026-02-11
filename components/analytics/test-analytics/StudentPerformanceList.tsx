import React from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { User, Clock } from 'lucide-react-native';

interface Student {
    _id: string;
    name: string;
    email: string;
}

interface StudentPerformance {
    _id: string;
    student: Student;
    score: number;
    totalQuestions: number;
    marksObtained: number;
    totalMarks: number;
    percentage: number;
    timeSpent: number;
    completedAt: string;
    tabSwitchCount: number;
}

interface StudentPerformanceListProps {
    students: StudentPerformance[];
    onStudentClick: (attemptId: string) => void;
}

export default function StudentPerformanceList({ students, onStudentClick }: StudentPerformanceListProps) {
    return (
        <View style={styles.container}>
            <Text style={styles.sectionTitle}>Student Performance ({students.length})</Text>
            <View style={styles.card}>
                <FlatList
                    data={students}
                    keyExtractor={(item) => item._id}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={styles.studentItem}
                            onPress={() => onStudentClick(item._id)}
                        >
                            <View style={styles.avatar}>
                                <User color="#6B7280" size={20} />
                            </View>
                            <View style={styles.studentInfo}>
                                <Text style={styles.studentName}>{item.student.name}</Text>
                                <View style={styles.metaRow}>
                                    <View style={styles.scoreContainer}>
                                        <Text style={[
                                            styles.score,
                                            item.percentage >= 60 ? styles.passScore : styles.failScore
                                        ]}>
                                            {item.marksObtained}/{item.totalMarks}
                                        </Text>
                                        <Text style={styles.percentage}>({item.percentage}%)</Text>
                                    </View>
                                    <View style={styles.timeContainer}>
                                        <Clock color="#9CA3AF" size={12} />
                                        <Text style={styles.time}>{item.timeSpent} min</Text>
                                    </View>
                                </View>
                                <Text style={styles.date}>
                                    {new Date(item.completedAt).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric'
                                    })}
                                </Text>
                            </View>
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <User color="#9CA3AF" size={48} />
                            <Text style={styles.emptyText}>No attempts yet</Text>
                        </View>
                    }
                    scrollEnabled={false}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1F2937',
        marginHorizontal: 16,
        marginBottom: 12,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        marginHorizontal: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        overflow: 'hidden',
    },
    studentItem: {
        flexDirection: 'row',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        alignItems: 'center',
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#F3F4F6',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    studentInfo: {
        flex: 1,
    },
    studentName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
        marginBottom: 4,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 4,
    },
    scoreContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    score: {
        fontSize: 15,
        fontWeight: '600',
    },
    passScore: {
        color: '#10B981',
    },
    failScore: {
        color: '#EF4444',
    },
    percentage: {
        fontSize: 13,
        color: '#6B7280',
    },
    timeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    time: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    date: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 16,
        color: '#9CA3AF',
        marginTop: 12,
    },
});
