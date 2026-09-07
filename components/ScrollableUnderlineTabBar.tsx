import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  LayoutChangeEvent,
} from 'react-native';
import { LucideIcon } from 'lucide-react-native';

export interface UnderlineTabItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  onPress: () => void;
  /**
   * TEMPORARY FEATURE FREEZE — disabled tabs stay visible but are
   * non-tappable and visually de-emphasized (utils/featureAvailability.ts).
   */
  disabled?: boolean;
}

interface ScrollableUnderlineTabBarProps {
  tabs: UnderlineTabItem[];
  activeTabId: string;
}

export function ScrollableUnderlineTabBar({
  tabs,
  activeTabId,
}: ScrollableUnderlineTabBarProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const tabLayouts = useRef<Record<string, { x: number; width: number }>>({});

  useEffect(() => {
    const layout = tabLayouts.current[activeTabId];
    if (layout && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: Math.max(0, layout.x - 16),
        animated: true,
      });
    }
  }, [activeTabId]);

  const handleTabLayout = (tabId: string, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    tabLayouts.current[tabId] = { x, width };
  };

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId && !tab.disabled;
          const Icon = tab.icon;

          return (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.tab,
                isActive && styles.tabActive,
                tab.disabled && styles.tabDisabled,
              ]}
              onPress={tab.onPress}
              activeOpacity={0.7}
              disabled={tab.disabled}
              onLayout={(event) => handleTabLayout(tab.id, event)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive, disabled: tab.disabled }}
            >
              <View style={styles.tabInner}>
                <Icon
                  color={tab.disabled ? '#C4C9D2' : isActive ? '#01b4ae' : '#6B7280'}
                  size={18}
                />
                <Text
                  style={[styles.tabText, isActive && styles.tabTextActive]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
                {tab.badge != null && tab.badge > 0 && !tab.disabled && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  scrollContent: {
    paddingHorizontal: 8,
    flexGrow: 1,
  },
  tab: {
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    justifyContent: 'center',
  },
  tabActive: {
    borderBottomColor: '#01b4ae',
  },
  tabDisabled: {
    opacity: 0.55,
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    flexShrink: 0,
  },
  tabTextActive: {
    color: '#01b4ae',
    fontWeight: '700',
  },
  badge: {
    backgroundColor: '#EF4444',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
