import { useRef, useState, useEffect } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import UserAvatar from './UserAvatar';
import { api } from '../services/api';
import { getUserMessage } from '../services/errors';

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
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function ProfilePictureManager({
  name,
  role,
  imageUrl,
  size = 96,
  editable = true,
  showActionLabels = true,
  onUpdated,
}: ProfilePictureManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(imageUrl || null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    setCurrentImageUrl(imageUrl || null);
  }, [imageUrl]);

  const validateFile = (file: File) => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      throw new Error('Unsupported image type. Please choose a JPEG, PNG, or WebP image.');
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error('Image is too large. Maximum size is 5MB.');
    }
  };

  const uploadFile = async (file: File) => {
    validateFile(file);
    const formData = new FormData();
    formData.append('image', file);

    const response = await api.post('/users/profile-picture', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const updatedUser = response.data.user;
    setCurrentImageUrl(updatedUser.profilePicture || null);
    onUpdated?.(updatedUser.profilePicture || null);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editable || isBusy) {
      return;
    }

    try {
      setIsBusy(true);
      await uploadFile(file);
      alert('Profile picture updated successfully.');
    } catch (error) {
      alert(getUserMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!editable || isBusy || !currentImageUrl) {
      return;
    }

    if (!window.confirm('Are you sure you want to remove your profile picture?')) {
      return;
    }

    try {
      setIsBusy(true);
      const response = await api.delete('/users/profile-picture');
      const updatedUser = response.data.user;
      setCurrentImageUrl(updatedUser.profilePicture || null);
      onUpdated?.(updatedUser.profilePicture || null);
      alert('Your profile picture has been removed.');
    } catch (error) {
      alert(getUserMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        className={`relative rounded-full ${editable && !isBusy ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
        onClick={() => editable && !isBusy && fileInputRef.current?.click()}
        disabled={!editable || isBusy}
        aria-label={editable ? 'Change profile picture' : `${name} profile picture`}
      >
        <UserAvatar name={name} role={role} imageUrl={currentImageUrl} size={size} />
        {editable && (
          <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#01b4ae] text-white">
            {isBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Camera size={14} />}
          </span>
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {editable && showActionLabels && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="rounded-lg border border-[#01b4ae]/25 bg-[#01b4ae]/10 px-4 py-2 text-sm font-semibold text-[#01b4ae] disabled:opacity-60"
          >
            {currentImageUrl ? 'Change Photo' : 'Upload Photo'}
          </button>
          {currentImageUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isBusy}
              className="flex items-center gap-2 text-sm font-semibold text-red-500 disabled:opacity-60"
            >
              <Trash2 size={16} />
              Remove Photo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
