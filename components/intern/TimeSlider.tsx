import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  PanResponder,
  StyleSheet,
  AccessibilityActionEvent,
} from 'react-native';

/**
 * Pure-JS slider (no native module) so the feature runs in existing dev
 * clients and on web without a new APK build. Drag the thumb or tap the
 * track; the value snaps to `step`. Children of the track are
 * pointerEvents="none" so nativeEvent.locationX is always track-relative.
 */

interface TimeSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  accent?: string;
  disabled?: boolean;
}

const TRACK_HEIGHT = 6;
const THUMB_SIZE = 26;
const TOUCH_HEIGHT = 44;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function TimeSlider({
  min,
  max,
  step,
  value,
  onChange,
  accent = '#01b4ae',
  disabled = false,
}: TimeSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const valueFromX = (x: number) => {
    if (trackWidth <= 0) return valueRef.current;
    const raw = (clamp(x, 0, trackWidth) / trackWidth) * (max - min) + min;
    const snapped = Math.round(raw / step) * step;
    return clamp(snapped, min, max);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (evt) => {
          onChange(valueFromX(evt.nativeEvent.locationX));
        },
        onPanResponderMove: (evt) => {
          onChange(valueFromX(evt.nativeEvent.locationX));
        },
        onPanResponderTerminationRequest: () => true,
      }),
    // valueFromX closes over trackWidth; panResponder must rebuild when it
    // changes from 0 (first layout) so the first drag is already accurate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackWidth, min, max, step, disabled, onChange]
  );

  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const action = event.nativeEvent.actionName;
    if (action === 'increment') onChange(clamp(valueRef.current + step, min, max));
    if (action === 'decrement') onChange(clamp(valueRef.current - step, min, max));
  };

  return (
    <View
      style={styles.wrapper}
      accessibilityRole="adjustable"
      accessibilityLabel={`Time slider, ${value} minutes`}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[
        { name: 'increment', label: 'Increase time' },
        { name: 'decrement', label: 'Decrease time' },
      ]}
      onAccessibilityAction={onAccessibilityAction}
      importantForAccessibility="auto"
    >
      <View
        style={styles.touchRow}
        {...panResponder.panHandlers}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        <View style={[styles.track, disabled && styles.trackDisabled]} pointerEvents="none">
          <View
            pointerEvents="none"
            style={[
              styles.fill,
              { width: `${clamp(pct, 0, 100)}%`, backgroundColor: disabled ? '#9CA3AF' : accent },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                left: `${clamp(pct, 0, 100)}%`,
                backgroundColor: disabled ? '#9CA3AF' : '#FFFFFF',
                borderColor: disabled ? '#9CA3AF' : accent,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  touchRow: {
    height: TOUCH_HEIGHT,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: '#E5E7EB',
    overflow: 'visible',
  },
  trackDisabled: {
    opacity: 0.6,
  },
  fill: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    top: (TRACK_HEIGHT - THUMB_SIZE) / 2,
    marginLeft: -THUMB_SIZE / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 3,
    // Elevation so the thumb paints above the fill on Android.
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
});
