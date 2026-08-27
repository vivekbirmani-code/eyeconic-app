import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Trash2 } from 'lucide-react-native';
import UserAvatar from '@/components/UserAvatar';
import { uploadProfilePicture, removeProfilePicture, getProfilePictureErrorMessage } from '@/services/profilePicture';

interface ProfilePictureManagerProps {
  name: string;
  role?: string;
  imageUrl?: string | null;
  size?: number;
  editable?: boolean;
  showActionLabels?: boolean;
  onUpdated?: (profilePicture: string | null) => void;
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

function inferMimeType(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    default:
      return 'image/jpeg';
  }
}

export default function ProfilePictureManager({
  name,
  role,
  imageUrl,
  size = 96,
  editable = true,
  showActionLabels = true,
  onUpdated,
}: ProfilePictureManagerProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(imageUrl || null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  React.useEffect(() => {
    setCurrentImageUrl(imageUrl || null);
  }, [imageUrl]);

  const isBusy = isUploading || isRemoving;

  const validateAsset = (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.fileSize && asset.fileSize > MAX_FILE_SIZE_BYTES) {
      throw new Error('Image is too large. Maximum size is 5MB.');
    }

    const mimeType = asset.mimeType || inferMimeType(asset.fileName || 'profile.jpg');
    if (!ALLOWED_MIME_TYPES.includes(mimeType) && mimeType !== 'image/jpg') {
      throw new Error('Unsupported image type. Please choose a JPEG, PNG, WebP, or HEIC image.');
    }
  };

  const handlePickImage = async () => {
    if (!editable || isBusy) {
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Please allow photo library access to upload a profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];
      validateAsset(asset);

      setIsUploading(true);
      const updatedUser = await uploadProfilePicture({
        uri: asset.uri,
        type: asset.mimeType || 'image/jpeg',
        name: asset.fileName || 'profile.jpg',
      });

      setCurrentImageUrl(updatedUser.profilePicture || null);
      onUpdated?.(updatedUser.profilePicture || null);
      Alert.alert('Success', 'Profile picture updated successfully.');
    } catch (error) {
      Alert.alert('Upload failed', getProfilePictureErrorMessage(error));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = () => {
    if (!editable || isBusy || !currentImageUrl) {
      return;
    }

    Alert.alert(
      'Remove profile picture',
      'Are you sure you want to remove your profile picture?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsRemoving(true);
              const updatedUser = await removeProfilePicture();
              setCurrentImageUrl(updatedUser.profilePicture || null);
              onUpdated?.(updatedUser.profilePicture || null);
              Alert.alert('Removed', 'Your profile picture has been removed.');
            } catch (error) {
              Alert.alert('Remove failed', getProfilePictureErrorMessage(error));
            } finally {
              setIsRemoving(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={editable ? handlePickImage : undefined}
        disabled={!editable || isBusy}
        accessibilityRole="button"
        accessibilityLabel={editable ? 'Change profile picture' : `${name} profile picture`}
        style={({ pressed }) => [
          styles.avatarWrapper,
          pressed && editable && !isBusy && styles.avatarPressed,
        ]}
      >
        <UserAvatar
          name={name}
          role={role}
          imageUrl={currentImageUrl}
          size={size}
        />
        {editable && (
          <View style={[styles.cameraBadge, { width: size * 0.34, height: size * 0.34, borderRadius: size * 0.17 }]}>
            {isBusy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Camera color="#FFFFFF" size={Math.max(14, size * 0.16)} />
            )}
          </View>
        )}
      </Pressable>

      {editable && showActionLabels && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, isBusy && styles.actionButtonDisabled]}
            onPress={handlePickImage}
            disabled={isBusy}
          >
            <Text style={styles.actionButtonText}>
              {currentImageUrl ? 'Change Photo' : 'Upload Photo'}
            </Text>
          </TouchableOpacity>

          {currentImageUrl && (
            <TouchableOpacity
              style={[styles.removeButton, isBusy && styles.actionButtonDisabled]}
              onPress={handleRemoveImage}
              disabled={isBusy}
            >
              <Trash2 color="#EF4444" size={16} />
              <Text style={styles.removeButtonText}>Remove Photo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarPressed: {
    opacity: 0.9,
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: '#01b4ae',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  actions: {
    marginTop: 12,
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    backgroundColor: 'rgba(1, 180, 174, 0.1)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(1, 180, 174, 0.25)',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#01b4ae',
    fontSize: 14,
    fontWeight: '600',
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  removeButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
});
