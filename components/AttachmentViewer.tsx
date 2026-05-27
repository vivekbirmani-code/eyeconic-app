import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  Dimensions,
  ActivityIndicator
} from 'react-native';
import { X, FileText, Download, ExternalLink } from 'lucide-react-native';
import { getApiBaseURL } from '@/services/config';
import { openExternalUrl } from '@/utils/openExternalUrl';

interface Attachment {
  type: 'image' | 'video' | 'document';
  url: string;
  name?: string;
  size?: number;
  mimeType?: string;
  publicId?: string;
  localUri?: string;
}

interface AttachmentViewerProps {
  attachment: Attachment;
  isVisible: boolean;
  onClose: () => void;
}

const formatSize = (bytes?: number) => {
  if (!bytes) return '';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

export const AttachmentViewer: React.FC<AttachmentViewerProps> = ({ attachment, isVisible, onClose }) => {
  if (!attachment) return null;

  const handleOpen = async () => {
    try {
      // Use the backend proxy for documents to avoid ERR_INVALID_RESPONSE
      // on Android Chrome when opening direct Cloudinary URLs.
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const token = await AsyncStorage.getItem('authToken');
      const base = getApiBaseURL();
      const encodedUrl = encodeURIComponent(attachment.url);
      const encodedName = encodeURIComponent(attachment.name || 'document');
      const proxyUrl = `${base}/upload/download-proxy?url=${encodedUrl}&name=${encodedName}`;

      // If we have a token, attach it to the URL so the request is authenticated
      const finalUrl = token ? `${proxyUrl}&token=${token}` : proxyUrl;
      openExternalUrl(finalUrl).catch(err => console.error("Couldn't open file", err));
    } catch (err) {
      console.error('handleOpen error', err);
      // Fallback to direct URL
      openExternalUrl(attachment.url).catch(e => console.error("Fallback open failed", e));
    }
  };


  if (attachment.type === 'image') {
    return (
      <Modal visible={isVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <X color="#FFF" size={30} />
            </TouchableOpacity>
            
            <View style={styles.imageContainer}>
              <Image 
                source={{ uri: attachment.url }} 
                style={styles.fullImage} 
                resizeMode="contain"
              />
            </View>
            
            <View style={styles.footer}>
               <Text style={styles.footerText}>{attachment.name}</Text>
                {attachment.size && <Text style={styles.sizeText}>{formatSize(attachment.size)}</Text>}
            </View>
        </View>
      </Modal>
    );
  }

  // Document Viewer (Just a popup to open)
  return (
    <Modal visible={isVisible} transparent animationType="slide">
        <View style={styles.docModalOverlay}>
            <View style={styles.docContainer}>
                <View style={styles.docHeader}>
                    <Text style={styles.docTitle}>Attachment</Text>
                    <TouchableOpacity onPress={onClose}>
                        <X color="#6B7280" size={24} />
                    </TouchableOpacity>
                </View>

                <View style={styles.docContent}>
                    <View style={styles.iconContainer}>
                        <FileText color="#2563EB" size={48} />
                    </View>
                    <Text style={styles.fileName}>{attachment.name || 'Document'}</Text>
                    <Text style={styles.fileSize}>{formatSize(attachment.size)}</Text>
                    
                    <TouchableOpacity style={styles.openButton} onPress={handleOpen}>
                        <ExternalLink color="#FFF" size={20} />
                        <Text style={styles.openButtonText}>Open / Download</Text>
                    </TouchableOpacity>
                    
                     <Text style={styles.warningText}>
                        Files are automatically deleted after 10 days.
                    </Text>
                </View>
            </View>
        </View>
    </Modal>
  );
};

// Thumbnail Component for Chat List
export const AttachmentThumbnail: React.FC<{ attachment: Attachment, isUploading?: boolean, onPress: () => void }> = ({ attachment, isUploading, onPress }) => {
    const isImage = attachment.type === 'image';
    const sourceUri = attachment.localUri || attachment.url;

    if (isImage) {
        return (
            <TouchableOpacity onPress={onPress} disabled={isUploading}>
                <View style={styles.thumbnailContainer}>
                    <Image 
                        source={{ uri: sourceUri }} 
                        style={[styles.thumbnailImage, isUploading && styles.uploadingOpacity]} 
                    />
                    {isUploading && (
                        <View style={styles.uploadingOverlay}>
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity style={styles.docThumbnail} onPress={onPress} disabled={isUploading}>
            <View style={styles.docIcon}>
                <FileText color="#2563EB" size={24} />
            </View>
            <View style={styles.docInfo}>
                <Text style={styles.docName} numberOfLines={1}>{attachment.name || 'Document'}</Text>
                <Text style={styles.docSize}>{formatSize(attachment.size)} • {attachment.type === 'document' ? 'DOC' : 'FILE'}</Text>
            </View>
            {isUploading ? (
                <ActivityIndicator size="small" color="#6B7280" />
            ) : (
                <Download color="#6B7280" size={20} />
            )}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 30,
    zIndex: 10,
    padding: 10,
  },
  imageContainer: {
    width: '100%',
    height: '80%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: Dimensions.get('window').width,
    height: '100%',
  },
  footer: {
      position: 'absolute',
      bottom: 50,
      width: '100%',
      alignItems: 'center',
  },
  footerText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
  },
  sizeText: {
       color: '#ccc',
      fontSize: 12,
  },
  docModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
  },
  docContainer: {
      backgroundColor: '#fff',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
  },
  docHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
  },
  docTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#1F2937',
  },
  docContent: {
      alignItems: 'center',
      paddingBottom: 20,
  },
  iconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: '#EBF5FF',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
  },
  fileName: {
      fontSize: 18,
      fontWeight: '600',
      color: '#1F2937',
      textAlign: 'center',
      marginBottom: 8,
  },
  fileSize: {
      fontSize: 14,
      color: '#6B7280',
      marginBottom: 24,
  },
  openButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: '#2563EB',
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      marginBottom: 16,
  },
  openButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
  },
  warningText: {
      fontSize: 12,
      color: '#EF4444',
      textAlign: 'center',
  },
  // Thumbnail styles
  thumbnailContainer: {
    position: 'relative',
    marginBottom: 4,
  },
  thumbnailImage: {
      width: 200,
      height: 150,
      borderRadius: 8,
      backgroundColor: '#E5E7EB',
  },
  uploadingOpacity: {
      opacity: 0.6,
  },
  uploadingOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.2)',
      borderRadius: 8,
  },
  docThumbnail: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#F3F4F6',
      padding: 12,
      borderRadius: 8,
      width: 250,
      gap: 12,
      marginBottom: 4,
  },
  docIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: '#EBF5FF',
      justifyContent: 'center',
      alignItems: 'center',
  },
  docInfo: {
      flex: 1,
  },
  docName: {
      fontSize: 14,
      fontWeight: '500',
      color: '#1F2937',
  },
  docSize: {
      fontSize: 12,
      color: '#6B7280',
  }
});
