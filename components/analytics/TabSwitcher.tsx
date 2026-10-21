import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from '@/utils/haptics';

interface Tab {
    key: string;
    label: string;
}

interface TabSwitcherProps {
    tabs: Tab[];
    activeTab: string;
    onTabChange: (tabKey: string) => void;
}

const FONT_SIZE = 13;
// Conservative average glyph-width ratio for the 600-weight tab labels
// (uppercase-heavy labels skew wide, so this over-estimates slightly — a safe
// direction: the floor just has to never be SMALLER than the real word).
const GLYPH_WIDTH_RATIO = 0.62;
const TAB_HORIZONTAL_PADDING = 12;

/**
 * Estimated rendered width of a label's longest word at the current font
 * scale. A word that is wider than its cell is the one thing that makes
 * Android break a word mid-word ("Proctorin/g"), so that word's width is the
 * minimum the cell must guarantee.
 */
const longestWordWidth = (label: string, fontScale: number) =>
    Math.max(
        0,
        ...label.split(/\s+/).map((word) => word.length)
    ) * FONT_SIZE * GLYPH_WIDTH_RATIO * fontScale;

/** Full one-line width estimate — the cell floor when the row scrolls. */
const fullWidth = (label: string, fontScale: number) =>
    label.length * FONT_SIZE * GLYPH_WIDTH_RATIO * fontScale;

export default function TabSwitcher({ tabs, activeTab, onTabChange }: TabSwitcherProps) {
    const { fontScale, width: windowWidth } = useWindowDimensions();
    const [containerWidth, setContainerWidth] = useState(0);

    const handleTabPress = (tabKey: string) => {
        if (tabKey !== activeTab) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onTabChange(tabKey);
        }
    };

    const handleLayout = (event: LayoutChangeEvent) => {
        const { width } = event.nativeEvent.layout;
        // The scroll content's padding shrinks what the tabs can actually use.
        setContainerWidth(width - 8);
    };

    // Cells guarantee room for their longest word, so multi-word labels
    // ("Test Analytics") wrap at word boundaries while single-word labels
    // ("Proctoring") always fit on one line.
    const minTabWidths = tabs.map(
        (tab) => longestWordWidth(tab.label, fontScale) + TAB_HORIZONTAL_PADDING
    );
    // Before the first layout pass, the window width minus this component's
    // own margins/padding is a close prior — a too-narrow screen starts in
    // scroll mode immediately instead of flashing a squeezed first frame.
    const effectiveWidth = containerWidth || windowWidth - 40;
    const fitsWithoutScrolling =
        minTabWidths.reduce((sum, width) => sum + width, 0) <= effectiveWidth;

    const tabsRow = (scrollable: boolean) => (
        <>
            {tabs.map((tab, i) => {
                const isActive = tab.key === activeTab;
                return (
                    <TouchableOpacity
                        key={tab.key}
                        style={[
                            styles.tab,
                            isActive && styles.activeTab,
                            scrollable && styles.tabScrollable,
                            scrollable && { minWidth: fullWidth(tab.label, fontScale) + TAB_HORIZONTAL_PADDING },
                            !scrollable && { minWidth: minTabWidths[i] },
                        ]}
                        onPress={() => handleTabPress(tab.key)}
                        activeOpacity={0.7}
                    >
                        <Text
                            style={[styles.tabText, isActive && styles.activeTabText]}
                            numberOfLines={scrollable ? 1 : 2}
                        >
                            {tab.label}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </>
    );

    return (
        <View style={styles.container} onLayout={handleLayout}>
            {fitsWithoutScrolling ? (
                <View style={styles.row}>{tabsRow(false)}</View>
            ) : (
                // Same fallback DataTable uses: when even the minimum widths
                // exceed the viewport, the segmented control scrolls instead of
                // squeezing cells below their floors.
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.scrollContent}
                >
                    {tabsRow(true)}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        padding: 4,
        marginHorizontal: 16,
        marginVertical: 12,
    },
    row: {
        flexDirection: 'row',
    },
    scrollContent: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    tab: {
        flex: 1,
        paddingVertical: 10,
        // Modest horizontal padding so three labels ("Test Analytics",
        // "Student Analytics", "Heat Map") share narrow phones without
        // squeezing each other into mid-word breaks; longer labels wrap at
        // word boundaries instead. The minWidth floor set inline guarantees
        // even single-word labels ("Proctoring") fit on one line.
        paddingHorizontal: 6,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabScrollable: {
        // In scroll mode there is width to spare — keep every label on a
        // single line and let cells size to their content.
        flex: 0,
        flexGrow: 1,
        flexShrink: 0,
    },
    activeTab: {
        backgroundColor: '#01b4ae',
        shadowColor: '#01b4ae',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
    },
    tabText: {
        fontSize: FONT_SIZE,
        fontWeight: '600',
        color: '#6B7280',
        textAlign: 'center',
    },
    activeTabText: {
        color: '#FFFFFF',
    },
});
