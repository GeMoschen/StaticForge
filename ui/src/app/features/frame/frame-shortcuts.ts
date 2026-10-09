import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { railGroups } from '../../core/frame/rail-model';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { DensityService } from '../../core/ui/density.service';
import { ShortcutDef, ShortcutService } from '../../core/ui/shortcut.service';
import { ThemeService } from '../../core/ui/theme.service';
import { BuildDialogService } from '../publishing/runs/build-dialog/build-dialog.service';
import { HistoryDrawerStore } from '../history/history-drawer.store';

/** The `g` chords: the key after `g`, the rail item (`go.<id>`) and its route below the project (`[]` = the project's home). */
const GO_CHORDS: readonly { readonly key: string; readonly id: string; readonly route: readonly string[]; readonly name: string }[] = [
  { key: 'h', id: 'home', route: [], name: 'goHome' },
  { key: 'p', id: 'pages', route: ['pages'], name: 'goPages' },
  { key: 'm', id: 'media', route: ['media'], name: 'goMedia' },
  { key: 'c', id: 'content', route: ['content'], name: 'goContent' },
  { key: 'n', id: 'navigation', route: ['navigation'], name: 'goNavigation' },
  { key: 'l', id: 'globals', route: ['globals'], name: 'goGlobals' },
  { key: 't', id: 'templates', route: ['templates'], name: 'goTemplates' },
  { key: 'x', id: 'changes', route: ['changes'], name: 'goChanges' },
  { key: 'b', id: 'publishing', route: ['publishing'], name: 'goPublishing' },
  { key: 's', id: 'schedules', route: ['schedules'], name: 'goSchedules' },
  { key: ',', id: 'settings', route: ['settings'], name: 'goSettings' },
];

const item = (name: string) => `frame.shortcuts.items.${name}`;

/**
 * The app frame's shortcuts and palette actions (M35.14), registered for as long as the frame lives: the palette and
 * the sheet, the `g` chords to every screen, the sidebar, History, *Build now*, and the actions only the palette
 * offers (theme, density, developer mode, project switching, sign out). Call it from the frame's constructor.
 */
export function useFrameShortcuts(): void {
  const shortcuts = inject(ShortcutService);
  const router = inject(Router);
  const frame = inject(FrameContextStore);
  const developerMode = inject(DeveloperModeService);
  const permissions = inject(ProjectPermissionsStore);
  const preferences = inject(PreferencesService);
  const history = inject(HistoryDrawerStore);
  const buildDialog = inject(BuildDialogService);
  const theme = inject(ThemeService);
  const density = inject(DensityService);
  const session = inject(SessionService);

  const inProject = () => frame.location().kind === 'project';

  const chords: ShortcutDef[] = GO_CHORDS.map((chord) => ({
    id: `go.${chord.id}`,
    keys: `g ${chord.key}`,
    scope: 'global',
    group: 'goTo',
    description: item(chord.name),
    // Templates is the Develop group: it exists in developer mode only.
    enabled: () => inProject() && (chord.id !== 'templates' || developerMode.enabled()),
    handler: () => void router.navigate(['/p', frame.projectKey() ?? '', ...chord.route]),
  }));

  shortcuts.use([
    {
      id: 'palette',
      keys: 'Mod+K',
      scope: 'global',
      group: 'general',
      description: item('palette'),
      allowInInput: true,
      handler: () => shortcuts.openPalette(),
    },
    {
      id: 'sheet',
      keys: '?',
      scope: 'global',
      group: 'general',
      description: item('sheet'),
      handler: () => shortcuts.shortcutSheetOpen.set(true),
    },
    // The overlay stack closes the topmost overlay; listed so the sheet tells people about it.
    { id: 'close', keys: 'Escape', scope: 'global', group: 'general', description: item('close') },
    {
      id: 'rail',
      keys: '[',
      scope: 'global',
      group: 'general',
      description: item('rail'),
      enabled: () => railGroups({ location: frame.location(), developerMode: developerMode.enabled() }).length > 0,
      handler: () => preferences.setRailCollapsed(!preferences.railCollapsed()),
    },
    {
      id: 'history',
      keys: 'Alt+H',
      scope: 'global',
      group: 'general',
      description: item('history'),
      allowInInput: true,
      enabled: inProject,
      handler: () => history.toggle(),
      palette: { icon: 'history' },
    },
    {
      id: 'build',
      keys: 'Alt+Shift+B',
      scope: 'global',
      group: 'publishing',
      description: item('build'),
      allowInInput: true,
      enabled: () => inProject() && permissions.canIncrementalBuild(),
      handler: () => buildDialog.open(),
      palette: { icon: 'construction' },
    },
    ...chords,
    {
      id: 'theme',
      scope: 'global',
      group: 'general',
      description: item('themeDark'),
      handler: () => void theme.toggle(),
      palette: { icon: 'contrast', label: () => item(theme.theme() === 'dark' ? 'themeLight' : 'themeDark') },
    },
    {
      id: 'density',
      scope: 'global',
      group: 'general',
      description: item('densityCompact'),
      handler: () => void density.toggle(),
      palette: { icon: 'density_medium', label: () => item(density.density() === 'compact' ? 'densityComfortable' : 'densityCompact') },
    },
    {
      id: 'developer',
      scope: 'global',
      group: 'general',
      description: item('developerOn'),
      enabled: () => developerMode.available(),
      handler: () => developerMode.set(!developerMode.enabled()),
      palette: { icon: 'code', label: () => item(developerMode.enabled() ? 'developerOff' : 'developerOn') },
    },
    {
      id: 'switchProject',
      scope: 'global',
      group: 'general',
      description: item('switchProject'),
      handler: () => shortcuts.openPalette('@'),
      palette: { icon: 'swap_horiz' },
    },
    {
      id: 'signOut',
      scope: 'global',
      group: 'general',
      description: item('signOut'),
      handler: () => session.signOut(),
      palette: { icon: 'logout' },
    },
  ]);
}
