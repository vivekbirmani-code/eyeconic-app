import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StyleProp,
  TextStyle,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';

/**
 * Shared responsive table primitive.
 *
 * Why this exists: hand-rolled tables sized their columns with proportional
 * flex (`flex: 1`), which can make a column narrower than the intrinsic width
 * of its header text on small screens — React Native then breaks the word
 * mid-word ("CORREC" / "T"). This component instead:
 *
 *  - Gives every column a guaranteed minimum width (scaled by the user's font
 *    scale), so headers and short values always fit on one line.
 *  - Lets one flexible ("grow") column absorb leftover width on larger
 *    viewports, so the table fills tablets/desktop instead of hugging the left.
 *  - Falls back to horizontal scrolling inside the card when even the minimum
 *    widths exceed the available width — the page itself never scrolls
 *    horizontally.
 */
export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Logical minimum width in dp. Scaled by the user's font scale. */
  width: number;
  /** Flexible column that absorbs leftover width on wide viewports. Its `width` acts as the floor. */
  grow?: boolean;
  align?: 'left' | 'center' | 'right';
  renderCell: (item: T, index: number) => React.ReactNode;
  headerStyle?: StyleProp<TextStyle>;
}

interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onRowPress?: (item: T, index: number) => void;
  /** Accessibility label for a pressable row, e.g. "Open section Physics". */
  rowAccessibilityLabel?: (item: T) => string;
  /** Horizontal inset of header/cells inside the card. */
  cellPadding?: number;
  headerTextStyle?: StyleProp<TextStyle>;
  /** Extra card styling (margins, border, shadow). The card itself is white, radius 12. */
  style?: StyleProp<ViewStyle>;
}

const ALIGN_TO_TEXT_ALIGN = {
  left: 'left',
  center: 'center',
  right: 'right',
} as const;

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowPress,
  rowAccessibilityLabel,
  cellPadding = 12,
  headerTextStyle,
  style,
}: DataTableProps<T>) {
  const { fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(0);

  // Widen columns proportionally when the user enlarges system fonts so
  // headers keep fitting instead of clipping or wrapping mid-word.
  const scale = Math.max(1, fontScale || 1);
  const scaledColumns = columns.map((column) => ({
    ...column,
    scaledWidth: Math.round(column.width * scale),
  }));

  const minContentWidth =
    scaledColumns.reduce((sum, column) => sum + column.scaledWidth, 0) + cellPadding * 2;

  const handleLayout = (event: LayoutChangeEvent) => {
    setAvailableWidth(event.nativeEvent.layout.width);
  };

  // Before the first layout pass, size to the guaranteed minimum so the very
  // first frame is already readable; afterwards, expand to the card width.
  const tableWidth = Math.max(availableWidth, minContentWidth);

  const renderRowCells = (item: T, index: number) =>
    scaledColumns.map((column) => (
      <View
        key={column.key}
        style={[
          styles.cell,
          { width: column.scaledWidth },
          column.grow && styles.cellGrow,
          column.align === 'center' && styles.cellCenter,
          column.align === 'right' && styles.cellRight,
        ]}
      >
        {column.renderCell(item, index)}
      </View>
    ));

  return (
    <View style={[styles.card, style]} onLayout={handleLayout}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Lets the outer vertical ScrollView keep priority for diagonal pans.
        nestedScrollEnabled
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={{ width: tableWidth }}>
          <View style={[styles.headerRow, { paddingHorizontal: cellPadding }]}>
            {scaledColumns.map((column) => (
              <View
                key={column.key}
                style={[
                  styles.cell,
                  { width: column.scaledWidth },
                  column.grow && styles.cellGrow,
                ]}
              >
                <Text
                  style={[
                    styles.headerText,
                    { textAlign: ALIGN_TO_TEXT_ALIGN[column.align ?? 'left'] },
                    headerTextStyle,
                    column.headerStyle,
                  ]}
                  numberOfLines={1}
                >
                  {column.header}
                </Text>
              </View>
            ))}
          </View>

          {data.map((item, index) => {
            const rowContent = (
              <View style={[styles.row, { paddingHorizontal: cellPadding }]}>
                {renderRowCells(item, index)}
              </View>
            );

            if (!onRowPress) {
              return <View key={keyExtractor(item, index)}>{rowContent}</View>;
            }

            return (
              <TouchableOpacity
                key={keyExtractor(item, index)}
                onPress={() => onRowPress?.(item, index)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={
                  rowAccessibilityLabel ? rowAccessibilityLabel(item) : undefined
                }
              >
                {rowContent}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  cell: {
    // Columns never shrink below their guaranteed width — that floor is what
    // keeps headers from breaking mid-word on narrow screens.
    flexShrink: 0,
  },
  cellGrow: {
    flexGrow: 1,
  },
  cellCenter: {
    alignItems: 'center',
  },
  cellRight: {
    alignItems: 'flex-end',
  },
});
