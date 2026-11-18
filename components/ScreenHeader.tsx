import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { ArrowLeft, X, ChevronRight } from 'lucide-react-native';
import { colors } from '@/utils/theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backIcon?: 'arrow' | 'x';
  backAccessibilityLabel?: string;
  /** Optional element between the back button and the title (e.g. an avatar). */
  leading?: React.ReactNode;
  /** Makes the title block tappable (e.g. chat header → Group Info) and shows a chevron. */
  onTitlePress?: () => void;
  titleAccessibilityLabel?: string;
  /** Right-side action; a 24px spacer keeps the title centered when absent. */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Groups module's shared top bar (Chat, Group Info, Add Participants).
 * One height, one border, one touch-target size everywhere.
 */
export default function ScreenHeader({
  title,
  subtitle,
  onBack,
  backIcon = 'arrow',
  backAccessibilityLabel = 'Go back',
  leading,
  onTitlePress,
  titleAccessibilityLabel,
  right,
  style,
}: ScreenHeaderProps) {
  const BackIcon = backIcon === 'x' ? X : ArrowLeft;

  const titleBlock = (
    <View style={styles.titleWrap}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.header, style]}>
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={backAccessibilityLabel}
        >
          <BackIcon color={colors.text} size={24} />
        </TouchableOpacity>
      ) : null}

      {onTitlePress ? (
        <TouchableOpacity
          style={styles.tappableTitle}
          onPress={onTitlePress}
          accessibilityRole="button"
          accessibilityLabel={titleAccessibilityLabel || title}
        >
          {leading}
          {titleBlock}
          <ChevronRight color={colors.textMuted} size={18} />
        </TouchableOpacity>
      ) : (
        <View style={styles.tappableTitle}>
          {leading}
          {titleBlock}
        </View>
      )}

      {right ?? <View style={{ width: 24 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 64,
  },
  backButton: {
    padding: 5,
    marginRight: 10,
  },
  tappableTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
});
