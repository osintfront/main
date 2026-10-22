import {
  FilePlus2,
  Cpu,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  Rss,
  ScrollText,
  Settings,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n';
import type { Permission } from '@/lib/permissions';

export interface AdminSection {
  id: string;
  path: string;
  /** Route pattern relative to /admin ('' = index). */
  route: string;
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
  icon: LucideIcon;
  /** Access requires ANY of these permissions. Used by both router and sidebar. */
  anyOf: readonly Permission[];
  /** Implementation phase from the requirements document. */
  phase: number;
  /** Database objects already in place behind the module. */
  backend?: string[];
  showInNav: boolean;
}

const EVENT_READERS: readonly Permission[] = ['event.view.internal', 'event.view.operational', 'event.edit.own'];

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: 'dashboard',
    path: '/admin',
    route: '',
    labelKey: 'admin.nav.dashboard',
    icon: LayoutDashboard,
    anyOf: ['dashboard.view'],
    phase: 1,
    showInNav: true,
  },
  {
    id: 'events',
    path: '/admin/events',
    route: 'events',
    labelKey: 'admin.nav.events',
    descriptionKey: 'admin.module.events',
    icon: ListChecks,
    anyOf: EVENT_READERS,
    phase: 2,
    backend: ['events', 'event_history', 'status workflow triggers', 'RLS'],
    showInNav: true,
  },
  {
    id: 'newEvent',
    path: '/admin/events/new',
    route: 'events/new',
    labelKey: 'admin.nav.newEvent',
    descriptionKey: 'admin.module.newEvent',
    icon: FilePlus2,
    anyOf: ['event.create'],
    phase: 2,
    backend: ['events.ai_suggestions', 'events.suggested_category_id', 'event_internal_notes'],
    showInNav: true,
  },
  {
    id: 'eventDetail',
    path: '/admin/events/:id',
    route: 'events/:id',
    labelKey: 'admin.nav.eventDetail',
    descriptionKey: 'admin.module.eventDetail',
    icon: ListChecks,
    anyOf: EVENT_READERS,
    phase: 2,
    backend: ['event_history', 'events.coordinates_manually_corrected'],
    showInNav: false,
  },
  {
    id: 'users',
    path: '/admin/users',
    route: 'users',
    labelKey: 'admin.nav.users',
    descriptionKey: 'admin.module.users',
    icon: Users,
    anyOf: ['user.manage', 'user.invite'],
    phase: 5,
    backend: ['profiles', 'administrator_invitations', 'role guard trigger', 'last-super-admin protection'],
    showInNav: true,
  },
  {
    id: 'categories',
    path: '/admin/categories',
    route: 'categories',
    labelKey: 'admin.nav.categories',
    descriptionKey: 'admin.module.categories',
    icon: Tags,
    anyOf: ['category.manage'],
    phase: 5,
    backend: ['event_categories (16 defaults)'],
    showInNav: true,
  },
  {
    id: 'newsAgents',
    path: '/admin/news-agents',
    route: 'news-agents',
    labelKey: 'admin.nav.newsAgents',
    descriptionKey: 'admin.module.newsAgents',
    icon: Rss,
    anyOf: ['dashboard.view'],
    phase: 3,
    backend: ['intel_agents', 'intel_sources', 'intel_items', 'intel-crawler Edge Function'],
    showInNav: true,
  },
  {
    id: 'learning',
    path: '/admin/learning',
    route: 'learning',
    labelKey: 'admin.nav.learning',
    descriptionKey: 'admin.module.learning',
    icon: GraduationCap,
    anyOf: ['dashboard.view'],
    phase: 3,
    backend: ['learned_places', 'category_corrections', 'events_learn_from_correction trigger'],
    showInNav: true,
  },
  {
    id: 'aiUsage',
    path: '/admin/ai-usage',
    route: 'ai-usage',
    labelKey: 'admin.nav.aiUsage',
    descriptionKey: 'admin.module.aiUsage',
    icon: Cpu,
    anyOf: ['dashboard.view'],
    phase: 3,
    backend: ['ai_usage', 'ai_usage_daily view'],
    showInNav: true,
  },
  {
    id: 'audit',
    path: '/admin/audit-log',
    route: 'audit-log',
    labelKey: 'admin.nav.audit',
    descriptionKey: 'admin.module.audit',
    icon: ScrollText,
    anyOf: ['audit.view'],
    phase: 5,
    backend: ['audit_logs (written by triggers)'],
    showInNav: true,
  },
  {
    id: 'settings',
    path: '/admin/settings',
    route: 'settings',
    labelKey: 'admin.nav.settings',
    descriptionKey: 'admin.module.settings',
    icon: Settings,
    anyOf: ['settings.manage'],
    phase: 1,
    showInNav: true,
  },
];

export function sectionById(id: string): AdminSection {
  const section = ADMIN_SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown admin section: ${id}`);
  return section;
}
