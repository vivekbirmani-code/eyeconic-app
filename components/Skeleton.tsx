import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 4,
  style
}) => {
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
};

export const QuizCardSkeleton: React.FC = () => (
  <View style={styles.quizCardSkeleton}>
    <View style={styles.iconSkeleton}>
      <Skeleton width={28} height={28} borderRadius={14} />
    </View>
    <View style={styles.infoSkeleton}>
      <Skeleton width="80%" height={18} style={{ marginBottom: 8 }} />
      <Skeleton width="60%" height={14} style={{ marginBottom: 8 }} />
      <View style={styles.metaSkeleton}>
        <Skeleton width={80} height={12} />
        <Skeleton width={60} height={12} />
        <Skeleton width={70} height={12} />
      </View>
    </View>
  </View>
);

export const QuestionSkeleton: React.FC = () => (
  <View style={styles.questionSkeleton}>
    <Skeleton width="40%" height={14} style={{ marginBottom: 12 }} />
    <Skeleton width="100%" height={16} style={{ marginBottom: 8 }} />
    <Skeleton width="90%" height={16} style={{ marginBottom: 20 }} />
    {[1, 2, 3, 4].map((i) => (
      <View key={i} style={styles.optionSkeleton}>
        <Skeleton width={24} height={24} borderRadius={12} />
        <Skeleton width="85%" height={16} />
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#E5E7EB',
  },
  quizCardSkeleton: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
  },
  iconSkeleton: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  infoSkeleton: {
    flex: 1,
  },
  metaSkeleton: {
    flexDirection: 'row',
    gap: 12,
  },
  questionSkeleton: {
    padding: 20,
  },
  optionSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
});
