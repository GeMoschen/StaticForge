/** The sections of My account (M35.16), in menu order; the id is the route (`/account/<id>`). */
export const ACCOUNT_SECTIONS = ['profile', 'password', 'preferences', 'projects', 'sessions'] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

export const SECTION_ICONS: Readonly<Record<AccountSection, string>> = {
  profile: 'person',
  password: 'key',
  preferences: 'tune',
  projects: 'folder_managed',
  sessions: 'devices',
};

/** The sections with an explicit save (Preferences apply at once; the other two only read). */
export const SAVEABLE_SECTIONS: readonly AccountSection[] = ['profile', 'password'];
