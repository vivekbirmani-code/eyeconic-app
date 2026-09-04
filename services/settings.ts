import { api } from './api';

/**
 * Whether public sign-up is currently enabled (admin-controlled).
 * Fails closed: any network or server error hides the Sign Up option
 * until the setting can be read again.
 */
export const fetchSignUpEnabled = async (): Promise<boolean> => {
  try {
    const response = await api.get<{ success?: boolean; signUpEnabled?: boolean }>(
      '/settings/public'
    );
    return response.data?.signUpEnabled === true;
  } catch {
    return false;
  }
};
