import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
  ActivityIndicator,
} from 'react-native';
import { Search, X } from 'lucide-react-native';
import { colors } from '@/utils/theme';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Shows a small inline spinner (live server search) instead of the clear button. */
  isSearching?: boolean;
  autoFocus?: boolean;
  returnKeyType?: 'search' | 'done' | 'default';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * The Groups module's shared search bar (groups list, Add Participants,
 * Create Group). One look everywhere: muted surface, soft border, icon,
 * clear button, optional live-search spinner.
 */
export default function SearchBar({
  value,
  onChangeText,
  placeholder,
  isSearching = false,
  autoFocus = false,
  returnKeyType = 'default',
  style,
  accessibilityLabel,
}: SearchBarProps) {
  return (
    <View style={[styles.container, style]}>
      <Search color={colors.textSecondary} size={18} />
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        returnKeyType={returnKeyType}
        accessibilityLabel={accessibilityLabel || placeholder}
      />
      {isSearching ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : value.length > 0 ? (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <X color={colors.textSecondary} size={18} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  input: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 10,
  },
});
