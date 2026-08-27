import { api } from '@/services/api';
import { getUserMessage } from '@/services/errors';

export interface ProfilePictureUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  profilePicture?: string | null;
}

function inferMimeType(fileName?: string, mimeType?: string) {
  if (mimeType) {
    return mimeType;
  }

  const extension = fileName?.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
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

export async function uploadProfilePicture(
  file: { uri: string; type?: string; name?: string }
): Promise<ProfilePictureUser> {
  const fileName = file.name || 'profile.jpg';
  const mimeType = inferMimeType(fileName, file.type);

  const formData = new FormData();
  formData.append('image', {
    uri: file.uri,
    type: mimeType,
    name: fileName,
  } as unknown as Blob);

  const response = await api.post('/users/profile-picture', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
    transformRequest: (data) => data,
  });

  return response.data.user;
}

export async function removeProfilePicture(): Promise<ProfilePictureUser> {
  const response = await api.delete('/users/profile-picture');
  return response.data.user;
}

export function getProfilePictureErrorMessage(error: unknown): string {
  const message = getUserMessage(error);
  if (message.toLowerCase().includes('cloudinary')) {
    return 'Profile picture uploads are temporarily unavailable. Please try again later or contact support.';
  }
  return message;
}
