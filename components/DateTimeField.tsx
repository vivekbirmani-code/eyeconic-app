import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Check, Clock } from 'lucide-react-native';
import { combineDateAndTime, startOfMinute } from '@/utils/quizDateTime';
import { colors } from '@/utils/theme';

interface DateTimeFieldProps {
  label: string;
  value: Date | null;
  placeholder: string;
  onCommit: (date: Date) => void;
}

/**
 * Cross-platform date + time selector for quiz scheduling.
 *
 * Android: the native two-dialog flow (date dialog, then time dialog). Each
 * dialog emits a single `set` event when the user taps OK, so switching modes
 * between dialogs is safe and the committed value is exactly what the user
 * confirmed. The date part and time part are merged explicitly so changing
 * one can never disturb the other.
 *
 * iOS: `display="spinner"` renders an INLINE wheel picker — no modal and no
 * OK button — and `onChange` fires on every wheel tick. The value updates
 * live on each tick and an explicit Done button commits and closes. A multi-
 * step picker state machine must never advance from an iOS tick event: that
 * auto-committed near-arbitrary times (e.g. AM instead of PM) because the
 * first tick in each mode ended that mode.
 */
export function DateTimeField({ label, value, placeholder, onCommit }: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [temp, setTemp] = useState<Date>(new Date());
  // Mirror of `temp` readable inside event handlers without stale closures.
  const tempRef = useRef<Date>(new Date());

  const applyTemp = (next: Date) => {
    tempRef.current = next;
    setTemp(next);
  };

  const openPicker = () => {
    applyTemp(startOfMinute(value ?? new Date()));
    setPickerMode('date');
    setOpen(true);
  };

  const handleAndroidChange = (event: any, selected?: Date) => {
    if (event.type === 'dismissed') {
      setOpen(false);
      return;
    }
    if (!selected) return;

    if (pickerMode === 'date') {
      // Keep the current time-of-day while the user picks the date.
      applyTemp(combineDateAndTime(selected, tempRef.current));
      setPickerMode('time');
    } else {
      // Keep the just-picked date, apply the confirmed time.
      onCommit(combineDateAndTime(tempRef.current, selected));
      setOpen(false);
    }
  };

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.button} onPress={openPicker}>
        <Clock color="#6B7280" size={18} />
        <Text style={[styles.buttonText, !value && styles.placeholderText]}>
          {value ? value.toLocaleString() : placeholder}
        </Text>
      </TouchableOpacity>

      {open && Platform.OS === 'ios' && (
        <View style={styles.pickerCard}>
          <DateTimePicker
            value={temp}
            mode="datetime"
            display="spinner"
            onChange={(_event, selected) => {
              if (selected) applyTemp(startOfMinute(selected));
            }}
            style={styles.iosPicker}
          />
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => {
              onCommit(startOfMinute(temp));
              setOpen(false);
            }}
          >
            <Check color="#FFF" size={16} />
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={temp}
          mode={pickerMode}
          onChange={handleAndroidChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  buttonText: {
    fontSize: 15,
    color: '#1F2937',
    flex: 1,
  },
  placeholderText: {
    color: '#9CA3AF',
  },
  pickerCard: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    marginBottom: 12,
    paddingBottom: 12,
    alignItems: 'center',
  },
  iosPicker: {
    width: '100%',
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
    marginTop: 4,
  },
  doneButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
