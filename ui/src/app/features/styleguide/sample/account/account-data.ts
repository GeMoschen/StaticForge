/** The sections of My account (M35.16), one page each. */
export type AccountSection = 'profile' | 'password' | 'preferences' | 'projects' | 'sessions';
export const ACCOUNT_SECTIONS: readonly AccountSection[] = ['profile', 'password', 'preferences', 'projects', 'sessions'];

export const SECTION_ICONS: Readonly<Record<AccountSection, string>> = {
  profile: 'person',
  password: 'key',
  preferences: 'tune',
  projects: 'folder_managed',
  sessions: 'devices',
};

export interface ProfileForm {
  readonly displayName: string;
  readonly username: string;
  readonly email: string;
}

export const PROFILE: ProfileForm = {
  displayName: 'Anna Berger',
  username: 'anna',
  email: 'anna.berger@lumen-coffee.example',
};

/** A person's role in a project, as the server names it; the screen shows the human label (`roles.*`), never this. */
export type ProjectRole = 'VIEWER' | 'EDITOR' | 'RELEASE_MANAGER' | 'DEVELOPER' | 'PROJECT_ADMIN';

export interface AccountProject {
  readonly key: string;
  readonly name: string;
  readonly role: ProjectRole;
}

export const ACCOUNT_PROJECTS: readonly AccountProject[] = [
  { key: 'DEMO', name: 'Demo site', role: 'PROJECT_ADMIN' },
  { key: 'LUMEN', name: 'Lumen Coffee', role: 'EDITOR' },
  { key: 'HARBOUR', name: 'Harbour Books', role: 'RELEASE_MANAGER' },
  { key: 'ATLAS', name: 'Atlas Docs', role: 'DEVELOPER' },
  { key: 'FIELD', name: 'Field Notes', role: 'VIEWER' },
];

/** What My projects shows: its data, a wait, a failure, or nothing (`acstate` in the URL). */
export type ProjectsStatus = 'ready' | 'loading' | 'error' | 'empty';
export const PROJECTS_STATUSES: readonly ProjectsStatus[] = ['ready', 'loading', 'error', 'empty'];
