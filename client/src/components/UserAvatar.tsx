import { useState } from 'react';

type UserRole = 'admin' | 'mentor' | 'student' | string;

interface UserAvatarProps {
  name: string;
  imageUrl?: string | null;
  role?: UserRole;
  size?: number;
  className?: string;
  alt?: string;
}

function getRoleClasses(role?: UserRole) {
  switch (role) {
    case 'admin':
      return 'bg-rose-100 text-rose-500';
    case 'mentor':
      return 'bg-emerald-100 text-emerald-600';
    case 'student':
      return 'bg-blue-100 text-blue-600';
    default:
      return 'bg-teal-50 text-teal-600';
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
  className = '',
  alt,
}: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !imageFailed;
  const fontSize = Math.max(12, Math.round(size * 0.38));

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full ${getRoleClasses(role)} ${className}`}
      style={{ width: size, height: size }}
      aria-label={alt || `${name} avatar`}
    >
      {showImage ? (
        <img
          src={imageUrl!}
          alt={alt || `${name} avatar`}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="font-bold" style={{ fontSize }}>
          {getInitials(name)}
        </span>
      )}
    </div>
  );
}
