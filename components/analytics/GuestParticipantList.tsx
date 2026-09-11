import React from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, DimensionValue } from 'react-native';
import { Clock, Phone, Mail, ShieldCheck, BadgeCheck, ChevronRight } from 'lucide-react-native';
import { formatPercent } from '@/types/analytics';

// Row shape produced by backend/utils/guestAnalytics.js — admins only.
// email/emailVerified are null/false for legacy leads captured before the
// email-OTP switch; phoneVerified is true only for those legacy leads.
// `phone` is the raw E.164 lead number included in admin analytics
// responses; `phoneMasked` is kept as a fallback for older payloads.
export interface GuestParticipant {
    attemptId: string;
    name: string;
    email: string | null;
    phone?: string;
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
    /** null when the guest attempted nothing (all skipped). */
    accuracy: number | null;
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

// Score coloring threshold shared across the analytics screens.
const PASS_THRESHOLD = 60;

const getInitials = (name: string): string => {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

// +919876543210 → "+91 98765 43210" — the full number, grouped for scanning.
const formatPhone = (phone: string): string => {
    const match = /^(\+91)(\d{5})(\d{5})$/.exec(phone);
    return match ? `${match[1]} ${match[2]} ${match[3]}` : phone;
};

const formatDuration = (seconds: number): string => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const minutes = Math.floor(total / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${total}s`;
};

const formatSubmittedAt = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

const formatMarksValue = (value: number): string => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return String(Number(num.toFixed(2)));
};

function ParticipantCard({
    participant,
    onPress,
}: {
    participant: GuestParticipant;
    onPress: () => void;
}) {
    const passed = participant.scorePercentage >= PASS_THRESHOLD;
    const scoreColor = passed ? '#10B981' : '#EF4444';
    const scoreBarWidth: DimensionValue = `${Math.max(0, Math.min(participant.scorePercentage, 100))}%`;
    // Full number for admins; masked form only as a legacy-payload fallback.
    const phoneDisplay = participant.phone
        ? formatPhone(participant.phone)
        : participant.phoneMasked && participant.phoneMasked !== '•••'
            ? participant.phoneMasked
            : '—';

    const stats = [
        { label: 'Correct', value: String(participant.correct), color: '#10B981' },
        { label: 'Wrong', value: String(participant.incorrect), color: '#EF4444' },
        { label: 'Skipped', value: String(participant.skipped), color: '#374151' },
        { label: 'Accuracy', value: formatPercent(participant.accuracy, '—'), color: '#1F2937' },
    ];

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
            {/* Identity + contact */}
            <View style={styles.header}>
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{getInitials(participant.name)}</Text>
                </View>
                <View style={styles.headerMain}>
                    <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={2}>{participant.name}</Text>
                        <View style={styles.guestBadge}>
                            <Text style={styles.guestBadgeText}>GUEST</Text>
                        </View>
                    </View>
                    {participant.email ? (
                        <View style={styles.contactRow}>
                            <Mail color="#9CA3AF" size={14} />
                            <Text style={styles.contactText} numberOfLines={1} ellipsizeMode="tail">
                                {participant.email}
                            </Text>
                            {participant.emailVerified ? (
                                <BadgeCheck color="#10B981" size={14} />
                            ) : null}
                        </View>
                    ) : null}
                    <View style={styles.contactRow}>
                        <Phone color="#9CA3AF" size={14} />
                        <Text style={styles.contactText} selectable>{phoneDisplay}</Text>
                        {participant.phoneVerified ? (
                            <BadgeCheck color="#10B981" size={14} />
                        ) : null}
                    </View>
                    <View style={[
                        styles.consentPill,
                        participant.marketingConsent ? styles.consentGranted : styles.consentNone,
                    ]}>
                        <ShieldCheck
                            color={participant.marketingConsent ? '#047857' : '#6B7280'}
                            size={12}
                        />
                        <Text style={[
                            styles.consentText,
                            participant.marketingConsent ? styles.consentGrantedText : styles.consentNoneText,
                        ]}>
                            {participant.marketingConsent ? 'Consent given' : 'No consent'}
                        </Text>
                    </View>
                </View>
                <ChevronRight color="#D1D5DB" size={20} style={styles.chevron} />
            </View>

            {/* Score — the card's anchor */}
            <View style={styles.scoreBand}>
                <View style={styles.scoreRow}>
                    <Text style={[styles.scoreValue, { color: scoreColor }]}>
                        {formatPercent(participant.scorePercentage)}
                    </Text>
                    <Text style={styles.marksText}>
                        {formatMarksValue(participant.marksObtained)}
                        {' / '}
                        {formatMarksValue(participant.totalMarks)}
                        {' marks'}
                    </Text>
                </View>
                <View style={styles.scoreTrack}>
                    <View style={[styles.scoreFill, { width: scoreBarWidth, backgroundColor: scoreColor }]} />
                </View>
            </View>

            {/* Question statistics */}
            <View style={styles.statRow}>
                {stats.map((stat, index) => (
                    <View key={stat.label} style={[styles.statCell, index > 0 ? styles.statCellDivider : null]}>
                        <Text style={[styles.statValue, { color: stat.color }]} numberOfLines={1}>
                            {stat.value}
                        </Text>
                        <Text style={styles.statLabel} numberOfLines={1}>{stat.label}</Text>
                    </View>
                ))}
            </View>

            {/* Submission meta */}
            <View style={styles.metaRow}>
                <View style={styles.timeWrap}>
                    <Clock color="#9CA3AF" size={13} />
                    <Text style={styles.timeText}>{formatDuration(participant.timeTakenSeconds)}</Text>
                </View>
                <Text style={styles.submittedText} numberOfLines={1} ellipsizeMode="tail">
                    Submitted {formatSubmittedAt(participant.submittedAt)}
                </Text>
            </View>
        </TouchableOpacity>
    );
}

// Unranked public-quiz participant list — rendered for admins inside the
// existing Test Analytics tab. Guests never appear in the ranked
// StudentPerformanceList; this is their separate section. Tapping a card
// opens the same attempt detail the registered-student rows use.
export default function GuestParticipantList({ participants, onParticipantClick }: GuestParticipantListProps) {
    return (
        <View style={styles.container}>
            <Text style={styles.sectionTitle}>Public Participants ({participants.length})</Text>
            <FlatList
                data={participants}
                keyExtractor={(item) => item.attemptId}
                renderItem={({ item }) => (
                    <ParticipantCard
                        participant={item}
                        onPress={() => onParticipantClick(item.attemptId)}
                    />
                )}
                ListEmptyComponent={
                    <View style={styles.emptyCard}>
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
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        overflow: 'hidden',
    },

    // Identity + contact
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 14,
        gap: 12,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#FEF3C7',
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#B45309',
    },
    headerMain: {
        flex: 1,
        gap: 6,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    name: {
        fontSize: 16,
        fontWeight: '700',
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
    contactRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    contactText: {
        fontSize: 13,
        color: '#374151',
        flexShrink: 1,
        lineHeight: 18,
    },
    consentPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    consentGranted: {
        backgroundColor: '#D1FAE5',
    },
    consentNone: {
        backgroundColor: '#F3F4F6',
    },
    consentText: {
        fontSize: 11,
        fontWeight: '600',
    },
    consentGrantedText: {
        color: '#047857',
    },
    consentNoneText: {
        color: '#6B7280',
    },
    chevron: {
        alignSelf: 'center',
    },

    // Score band
    scoreBand: {
        backgroundColor: '#F9FAFB',
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 8,
    },
    scoreRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
    },
    scoreValue: {
        fontSize: 26,
        fontWeight: '800',
        lineHeight: 30,
    },
    marksText: {
        fontSize: 13,
        color: '#6B7280',
        paddingBottom: 4,
    },
    scoreTrack: {
        height: 6,
        borderRadius: 3,
        backgroundColor: '#E5E7EB',
        overflow: 'hidden',
    },
    scoreFill: {
        height: 6,
        borderRadius: 3,
    },

    // Question statistics
    statRow: {
        flexDirection: 'row',
        paddingVertical: 10,
        paddingHorizontal: 6,
    },
    statCell: {
        flex: 1,
        alignItems: 'center',
        gap: 2,
    },
    statCellDivider: {
        borderLeftWidth: 1,
        borderLeftColor: '#F3F4F6',
    },
    statValue: {
        fontSize: 15,
        fontWeight: '700',
    },
    statLabel: {
        fontSize: 11,
        color: '#9CA3AF',
    },

    // Submission meta
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    timeWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        flexShrink: 0,
    },
    timeText: {
        fontSize: 12,
        color: '#6B7280',
        fontWeight: '500',
    },
    submittedText: {
        fontSize: 12,
        color: '#9CA3AF',
        flexShrink: 1,
        textAlign: 'right',
    },

    // Empty state
    emptyCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        marginHorizontal: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        padding: 32,
        alignItems: 'center',
    },
    emptyTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#6B7280',
        marginTop: 10,
    },
    emptyText: {
        fontSize: 12,
        color: '#9CA3AF',
        marginTop: 4,
        textAlign: 'center',
    },
});
