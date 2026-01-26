import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  Linking,
  Dimensions
} from 'react-native';
import { X, FileText, Download, ExternalLink } from 'lucide-react-native';

interface Attachment {
  type: 'image' | 'video' | 'document';
  url: string;
  name?: string;
  size?: number;
  mimeType?: string;
  publicId?: string;
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

  const handleOpen = () => {
    Linking.openURL(attachment.url).catch(err => console.error("Couldn't load page", err));
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
export const AttachmentThumbnail: React.FC<{ attachment: Attachment, onPress: () => void }> = ({ attachment, onPress }) => {
    if (attachment.type === 'image') {
        return (
            <TouchableOpacity onPress={onPress}>
                <Image 
                    source={{ uri: attachment.url }} 
                    style={styles.thumbnailImage} 
                />
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity style={styles.docThumbnail} onPress={onPress}>
            <View style={styles.docIcon}>
                <FileText color="#2563EB" size={24} />
            </View>
            <View style={styles.docInfo}>
                <Text style={styles.docName} numberOfLines={1}>{attachment.name || 'Document'}</Text>
                <Text style={styles.docSize}>{formatSize(attachment.size)} • {attachment.type === 'document' ? 'DOC' : 'FILE'}</Text>
            </View>
             <Download color="#6B7280" size={20} />
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
  thumbnailImage: {
      width: 200,
      height: 150,
      borderRadius: 8,
      backgroundColor: '#E5E7EB',
      marginBottom: 4,
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
