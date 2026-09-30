/**
 * ProctoringBanner — the quiz-time proctoring banner (Phase 3 technical
 * states + Phase 6 server-decided policy warnings, plan §20.2/§20.3).
 * Display ONLY: the technical variant reflects the engine's camera state; the
 * warning variant renders the server rules engine's WARN/FINAL_WARN decisions
 * verbatim from the centralized copy (the client never derives its own
 * warnings). All copy comes from utils/proctoringCopy.ts (D7 — no inline
 * student-facing strings).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Video, AlertTriangle } from 'lucide-react-native';
import { PROCTORING_COPY } from '@/utils/proctoringCopy';
import type { ProctoringCameraIssue } from '@/services/proctoring/engine';
import type { ProctoringServerAction } from '@/hooks/useProctoringSession';

interface ProctoringBannerProps {
  cameraIssue: ProctoringCameraIssue;
  /** Latest server policy warning (WARN auto-dismisses; FINAL_WARN persists). */
  warning?: ProctoringServerAction | null;
}

export function ProctoringBanner({ cameraIssue, warning }: ProctoringBannerProps) {
  // Policy warnings take precedence over the technical banner — the student
  // must never miss a FINAL_WARN behind a camera advisory.
  if (warning) {
    const copy = PROCTORING_COPY.warnings.byCode[warning.code]
      ?? PROCTORING_COPY.warnings.byCode['warn.focus'];
    const isFinal = warning.kind === 'FINAL_WARN';
    return (
      <View
        style={[styles.banner, isFinal ? styles.finalBanner : styles.warnBanner]}
        accessibilityLabel={`${copy.title}. ${copy.body}`}
        accessibilityRole="alert"
      >
        <AlertTriangle color={isFinal ? '#B91C1C' : '#B45309'} size={16} style={styles.icon} />
        <View style={styles.textWrap}>
          <Text style={[styles.title, isFinal ? styles.finalTitle : styles.warnTitle]}>
            {copy.title}
          </Text>
          <Text style={[styles.body, isFinal ? styles.finalBody : styles.warnBody]}>
            {copy.body}
          </Text>
        </View>
      </View>
    );
  }

  if (!cameraIssue) return null;

  const copy = PROCTORING_COPY.monitoring;
  const title = copy.bannerTitles[cameraIssue];
  const body = copy.bannerBodies[cameraIssue];

  return (
    <View
      style={styles.banner}
      accessibilityLabel={`${title}. ${body}`}
      accessibilityRole="alert"
    >
      <Video color="#B45309" size={16} style={styles.icon} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginTop: 6,
  },
  warnBanner: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  finalBanner: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
  },
  icon: { marginTop: 2, marginRight: 8 },
  textWrap: { flex: 1 },
  title: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  body: { fontSize: 12, color: '#A16207', marginTop: 2, lineHeight: 16 },
  warnTitle: { color: '#92400E' },
  warnBody: { color: '#A16207' },
  finalTitle: { color: '#B91C1C' },
  finalBody: { color: '#B91C1C' },
});
