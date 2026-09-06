import React from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { User, Clock, Phone, Mail, ShieldCheck, BadgeCheck } from 'lucide-react-native';
import { formatPercent } from '@/types/analytics';

// Row shape produced by backend/utils/guestAnalytics.js — admins only.
// email/emailVerified are null/false for legacy leads captured before the
// email-OTP switch; phoneVerified is true only for those legacy leads.
export interface GuestParticipant {
    attemptId: string;
    name: string;
    email: string | null;
    phoneMasked: string;
    score: number;
    totalQuestions: number;
    marksObtained: number;
    totalMarks: number;
    scorePercentage: number;
    correct: number;
    incorrect: number;
    skipped: number;
    attempted: number;
    accuracy: number;
    timeTakenSeconds: number;
    tabSwitchCount: number;
    status: string;
    submittedAt: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    marketingConsent: boolean;
}

interface GuestParticipantListProps {
    participants: GuestParticipant[];
    onParticipantClick: (attemptId: string) => void;
}

// Unranked public-quiz participant list — rendered for admins inside the
// existing Test Analytics tab. Guests never appear in the ranked
// StudentPerformanceList; this is their separate section.
export default function GuestParticipantList({ participants, onParticipantClick }: GuestParticipantListProps) {
    return (
        <View style={styles.container}>
            <Text style={styles.sectionTitle}>Public Participants ({participants.length})</Text>
            <View style={styles.card}>
                <FlatList
                    data={participants}
                    keyExtractor={(item) => item.attemptId}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={styles.item}
                            onPress={() => onParticipantClick(item.attemptId)}
                        >
                            <View style={styles.avatar}>
                                <User color="#D97706" size={20} />
                            </View>
                            <View style={styles.info}>
                                <View style={styles.nameRow}>
                                    <Text style={styles.name}>{item.name}</Text>
                                    <View style={styles.guestBadge}>
                                        <Text style={styles.guestBadgeText}>GUEST</Text>
                                    </View>
                                </View>
                                {item.email ? (
                                    <View style={styles.phoneRow}>
                                        <Mail color="#9CA3AF" size={11} />
                                        <Text style={styles.phone} numberOfLines={1} ellipsizeMode="tail">{item.email}</Text>
                                        {item.emailVerified ? (
                                            <BadgeCheck color="#10B981" size={12} />
                                        ) : null}
                                    </View>
                                ) : null}
                                <View style={styles.phoneRow}>
                                    <Phone color="#9CA3AF" size={11} />
                                    <Text style={styles.phone}>{item.phoneMasked}</Text>
                                    {item.phoneVerified ? (
                                        <BadgeCheck color="#10B981" size={12} />
                                    ) : null}
                                    {item.marketingConsent ? (
                                        <View style={styles.consentBadge}>
                                            <Text style={styles.consentText}>Consent</Text>
                                        </View>
                                    ) : null}
                                </View>
                                <View style={styles.scoreRow}>
                                    <Text style={[
                                        styles.score,
                                        item.scorePercentage >= 60 ? styles.passScore : styles.failScore
                                    ]}>
                                        {formatPercent(item.scorePercentage)}
                                    </Text>
                                    <Text style={styles.marks}>
                                        {item.marksObtained}/{item.totalMarks} marks
                                    </Text>
                                </View>
                                <Text style={styles.cws}>
                                    C {item.correct} / W {item.incorrect} / S {item.skipped}
                                    {' • '}Acc {formatPercent(item.accuracy, 'N/A')}
                                </Text>
                                <View style={styles.metaRow}>
                                    <View style={styles.timeContainer}>
                                        <Clock color="#9CA3AF" size={12} />
                                        <Text style={styles.time}>
                                            {Math.max(1, Math.round(item.timeTakenSeconds / 60))} min
                                        </Text>
                                    </View>
                                    <Text style={styles.date}>
                                        {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric'
                                        }) : '—'}
                                    </Text>
                                </View>
                            </View>
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <ShieldCheck color="#9CA3AF" size={40} />
                            <Text style={styles.emptyTitle}>No public participants yet</Text>
                            <Text style={styles.emptyText}>
                                Guests who attempt this quiz via a public link appear here.
                            </Text>
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
    item: {
        flexDirection: 'row',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        alignItems: 'flex-start',
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#FEF3C7',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    info: {
        flex: 1,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 3,
    },
    name: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
        flexShrink: 1,
    },
    guestBadge: {
        backgroundColor: '#FEF3C7',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    guestBadgeText: {
        fontSize: 9,
        fontWeight: '800',
        color: '#B45309',
        letterSpacing: 0.5,
    },
    phoneRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 5,
    },
    phone: {
        fontSize: 12,
        color: '#6B7280',
    },
    consentBadge: {
        backgroundColor: '#D1FAE5',
        borderRadius: 6,
        paddingHorizontal: 5,
        paddingVertical: 1,
        marginLeft: 2,
    },
    consentText: {
        fontSize: 9,
        fontWeight: '700',
        color: '#047857',
    },
    scoreRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 3,
    },
    score: {
        fontSize: 16,
        fontWeight: '700',
    },
    passScore: {
        color: '#10B981',
    },
    failScore: {
        color: '#EF4444',
    },
    marks: {
        fontSize: 13,
        color: '#6B7280',
    },
    cws: {
        fontSize: 12,
        color: '#6B7280',
        marginBottom: 2,
    },
    metaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 5,
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
        padding: 32,
        alignItems: 'center',
    },
    emptyTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#9CA3AF',
        marginTop: 10,
    },
    emptyText: {
        fontSize: 12,
        color: '#9CA3AF',
        marginTop: 4,
        textAlign: 'center',
    },
});
