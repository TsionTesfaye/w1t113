export interface UserPreferences {
  userId: string;
  timezone: string;
  notificationCenterCollapsed: boolean;
}

export interface UserPreferencesRepository {
  getPreferences(userId: string): Promise<UserPreferences | null>;
  savePreferences(preferences: UserPreferences): Promise<void>;
}
