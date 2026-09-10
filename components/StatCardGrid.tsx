import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { LucideIcon } from 'lucide-react-native';

export interface StatCardItem {
  value: string | number;
  label: string;
  valueColor?: string;
  icon?: LucideIcon;
  iconColor?: string;
  backgroundColor?: string;
}

interface StatGridGeometry {
  /** Full window width (pass useWindowDimensions().width). */
  width: number;
  itemCount: number;
  /**
   * Cards never shrink below this width — the row reflows to fewer columns
   * instead (e.g. 4 KPIs become a 2x2 grid on phones), so labels always have
   * room and never wrap mid-word.
   */
  minCardWidth?: number;
  gap?: number;
  /** Total horizontal padding around the grid (caller's container insets). */
  contentInsets?: number;
  /** Upper bound on columns; defaults to the item count. */
  maxColumns?: number;
}

const DEFAULT_MIN_CARD_WIDTH = 132;
const DEFAULT_GAP = 10;
const DEFAULT_CONTENT_INSETS = 32;

/**
 * Picks the column count for a KPI row that fits the available width.
 * Prefers column counts that divide the item count evenly (no dangling
 * cards); falls back to the largest fitting count >= 2 so items share rows
 * instead of stacking full-width.
 */
export function computeStatGridColumns({
  width,
  itemCount,
  minCardWidth = DEFAULT_MIN_CARD_WIDTH,
  gap = DEFAULT_GAP,
  contentInsets = DEFAULT_CONTENT_INSETS,
  maxColumns = itemCount,
}: StatGridGeometry): number {
  const columns = Math.min(maxColumns, itemCount);
  const available = Math.max(width - contentInsets, minCardWidth);
  const fits = (c: number) => (available - gap * (c - 1)) / c >= minCardWidth;

  for (let c = columns; c >= 2; c--) {
    if (fits(c) && itemCount % c === 0) return c;
  }
  for (let c = columns; c >= 2; c--) {
    if (fits(c)) return c;
  }
  return 1;
}

interface StatCardGridProps extends Omit<StatGridGeometry, 'width' | 'itemCount'> {
  items: StatCardItem[];
  /** Defaults to useWindowDimensions().width. */
  width?: number;
  /** Defaults to items.length. */
  itemCount?: number;
  isLoading?: boolean;
  onPressItem?: (item: StatCardItem, index: number) => void;
  cardStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export default function StatCardGrid({
  items,
  width: widthProp,
  itemCount: itemCountProp,
  minCardWidth = DEFAULT_MIN_CARD_WIDTH,
  gap = DEFAULT_GAP,
  contentInsets = DEFAULT_CONTENT_INSETS,
  maxColumns,
  isLoading = false,
  onPressItem,
  cardStyle,
  testID,
}: StatCardGridProps) {
  const { width: windowWidth } = useWindowDimensions();
  const width = widthProp ?? windowWidth;
  const itemCount = itemCountProp ?? items.length;

  const columns = computeStatGridColumns({
    width,
    itemCount,
    minCardWidth,
    gap,
    contentInsets,
    maxColumns,
  });
  const cardWidth = (width - contentInsets - gap * (columns - 1)) / columns;

  const rows: StatCardItem[][] = [];
  for (let i = 0; i < itemCount; i += columns) {
    rows.push(items.slice(i, i + columns));
  }

  const renderCard = (item: StatCardItem, index: number) => {
    const Icon = item.icon;
    const body = (
      <View
        style={[
          styles.card,
          { width: cardWidth, backgroundColor: item.backgroundColor },
          cardStyle,
        ]}
      >
        {isLoading ? (
          <>
            <View style={styles.skeletonValue} />
            <View style={styles.skeletonLabel} />
          </>
        ) : (
          <>
            {Icon ? <Icon color={item.iconColor || '#6B7280'} size={22} /> : null}
            <Text
              style={[styles.value, item.valueColor ? { color: item.valueColor } : null]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {item.value}
            </Text>
            <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {item.label}
            </Text>
          </>
        )}
      </View>
    );

    if (!onPressItem) {
      return <View key={index}>{body}</View>;
    }
    return (
      <Pressable
        key={index}
        onPress={() => onPressItem(item, index)}
        style={({ pressed }) => [pressed && styles.cardPressed]}
      >
        {body}
      </Pressable>
    );
  };

  return (
    <View style={{ gap }} testID={testID}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={[styles.row, { gap }]}>
          {row.map((item, i) => renderCard(item, rowIndex * columns + i))}
          {/* Pad ragged rows so trailing cards align with the grid above. */}
          {row.length < columns
            ? Array.from({ length: columns - row.length }, (_, i) => (
                <View key={`spacer-${i}`} style={{ width: cardWidth }} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.15)',
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  cardPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  value: {
    fontSize: 24,
    fontWeight: '700',
    color: '#01b4ae',
    textAlign: 'center',
    width: '100%',
    lineHeight: 28,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'center',
    width: '100%',
  },
  skeletonValue: {
    width: 40,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
    marginBottom: 4,
  },
  skeletonLabel: {
    width: '60%',
    height: 11,
    borderRadius: 5,
    backgroundColor: '#E5E7EB',
  },
});
