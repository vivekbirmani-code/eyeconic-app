import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    FlatList,
    Modal,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { Search, ChevronDown, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Test {
    _id: string;
    title: string;
    testType: string;
    assignedCount: number;
    attemptCount: number;
}

interface TestDropdownProps {
    tests: Test[];
    selectedTest: Test | null;
    onTestSelect: (test: Test) => void;
    loading?: boolean;
}

export default function TestDropdown({ tests, selectedTest, onTestSelect, loading }: TestDropdownProps) {
    const [modalVisible, setModalVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredTests, setFilteredTests] = useState<Test[]>(tests);
    const [filterType, setFilterType] = useState<string>('all');
    const insets = useSafeAreaInsets();

    useEffect(() => {
        let filtered = tests;

        // Filter by search query
        if (searchQuery) {
            filtered = filtered.filter(t =>
                t.title.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        // Filter by test type
        if (filterType !== 'all') {
            filtered = filtered.filter(t => t.testType === filterType);
        }

        setFilteredTests(filtered);
    }, [searchQuery, filterType, tests]);

    useEffect(() => {
        if (modalVisible) {
            setSearchQuery('');
            setFilterType('all');
            setFilteredTests(tests);
        }
    }, [modalVisible]);

    const handleSelectTest = (test: Test) => {
        onTestSelect(test);
        setModalVisible(false);
        setSearchQuery('');
        setFilterType('all');
    };

    const getTypeBadgeStyle = (type: string) => {
        switch (type) {
            case 'daily':
                return styles.dailyBadge;
            case 'weekly':
                return styles.weeklyBadge;
            case 'grand':
                return styles.grandBadge;
            default:
                return {};
        }
    };

    return (
        <>
            <TouchableOpacity
                style={styles.selector}
                onPress={() => setModalVisible(true)}
            >
                <View style={styles.selectorContent}>
                    {selectedTest ? (
                        <>
                            <View style={styles.selectedTestInfo}>
                                <Text style={styles.selectedTestTitle} numberOfLines={1}>
                                    {selectedTest.title}
                                </Text>
                                <View style={[styles.typeBadge, getTypeBadgeStyle(selectedTest.testType)]}>
                                    <Text style={styles.typeBadgeText}>{selectedTest.testType}</Text>
                                </View>
                            </View>
                            <TouchableOpacity
                                onPress={(e) => {
                                    e.stopPropagation();
                                    onTestSelect(null as any);
                                }}
                                style={styles.clearButton}
                            >
                                <X color="#6B7280" size={20} />
                            </TouchableOpacity>
                        </>
                    ) : (
                        <Text style={styles.placeholder}>Select a test</Text>
                    )}
                </View>
                <ChevronDown color="#6B7280" size={20} />
            </TouchableOpacity>

            <Modal
                visible={modalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.modalOverlay}
                >
                    <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Select Test</Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)}>
                                <X color="#1F2937" size={24} />
                            </TouchableOpacity>
                        </View>

                        {/* Search */}
                        <View style={styles.searchContainer}>
                            <Search color="#6B7280" size={20} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Search tests..."
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                            />
                        </View>

                        {/* Type Filter */}
                        <View style={styles.filterContainer}>
                            {['all', 'daily', 'weekly', 'grand'].map((type) => (
                                <TouchableOpacity
                                    key={type}
                                    style={[
                                        styles.filterButton,
                                        filterType === type && styles.filterButtonActive
                                    ]}
                                    onPress={() => setFilterType(type)}
                                >
                                    <Text
                                        style={[
                                            styles.filterButtonText,
                                            filterType === type && styles.filterButtonTextActive
                                        ]}
                                    >
                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* Test List */}
                        {loading ? (
                            <ActivityIndicator color="#01b4ae" style={{ marginTop: 20 }} />
                        ) : (
                            <FlatList
                                data={filteredTests}
                                keyExtractor={(item) => item._id}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={styles.testItem}
                                        onPress={() => handleSelectTest(item)}
                                    >
                                        <View style={styles.testItemContent}>
                                            <Text style={styles.testTitle} numberOfLines={2}>
                                                {item.title}
                                            </Text>
                                            <View style={styles.testMeta}>
                                                <View style={[styles.typeBadge, getTypeBadgeStyle(item.testType)]}>
                                                    <Text style={styles.typeBadgeText}>{item.testType}</Text>
                                                </View>
                                                <Text style={styles.testStats}>
                                                    {item.attemptCount} / {item.assignedCount} attempted
                                                </Text>
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                )}
                                ListEmptyComponent={
                                    <Text style={styles.emptyText}>No tests found</Text>
                                }
                                style={styles.testList}
                            />
                        )}
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    selector: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        marginHorizontal: 16,
        marginBottom: 16,
    },
    selectorContent: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginRight: 8,
    },
    selectedTestInfo: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    selectedTestTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
        flex: 1,
    },
    placeholder: {
        fontSize: 16,
        color: '#9CA3AF',
    },
    clearButton: {
        padding: 4,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 20,
        maxHeight: '90%',
        minHeight: '50%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1F2937',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        margin: 16,
        padding: 12,
        borderRadius: 12,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
    },
    filterContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        gap: 8,
        marginBottom: 12,
    },
    filterButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: '#F3F4F6',
    },
    filterButtonActive: {
        backgroundColor: '#01b4ae',
    },
    filterButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6B7280',
    },
    filterButtonTextActive: {
        color: '#FFFFFF',
    },
    testList: {
        flex: 1,
    },
    testItem: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    testItemContent: {
        gap: 8,
    },
    testTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
    },
    testMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    typeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: '#F3F4F6',
    },
    dailyBadge: {
        backgroundColor: 'rgba(1, 180, 174, 0.1)',
    },
    weeklyBadge: {
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
    },
    grandBadge: {
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
    },
    typeBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#374151',
        textTransform: 'capitalize',
    },
    testStats: {
        fontSize: 13,
        color: '#6B7280',
    },
    emptyText: {
        textAlign: 'center',
        color: '#9CA3AF',
        padding: 20,
    },
});
