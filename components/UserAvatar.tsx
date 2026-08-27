import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';

type UserRole = 'admin' | 'mentor' | 'student' | string;

interface UserAvatarProps {
  name: string;
  imageUrl?: string | null;
  role?: UserRole;
  size?: number;
  accessibilityLabel?: string;
}

function getRoleColors(role?: UserRole) {
  switch (role) {
    case 'admin':
      return { background: '#FEE2E2', text: '#F43F5E' };
    case 'mentor':
      return { background: '#D1FAE5', text: '#059669' };
    case 'student':
      return { background: '#DBEAFE', text: '#2563EB' };
    default:
      return { background: '#E0F7F6', text: '#01b4ae' };
  }
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export default function UserAvatar({
  name,
  imageUrl,
  role,
  size = 48,
  accessibilityLabel,
}: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoading, setImageLoading] = useState(Boolean(imageUrl));
  const colors = getRoleColors(role);
  const showImage = Boolean(imageUrl) && !imageFailed;
  const fontSize = Math.max(12, Math.round(size * 0.38));

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.background,
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel || `${name} avatar`}
    >
      {showImage ? (
        <>
          <Image
            source={{ uri: imageUrl! }}
            style={[
              styles.image,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
              },
            ]}
            resizeMode="cover"
            onLoadStart={() => setImageLoading(true)}
            onLoadEnd={() => setImageLoading(false)}
            onError={() => {
              setImageFailed(true);
              setImageLoading(false);
            }}
          />
          {imageLoading && (
            <View style={[styles.loadingOverlay, { borderRadius: size / 2 }]}>
              <ActivityIndicator size="small" color="#01b4ae" />
            </View>
          )}
        </>
      ) : (
        <Text style={[styles.initials, { color: colors.text, fontSize }]}>
          {getInitials(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  initials: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
  },
});
