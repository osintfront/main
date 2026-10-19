import type { PublicEvent } from '@/types/event';
import { demoCategoryRef } from './categoryRegistry';

/**
 * DEMONSTRATION DATA — not real reporting.
 * Shown only when Supabase is not configured, so the map can be tested
 * immediately. Timestamps are relative to page load.
 */
function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

export function buildDemoEvents(): PublicEvent[] {
  const base = {
    region: '',
    sourceType: 'manual_report' as const,
    translations: {},
  };
  return [
    {
      ...base,
      id: 'demo-ashkelon-sirens',
      title: 'Rocket sirens activated in Ashkelon',
      description:
        'Demo event. Sirens sounded across Ashkelon and nearby communities following a reported launch from the Gaza Strip. Residents were instructed to enter protected spaces.',
      severity: 'critical',
      latitude: 31.6688,
      longitude: 34.5743,
      locationName: 'Ashkelon',
      country: 'Israel',
      region: 'Southern District',
      city: 'Ashkelon',
      sourceName: 'Demo source',
      sourceUrl: null,
      occurredAt: minutesAgo(6),
      publishedAt: minutesAgo(5),
      isBreaking: true,
      isVerified: true,
      category: demoCategoryRef('missile-rocket-attack'),
    },
    {
      ...base,
      id: 'demo-jerusalem-wildfire',
      title: 'Large wildfire reported west of Jerusalem',
      description:
        'Demo event. Firefighting teams and aircraft are working to contain a brush fire in the forested hills west of the city. Route 1 traffic may be affected.',
      severity: 'high',
      latitude: 31.7795,
      longitude: 35.1325,
      locationName: 'Jerusalem Hills',
      country: 'Israel',
      region: 'Jerusalem District',
      city: 'Jerusalem',
      sourceName: 'Demo source',
      sourceUrl: null,
      occurredAt: minutesAgo(38),
      publishedAt: minutesAgo(35),
      isBreaking: false,
      isVerified: true,
      category: demoCategoryRef('fire'),
    },
    {
      ...base,
      id: 'demo-knesset-demonstration',
      title: 'Political demonstration outside the Knesset',
      description:
        'Demo event. Several hundred demonstrators gathered opposite the Knesset building. Police report the protest is proceeding without incident.',
      severity: 'low',
      latitude: 31.7767,
      longitude: 35.2054,
      locationName: 'Knesset, Givat Ram',
      country: 'Israel',
      region: 'Jerusalem District',
      city: 'Jerusalem',
      sourceName: null,
      sourceUrl: null,
      occurredAt: minutesAgo(95),
      publishedAt: minutesAgo(90),
      isBreaking: false,
      isVerified: false,
      category: demoCategoryRef('protest-civil-unrest'),
    },
    {
      ...base,
      id: 'demo-amman-talks',
      title: 'Regional diplomatic meeting convenes in Amman',
      description:
        'Demo event. Foreign ministry delegations met in Amman to discuss border crossings and humanitarian access. A joint statement is expected later today.',
      severity: 'medium',
      latitude: 31.9539,
      longitude: 35.9106,
      locationName: 'Amman',
      country: 'Jordan',
      region: 'Amman Governorate',
      city: 'Amman',
      sourceName: 'Demo source',
      sourceUrl: null,
      occurredAt: minutesAgo(180),
      publishedAt: minutesAgo(170),
      isBreaking: false,
      isVerified: true,
      category: demoCategoryRef('political-event'),
    },
    {
      ...base,
      id: 'demo-haifa-port-power',
      title: 'Power fault halts operations at Haifa port',
      description:
        'Demo event. A power failure suspended cargo handling at several terminals. The electricity company says crews are on site and service should resume within hours.',
      severity: 'medium',
      latitude: 32.8191,
      longitude: 35.0011,
      locationName: 'Haifa Port',
      country: 'Israel',
      region: 'Haifa District',
      city: 'Haifa',
      sourceName: null,
      sourceUrl: null,
      occurredAt: minutesAgo(260),
      publishedAt: minutesAgo(250),
      isBreaking: false,
      isVerified: false,
      category: demoCategoryRef('infrastructure-incident'),
    },
  ];
}
