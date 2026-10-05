import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Share, StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  Award,
  Check,
  Copy,
  Info,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  Layers,
  Zap,
  User,
} from 'lucide-react-native';
import type {
  DesiredBranchResponse,
  DesiredBranchResult as DesiredResultData,
  DesiredGapStatus,
} from '@/types/predictor';
import {
  ASSUMPTION_TEXT,
  DESIRED_WARNING_SHORT,
  DISCLAIMER_NOTE,
  DUPLICATED_ENGINE_NOTES,
  EXAM_LABELS,
  GAP_META,
  TARGET_COVERAGE_TEXT,
} from '@/utils/predictor/constants';
import { buildDesiredShareText } from '@/utils/predictor/summary';
import { fmtRank, yearFilterLabel } from '@/utils/predictor/format';

/**
 * Desired Branch Predictor result — native port of the website's
 * DesiredBranchResult (DBP §8 Phase 6): branch → the rank it historically
 * took (per-cycle table + D1 range) → required corrects (safe/likely ends,
 * bounded states honest) → the D7 gap panel. Same result-page grammar as
 * PredictResult and the same honesty rules: ranges never points, bounded
 * ends say so, no confidence percentages (§11/§14).
 */

const logPos = (value: number, min: number, max: number): number => {
  if (value <= min) return 0;
  if (value >= max) return 100;
  return ((Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 100;
};

const fmtCorrects = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-IN');

/** Cycle label: "Jan 2025" for INI-CET sessions, "2025" for NEET PG years. */
const cycleLabel = (year: number, session?: string) =>
  session ? yearFilterLabel(Number(session.replace('-', ''))) : yearFilterLabel(year);

// ---- hero cards -----------------------------------------------------------------

function TargetRankCard({ result }: { result: DesiredResultData }) {
  const t = result.target;
  const isIniCet = result.exam === 'INI_CET';
  const [tight, loose] = t.targetRankRange ?? [null, null];

  // Log axis anchored to the range itself (same honesty rule as the forward
  // RankCard: communicates relative width, claims no external scale).
  const axisMax = loose ?? (tight ? tight * 2 : null);
  const segLeft = tight && axisMax ? logPos(tight, 1, axisMax) : 0;
  const segWidth = axisMax ? Math.max(2, 100 - segLeft) : 0;

  const source = isIniCet
    ? `AIIMS counselling · ${t.years.length} sessions`
    : `MCC counselling ${t.dataCoverage.years.join(' · ')}`;

  const tightShown = tight === null ? null : Math.max(1, Math.round(tight));
  const looseShown =
    loose === null ? null : Math.max(tightShown ?? 1, Math.round(loose));

  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardLabel}>The rank it historically took</Text>
        <View style={styles.sourceChip}>
          <Text style={styles.sourceChipText}>{source}</Text>
        </View>
      </View>
      <View style={styles.bigNumberRow}>
        <Text style={styles.bigNumber}>{fmtRank(tightShown)}</Text>
        <Text style={styles.bigNumberDash}>–</Text>
        <Text style={styles.bigNumber}>{fmtRank(looseShown)}</Text>
      </View>
      <View style={styles.track}>
        {axisMax ? (
          <>
            <View style={[styles.trackSegment, { left: `${segLeft}%`, width: `${segWidth}%` }]} />
            <View style={[styles.trackTick, { left: `${Math.min(97, (segLeft + segWidth) / 2)}%` }]} />
          </>
        ) : (
          <View style={[styles.trackFaded, { left: `${segLeft}%`, right: 0 }]} />
        )}
      </View>
      {/* D2 consequence, surfaced: a branch-only range spans institutes — the
          ends NAME the institutes that produced them. */}
      <View style={styles.instituteLines}>
        {t.tightest ? (
          <Text style={styles.instituteLine} numberOfLines={1}>
            Tightest: {t.tightest.institute} ({cycleLabel(t.tightest.year, t.tightest.session)})
          </Text>
        ) : null}
        {t.loosest ? (
          <Text style={styles.instituteLine} numberOfLines={1}>
            Loosest: {t.loosest.institute} ({cycleLabel(t.loosest.year, t.loosest.session)})
          </Text>
        ) : null}
      </View>
      <View style={styles.coverageRow}>
        <Info size={13} color="#01b4ae" />
        <Text style={styles.coverageText}>
          {TARGET_COVERAGE_TEXT[t.coverage] ?? ''} Final state of counselling (end of all rounds).
        </Text>
      </View>
    </View>
  );
}

function RequiredCard({ result }: { result: DesiredResultData }) {
  const required = result.required;
  const safe = required?.perClosing[0];
  const likely = required?.perClosing[1];
  const isIniCet = result.exam === 'INI_CET';

  if (!required) return null;

  // Corrects live on their true axis — the exam pattern's question count
  // (180 for NEET PG, 200 for INI-CET), from the result's pattern echo.
  const total = result.method.pattern?.totalQuestions ?? (isIniCet ? 200 : 180);
  const lo = likely?.corrects ?? null;
  const hi = safe?.corrects ?? null;
  const left = lo === null ? 0 : Math.max(0, (lo / total) * 100);
  const width = hi === null ? Math.max(2, 100 - left) : Math.max(0.75, ((hi - (lo ?? 0)) / total) * 100);

  const source = isIniCet
    ? `Crowd ladder (UR-only) · ${required.prior?.points ?? 7} points`
    : 'Official NBEMS score↔rank data';

  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardLabel}>Corrects to aim for</Text>
        <View style={styles.sourceChip}>
          <Text style={styles.sourceChipText}>{source}</Text>
        </View>
      </View>
      <View style={styles.bigNumberRow}>
        {hi === null ? (
          <Text style={styles.bigNumberBeyond}>beyond the data</Text>
        ) : (
          <Text style={styles.bigNumber}>≈ {fmtCorrects(Math.round(hi))}</Text>
        )}
        <Text style={styles.bigNumberSuffix}> safe end</Text>
      </View>
      <Text style={styles.likelyLine}>
        {lo === null ? '—' : `≈ ${fmtCorrects(Math.round(lo))}`}{' '}
        <Text style={styles.likelySuffix}>historically enough (likely end)</Text>
      </Text>
      <View style={styles.track}>
        <View
          style={[
            styles.trackSegment,
            { left: `${left}%`, width: `${width}%` },
            ...(hi === null ? [styles.trackSegmentFade] : []),
          ]}
        />
        {hi !== null ? (
          <View style={[styles.trackTick, { left: `${Math.min(99, left + width / 2)}%` }]} />
        ) : null}
      </View>
      <View style={styles.axisLabels}>
        <Text style={styles.axisLabelText}>0</Text>
        <Text style={styles.axisLabelText}>{Math.round(total / 2)}</Text>
        <Text style={styles.axisLabelText}>{total}</Text>
      </View>
      <View style={styles.coverageRow}>
        <Info size={13} color="#01b4ae" />
        <Text style={styles.coverageText}>
          The safe end clears even the tightest closing on record; the likely end cleared the
          loosest. Rounding is always upward — fractional corrects are never shown as achievable.
        </Text>
      </View>
      {/* bounded ends carry their statements (never silently dropped); keyed
          by index — a single-group branch can close both ends at one rank */}
      {required.perClosing
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.note)
        .map(({ e, i }) => (
          <View key={i} style={styles.boundedNoteBox}>
            <AlertTriangle size={12} color="#F59E0B" />
            <Text style={styles.boundedNoteText}>{e.note}</Text>
          </View>
        ))}
    </View>
  );
}

// ---- gap panel (D7) --------------------------------------------------------------

/** Status-tinted panel styles (called at render — after `styles` exists). */
function gapPanelStyles(status: DesiredGapStatus): {
  box: StyleProp<ViewStyle>;
  text: StyleProp<TextStyle>;
  strong: StyleProp<TextStyle>;
} {
  switch (status) {
    case 'ON_TRACK':
      return {
        box: styles.gapPanelOnTrack,
        text: styles.gapTextOnTrack,
        strong: styles.gapStrongOnTrack,
      };
    case 'WITHIN_REACH':
      return {
        box: styles.gapPanelWithinReach,
        text: styles.gapTextWithinReach,
        strong: styles.gapStrongWithinReach,
      };
    case 'BELOW_TARGET':
      return {
        box: styles.gapPanelBelowTarget,
        text: styles.gapTextBelowTarget,
        strong: styles.gapStrongBelowTarget,
      };
    default:
      return {
        box: styles.gapPanelNoData,
        text: styles.gapTextNoData,
        strong: styles.gapStrongNoData,
      };
  }
}

function GapPanel({ result, onBack }: { result: DesiredResultData; onBack: () => void }) {
  const gap = result.gap;
  if (!gap) return null;
  const meta = GAP_META[gap.status] ?? GAP_META.NO_CURRENT_DATA;
  const panel = gapPanelStyles(gap.status);

  const gapSentence = (delta: number | null, end: 'safe' | 'likely', bounded: boolean) => {
    if (delta === null) {
      return bounded
        ? `The ${end} end is beyond what the data can state — no number is invented for it.`
        : null;
    }
    const abs = Math.abs(delta).toLocaleString('en-IN');
    const sign = delta >= 0 ? 'ahead by' : 'to go to';
    const target = end === 'safe' ? 'the safe end' : 'the likely end';
    return `${sign} ≈ ${abs} corrects ${delta >= 0 ? `(${target} cleared)` : `(${target})`}`;
  };

  const likelySentence = gapSentence(gap.gapToLikely, 'likely', gap.bounded.likely);
  const safeSentence = gapSentence(gap.gapToSafe, 'safe', gap.bounded.safe);

  return (
    <View style={[styles.gapPanel, panel.box]}>
      <View style={styles.gapLabelRow}>
        <View style={[styles.gapDot, { backgroundColor: meta.color }]} />
        <Text style={[styles.gapLabel, panel.strong]}>{meta.label}</Text>
      </View>
      {result.current ? (
        <Text style={panel.text}>
          Your average: <Text style={panel.strong}>{fmtCorrects(result.current.meanCorrects)}</Text>{' '}
          corrects across {result.current.aggregation.n} Grand Test
          {result.current.aggregation.n === 1 ? '' : 's'}
        </Text>
      ) : null}
      {likelySentence ? <Text style={panel.text}>{likelySentence}</Text> : null}
      {safeSentence ? <Text style={panel.text}>{safeSentence}</Text> : null}
      <Text style={[styles.gapHint, panel.text]}>{meta.hint}</Text>
      {gap.status === 'NO_CURRENT_DATA' ? (
        <TouchableOpacity style={styles.gapBackButton} onPress={onBack} activeOpacity={0.7}>
          <ArrowLeft size={12} color="#374151" />
          <Text style={styles.gapBackButtonText}>Add your Grand Tests</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ---- per-cycle closing table ------------------------------------------------------

function CycleTable({ result }: { result: DesiredResultData }) {
  const t = result.target;
  const isIniCet = result.exam === 'INI_CET';
  const cycleWord = isIniCet ? 'Session' : 'Year';

  return (
    <View style={styles.card}>
      <View style={styles.cycleHeaderRow}>
        <Text style={styles.cycleTitle}>Closing ranks by {cycleWord.toLowerCase()}</Text>
        <Text style={styles.cycleHeaderChip}>Final state of counselling</Text>
      </View>
      <Text style={styles.cycleExplainer}>
        Each {cycleWord.toLowerCase()} below is one counselling cycle. Cutoffs move every year —
        this is the spread your target range comes from.
      </Text>
      <View style={{ gap: 8 }}>
        {t.years.map((y) => (
          <View key={y.year} style={styles.cycleRow}>
            <View style={styles.cycleRowTop}>
              <Text style={styles.cycleRowLabel}>{cycleLabel(y.year, y.session)}</Text>
              <Text style={styles.cycleRowValue}>
                {y.matched
                  ? `${fmtRank(y.closingMin)} – ${fmtRank(y.closingMax)}`
                  : y.present
                    ? '— no data for your selection'
                    : 'not offered'}
              </Text>
            </View>
            {y.tightest ? (
              <Text style={styles.cycleRowTightest} numberOfLines={1}>
                Tightest: {y.tightest.institute}
                {y.matched ? ` · ${y.groups} groups` : ''}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---- methodology ------------------------------------------------------------------

function DesiredMethodology({ result }: { result: DesiredResultData }) {
  const [open, setOpen] = useState(false);
  const isIniCet = result.exam === 'INI_CET';

  const notes = useMemo(() => {
    const seen = new Set<string>();
    const collect = (list: string[]) =>
      list.filter((note) => {
        if (DUPLICATED_ENGINE_NOTES.includes(note) || seen.has(note)) return false;
        seen.add(note);
        return true;
      });
    return [
      ...collect(result.target.notes || []),
      ...(result.required ? collect(result.required.notes || []) : []),
      ...collect((result.warnings || []).map((w) => w.note)),
    ];
  }, [result]);

  const assumptions = (result.method.assumptions || [])
    .map((id) => ASSUMPTION_TEXT[id])
    .filter((text): text is string => Boolean(text));

  const cycles = result.target.years.map((y) => cycleLabel(y.year, y.session)).join(' · ');

  return (
    <View style={styles.methodologyCard}>
      <TouchableOpacity
        style={styles.methodologyHeader}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        accessibilityLabel="How this target was worked out"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.methodologyHeaderRow}>
          <Layers size={15} color="#01b4ae" />
          <Text style={styles.methodologyHeaderText}>How this target was worked out</Text>
        </View>
        <ChevronDown
          size={16}
          color="#6B7280"
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.methodologyBody}>
          {assumptions.length ? (
            <View style={styles.methodologySection}>
              <Text style={styles.sectionLabel}>ASSUMPTIONS</Text>
              {assumptions.map((text) => (
                <View key={text} style={styles.bulletRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.sectionText}>{text}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.methodologySection}>
            <Text style={styles.sectionLabel}>DATA THIS RAN AGAINST</Text>
            <View style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.sectionText}>
                Counselling closings: {isIniCet ? 'AIIMS' : 'MCC'} final-state closing ranks (
                {cycles}).
              </Text>
            </View>
            {result.required?.distribution ? (
              <View style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.sectionText}>
                  Rank → required score: official NBEMS {isIniCet ? '' : '2025 '}score↔rank data,
                  worst-case tie handled conservatively.
                </Text>
              </View>
            ) : null}
            {result.required?.prior ? (
              <View style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.sectionText}>
                  Rank → required marks: a crowd-sourced ladder (Dr Mayukh Hazra compilations,
                  UR-only) — AIIMS publishes no INI-CET marks, so this step is an estimate with no
                  official ground truth.
                </Text>
              </View>
            ) : null}
            {result.current ? (
              <View style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.sectionText}>
                  Current average: mean of your Grand Test scores, one value per test (latest
                  completed attempt).
                </Text>
              </View>
            ) : null}
          </View>

          {notes.length ? (
            <View style={styles.methodologySection}>
              <Text style={styles.sectionLabel}>NOTES &amp; LIMITATIONS</Text>
              {notes.map((note) => (
                <View key={note} style={styles.bulletRow}>
                  <Info size={12} color="#01b4ae" />
                  <Text style={styles.sectionText}>{note}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.methodologyFooter}>
            {EXAM_LABELS[result.exam] ?? result.exam} · every lookup is saved so its usefulness can
            be measured once real outcomes are shared.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---- the view ----------------------------------------------------------------------

export default function DesiredBranchResult({
  response,
  onBack,
}: {
  response: DesiredBranchResponse;
  onBack: () => void;
}) {
  const result = response.result;
  const [copied, setCopied] = useState(false);

  const skippedWarning = result.warnings.find((w) => w.code === 'NO_SKIP_ASSUMPTION_WEAKENED');
  const inlineWarnings = result.warnings.filter(
    (w) => w.code !== 'NO_SKIP_ASSUMPTION_WEAKENED' && w.code !== 'LOW_GT_COUNT'
  );

  const share = async () => {
    const text = buildDesiredShareText(result);
    setCopied(false);
    try {
      await Share.share({ title: 'My target branch', message: text });
      return;
    } catch {
      // Share sheet unavailable/dismissed with an error — fall through to copy.
    }
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard denied — silent by design (same as the website).
    }
  };

  // §9 case 2: branch exists but nothing closed for this category × PwD.
  if (result.target.coverage === 'NO_DATA_FOR_FILTER') {
    return (
      <View style={{ gap: 14 }}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.topButton} onPress={onBack} activeOpacity={0.7}>
            <ArrowLeft size={14} color="#374151" />
            <Text style={styles.topButtonText}>Pick another branch</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.noDataCard}>
          <AlertTriangle size={22} color="#F59E0B" style={styles.inviteIcon} />
          <Text style={styles.noDataTitle}>{result.input.branch.display}</Text>
          <Text style={styles.noDataBody}>
            This branch appears in the counselling records, but nothing closed under{' '}
            {result.input.category.value}
            {result.input.category.pwd ? ' (PwD)' : ''} in the covered{' '}
            {result.exam === 'INI_CET' ? 'sessions' : 'years'}. Check the category — it is never
            assumed for you.
          </Text>
          <Text style={styles.noDataCoverage}>
            Covered: {result.target.years.map((y) => cycleLabel(y.year, y.session)).join(' · ')}
          </Text>
          <TouchableOpacity
            style={styles.inviteButton}
            onPress={onBack}
            activeOpacity={0.7}
          >
            <ArrowLeft size={14} color="#374151" />
            <Text style={styles.topButtonText}>Back to inputs</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.topButton} onPress={onBack} activeOpacity={0.7}>
          <ArrowLeft size={14} color="#374151" />
          <Text style={styles.topButtonText}>Pick another branch</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.topButton} onPress={share} activeOpacity={0.7}>
          {copied ? (
            <>
              <Check size={14} color="#01b4ae" />
              <Text style={styles.topButtonText}>Copied</Text>
            </>
          ) : (
            <>
              <Copy size={14} color="#374151" />
              <Text style={styles.topButtonText}>Share target</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View>
        <Text style={styles.heading}>{result.input.branch.display}</Text>
        <Text style={styles.headingSub}>
          {EXAM_LABELS[result.exam] ?? result.examLabel} · {result.input.category.value}
          {result.input.category.pwd ? ' (PwD)' : ''} · {result.input.quotaLabel}
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        <TargetRankCard result={result} />
        <RequiredCard result={result} />
      </View>

      <GapPanel result={result} onBack={onBack} />

      {/* §14: the disclaimer, visible with the results — exactly once */}
      <View style={styles.disclaimerRow}>
        <Info size={13} color="#01b4ae" />
        <Text style={styles.disclaimerText}>
          Historical closing ranks move every year — this is a planning target, not a promise.{' '}
          {DISCLAIMER_NOTE}
        </Text>
      </View>

      {skippedWarning ? (
        <View style={styles.warningBox}>
          <AlertTriangle size={14} color="#F59E0B" />
          <Text style={styles.warningTextAmber}>{skippedWarning.note}</Text>
        </View>
      ) : null}

      {/* short, in-context cautions (full text lives in Methodology) */}
      {inlineWarnings.map((w) => (
        <View key={w.code} style={styles.inlineWarningBox}>
          <Sparkles size={13} color="#01b4ae" />
          <Text style={styles.inlineWarningText}>{DESIRED_WARNING_SHORT[w.code] ?? w.note}</Text>
        </View>
      ))}

      <CycleTable result={result} />

      {/* current GTs, provenance-tagged (mirrors the forward "What went in") */}
      {result.current ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Where you are now</Text>
          <View style={styles.gtChips}>
            {result.current.gts.map((gt, i) => {
              const isAuto = gt.provenance === 'auto-captured';
              return (
                <View key={i} style={[styles.gtChip, isAuto ? styles.gtChipAuto : styles.gtChipManual]}>
                  {isAuto ? <Zap size={11} color="#01b4ae" /> : <User size={11} color="#6B7280" />}
                  <Text style={[styles.gtChipText, { color: isAuto ? '#0d7a76' : '#374151' }]}>
                    GT {i + 1}: <Text style={styles.gtChipStrong}>{gt.selected?.corrects ?? '—'}</Text>{' '}
                    corrects
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.averageText}>
            Average used: <Text style={styles.averageStrong}>{fmtCorrects(result.current.meanCorrects)}</Text>{' '}
            corrects across {result.current.aggregation.n} Grand Test
            {result.current.aggregation.n === 1 ? '' : 's'}
            {result.current.aggregation.lowDataCaution ? ' — few GTs, so treat the gap as rough' : ''}.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Award size={22} color="#01b4ae" style={styles.inviteIcon} />
          <Text style={styles.inviteTitle}>Want the gap to this target?</Text>
          <Text style={styles.inviteBody}>
            Add your recent Grand Test corrects and run this again — you will see how far the safe
            and likely ends are from your current average.
          </Text>
          <TouchableOpacity style={styles.inviteButton} onPress={onBack} activeOpacity={0.7}>
            <ArrowLeft size={14} color="#374151" />
            <Text style={styles.topButtonText}>Add your Grand Tests</Text>
          </TouchableOpacity>
        </View>
      )}

      <DesiredMethodology result={result} />
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  topButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  topButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  headingSub: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 3,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flex: 1,
  },
  sourceChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  sourceChipText: {
    fontSize: 10,
    color: '#6B7280',
  },
  bigNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flexWrap: 'wrap',
  },
  bigNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: '#111827',
    fontVariant: ['tabular-nums'],
  },
  bigNumberDash: {
    fontSize: 24,
    fontWeight: '600',
    color: '#01b4ae',
  },
  bigNumberBeyond: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  bigNumberSuffix: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7280',
  },
  likelyLine: {
    fontSize: 14,
    color: '#374151',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  likelySuffix: {
    fontSize: 12,
    color: '#6B7280',
  },
  track: {
    height: 10,
    borderRadius: 99,
    backgroundColor: '#F3F4F6',
    marginTop: 16,
    overflow: 'hidden',
  },
  trackSegment: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: '#01b4ae',
    borderRadius: 99,
  },
  trackSegmentFade: {
    backgroundColor: 'rgba(1, 180, 174, 0.25)',
    borderRadius: 0,
    borderTopRightRadius: 99,
    borderBottomRightRadius: 99,
  },
  trackFaded: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(1, 180, 174, 0.25)',
  },
  trackTick: {
    position: 'absolute',
    top: -3,
    height: 16,
    width: 3,
    borderRadius: 99,
    backgroundColor: '#111827',
    marginLeft: -1.5,
  },
  axisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  axisLabelText: {
    fontSize: 10.5,
    color: '#9CA3AF',
  },
  instituteLines: {
    marginTop: 8,
    gap: 2,
  },
  instituteLine: {
    fontSize: 11,
    color: '#6B7280',
  },
  coverageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
  },
  coverageText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  boundedNoteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  boundedNoteText: {
    flex: 1,
    fontSize: 11,
    color: '#92600A',
    lineHeight: 15,
  },
  // gap panel (D7) — status-tinted boxes following the band color convention
  gapPanel: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 6,
  },
  gapPanelOnTrack: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  gapPanelWithinReach: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  gapPanelBelowTarget: {
    backgroundColor: 'rgba(220, 38, 38, 0.06)',
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  gapPanelNoData: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
  },
  gapLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gapDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
  },
  gapLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  gapTextOnTrack: { color: '#065F46', fontSize: 12, lineHeight: 16 },
  gapStrongOnTrack: { color: '#065F46', fontSize: 14, fontWeight: '700' },
  gapTextWithinReach: { color: '#92600A', fontSize: 12, lineHeight: 16 },
  gapStrongWithinReach: { color: '#92600A', fontSize: 14, fontWeight: '700' },
  gapTextBelowTarget: { color: '#991B1B', fontSize: 12, lineHeight: 16 },
  gapStrongBelowTarget: { color: '#991B1B', fontSize: 14, fontWeight: '700' },
  gapTextNoData: { color: '#6B7280', fontSize: 12, lineHeight: 16 },
  gapStrongNoData: { color: '#374151', fontSize: 14, fontWeight: '700' },
  gapHint: {
    fontSize: 11,
    opacity: 0.85,
    marginTop: 2,
  },
  gapBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  gapBackButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    padding: 12,
  },
  warningTextAmber: {
    flex: 1,
    fontSize: 12,
    color: '#92600A',
    lineHeight: 16,
  },
  inlineWarningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
  },
  inlineWarningText: {
    flex: 1,
    fontSize: 12,
    color: '#374151',
    lineHeight: 16,
  },
  // cycle table
  cycleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  cycleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  cycleHeaderChip: {
    fontSize: 11,
    color: '#6B7280',
  },
  cycleExplainer: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
    marginVertical: 10,
  },
  cycleRow: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
  },
  cycleRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cycleRowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  cycleRowValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
  cycleRowTightest: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
  },
  // current / invite cards
  gtChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  gtChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 99,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  gtChipAuto: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    borderColor: 'rgba(1, 180, 174, 0.35)',
  },
  gtChipManual: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
  },
  gtChipText: {
    fontSize: 12,
  },
  gtChipStrong: {
    fontWeight: '700',
  },
  averageText: {
    fontSize: 12,
    color: '#6B7280',
  },
  averageStrong: {
    fontWeight: '700',
    color: '#374151',
  },
  inviteIcon: {
    alignSelf: 'center',
    marginBottom: 10,
  },
  inviteTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 6,
  },
  inviteBody: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  // no-data-for-filter state
  noDataCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 22,
    alignItems: 'center',
  },
  noDataTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  noDataBody: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  noDataCoverage: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 14,
  },
  // methodology
  methodologyCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  methodologyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    gap: 10,
  },
  methodologyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  methodologyHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  methodologyBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 14,
  },
  methodologySection: {
    gap: 7,
  },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  bullet: {
    fontSize: 12,
    color: '#01b4ae',
    lineHeight: 16,
  },
  sectionText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  methodologyFooter: {
    fontSize: 11,
    color: '#9CA3AF',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    lineHeight: 15,
  },
});
