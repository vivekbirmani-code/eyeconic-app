// User domain types shared by the User Management tab and the user detail /
// create-user routes (moved out of app/(tabs)/users.tsx when those dialogs
// became expo-router screens).

export interface StudentProfile {
  mbbsBatch?: string;
  collegeName?: string;
  attemptNo?: number;
  batchType?: string;
  grandTestsGiven?: string;
  averageCorrects?: string;
  averageScore?: number;
  weakestSubjects?: string;
  targetBranch?: string;
  subscriptions?: string;
}

export interface Subject {
  _id: string;
  name: string;
  year: string;
  displayOrder: number;
}

export interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  profilePicture?: string | null;
  isActive?: boolean;
  isProfileComplete?: boolean;
  isFreeUser?: boolean;
  studentProfile?: StudentProfile;
  createdAt?: string;
  groups?: { _id: string; name: string }[];
  assignedMentors?: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
  }[];
  assignedSubjects?: Subject[];
}

export interface GroupAssignment {
  _id: string;
  name: string;
  description?: string;
  isAssigned: boolean;
}
