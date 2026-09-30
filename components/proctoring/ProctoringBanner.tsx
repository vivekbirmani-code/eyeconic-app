/**
 * ProctoringBanner — the quiz-time technical-status banner (Phase 3, plan
 * §20.4's client-side "Camera problem detected" step). Display ONLY: it
 * reflects the engine's technical state; policy warnings (WARN/FINAL_WARN)
 * arrive from the server rules engine in a later phase. All copy comes from
 * utils/proctoringCopy.ts (D7 — no inline student-facing strings).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Video } from 'lucide-react-native';
import { PROCTORING_COPY } from '@/utils/proctoringCopy';
import type { ProctoringCameraIssue } from '@/services/proctoring/engine';

interface ProctoringBannerProps {
  cameraIssue: ProctoringCameraIssue;
}

export function ProctoringBanner({ cameraIssue }: ProctoringBannerProps) {
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
  icon: { marginTop: 2, marginRight: 8 },
  textWrap: { flex: 1 },
  title: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  body: { fontSize: 12, color: '#A16207', marginTop: 2, lineHeight: 16 },
});
