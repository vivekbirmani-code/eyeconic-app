import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
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

export default function TabSwitcher({ tabs, activeTab, onTabChange }: TabSwitcherProps) {
    const handleTabPress = (tabKey: string) => {
        if (tabKey !== activeTab) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onTabChange(tabKey);
        }
    };

    return (
        <View style={styles.container}>
            {tabs.map((tab) => {
                const isActive = tab.key === activeTab;
                return (
                    <TouchableOpacity
                        key={tab.key}
                        style={[styles.tab, isActive && styles.activeTab]}
                        onPress={() => handleTabPress(tab.key)}
                        activeOpacity={0.7}
                    >
                        <Text style={[styles.tabText, isActive && styles.activeTabText]}>
                            {tab.label}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        padding: 4,
        marginHorizontal: 16,
        marginVertical: 12,
    },
    tab: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
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
        fontSize: 14,
        fontWeight: '600',
        color: '#6B7280',
    },
    activeTabText: {
        color: '#FFFFFF',
    },
});
