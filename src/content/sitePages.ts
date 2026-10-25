/**
 * Text of the public information pages (About, Privacy policy, Contact).
 * Hebrew is the main language; English mirrors it. Inline links: [text](url).
 * When the text changes, update UPDATED (shown on each page).
 */
export const SITE_EMAIL = 'osintfront@gmail.com';
export const SITE_NAME = 'Osintfront';
export const SITE_DOMAIN = 'osintfront.com';
export const UPDATED = '2026-10-22';

export type PageId = 'about' | 'privacy' | 'contact';

export interface PageSection {
  h?: string;
  p?: string[];
  ul?: string[];
}

export interface SitePage {
  title: string;
  intro: string;
  sections: PageSection[];
}

const mail = `[${SITE_EMAIL}](mailto:${SITE_EMAIL})`;

export const PAGES: Record<'he' | 'en', Record<PageId, SitePage>> = {
  he: {
    about: {
      title: 'אודות Osintfront',
      intro:
        'Osintfront היא מפה חיה של אירועי ביטחון, צבא ומדיניות בישראל ובמזרח התיכון. היא מרכזת דיווחים ממקורות פתוחים, ממקמת אותם על המפה ומציגה לכל אירוע את מקורותיו.',
      sections: [
        {
          h: 'מה תמצאו כאן',
          ul: [
            'מפה ופיד חי של אירועים, מסוננים לפי קטגוריה, אזור וזמן.',
            'התרעות פיקוד העורף (צבע אדום) כפוליגונים על המפה, מהפיד הציבורי של צופר.',
            'לכל אירוע: מיקום, זמן, תקציר בעברית, קישורים למקורות ולעיתים הערכת משמעויות אפשריות.',
            'ארכיון יומי של אירועים קודמים.',
          ],
        },
        {
          h: 'איך אנחנו עובדים',
          p: [
            'הדיווחים נאספים ממקורות פתוחים: אתרי חדשות ומכוני מחקר, ערוצי טלגרם ציבוריים, קבוצות דיווח וההתרעות הרשמיות של פיקוד העורף.',
            'העיבוד נעשה בסיוע בינה מלאכותית (AI) תחת בקרה של צוות האנליסטים: סיווג הדיווח, תרגום לעברית, תמצות, איחוד דיווחים כפולים על אותו אירוע ואיתור המיקום. הצוות רשאי לתקן, לאחד או להסיר כל אירוע.',
            'אנחנו לא מעתיקים כתבות. כל אירוע מוצג כתקציר קצר עם קישור למקור המלא, ודיווחים נוספים על אותו אירוע מופיעים תחת "מקורות".',
          ],
        },
        {
          h: 'חשוב לדעת',
          ul: [
            'האתר אינו ערוץ רשמי ואינו מחליף את פיקוד העורף. בזמן התרעה פעלו רק לפי הנחיות פיקוד העורף.',
            'דיווחים ראשוניים עלולים להיות חלקיים או שגויים. אנחנו מסמנים מיקום משוער ומעדכנים כשמתקבל מידע נוסף.',
            'מצאתם טעות? כתבו לנו ונתקן.',
          ],
        },
        {
          h: 'זכויות יוצרים ותמונות',
          p: [
            'תמונות וסרטונים באתר מגיעים ממקורות פתוחים ומוצגים עם קישור למקורם. השימוש ביצירות שבעליהן לא אותרו נעשה לפי סעיף 27א לחוק זכות יוצרים, התשס"ח-2007.',
            `בעלי זכויות ביצירה המופיעה באתר יכולים לפנות אלינו ב-${mail} והיא תוסר או יינתן קרדיט, לבחירתם. ראו גם [יצירת קשר](/contact).`,
          ],
        },
      ],
    },
    privacy: {
      title: 'מדיניות פרטיות',
      intro: `מדיניות זו מסבירה איזה מידע נאסף כשאתם משתמשים באתר ${SITE_DOMAIN} (להלן "האתר"), המופעל על ידי ${SITE_NAME}, ולאילו מטרות.`,
      sections: [
        {
          h: 'גלישה באתר',
          p: ['אין צורך להירשם כדי להשתמש באתר. אנחנו לא מבקשים מהגולשים שם, טלפון או פרטים מזהים אחרים.'],
        },
        {
          h: 'מידע שנשמר בדפדפן שלכם',
          p: ['האתר שומר בדפדפן (localStorage) העדפות בלבד: שפה, מצב כהה/בהיר, הגדרות צליל וסינון. המידע הזה לא נשלח אלינו ואפשר למחוק אותו בכל עת מהגדרות הדפדפן.'],
        },
        {
          h: 'סטטיסטיקה ותפעול',
          ul: [
            'אנחנו משתמשים ב-Vercel Web Analytics לספירת ביקורים מצטברת (כמה ביקורים, אילו עמודים, מאיזו מדינה). הכלי לא משתמש בעוגיות ולא מזהה גולשים בודדים.',
            'שרתי האחסון (Vercel) ומסד הנתונים (Supabase, באיחוד האירופי) רושמים נתונים טכניים כמו כתובת IP וסוג דפדפן לצורכי אבטחה ותפעול, לזמן מוגבל.',
          ],
        },
        {
          h: 'פרסומות ועוגיות של צד שלישי',
          p: [
            'האתר עשוי להציג פרסומות של Google ושל ספקים נוספים. ספקים אלה, ובהם Google, משתמשים בעוגיות כדי להציג מודעות על סמך ביקורים קודמים שלכם באתר זה או באתרים אחרים.',
            'השימוש של Google בעוגיות פרסום מאפשר לה ולשותפיה להציג לכם מודעות על סמך הביקורים שלכם באתרים שונים. אפשר לבטל פרסום מותאם אישית ב[הגדרות המודעות של Google](https://adssettings.google.com), ולקרוא [כיצד Google משתמשת במידע מאתרים שמשתמשים בשירותים שלה](https://policies.google.com/technologies/partner-sites).',
            'אפשר גם לבטל עוגיות של ספקי צד שלישי לפרסום מותאם אישית באתר [www.aboutads.info](https://www.aboutads.info/choices).',
            'גולשים מהאזור הכלכלי האירופי, בריטניה ושווייץ יתבקשו לתת או לסרב להסכמה לעוגיות פרסום בחלון הסכמה ייעודי לפני שייעשה בהן שימוש.',
          ],
        },
        {
          h: 'פנייה אלינו',
          p: [`אם תכתבו לנו במייל, נשתמש בכתובת ובתוכן הפנייה רק כדי להשיב לכם ולטפל בבקשה.`],
        },
        {
          h: 'צוות האתר',
          p: ['חשבונות משתמש קיימים רק לצוות האנליסטים, בהזמנה בלבד. פרטי הצוות (שם ומייל) נשמרים לצורך ניהול הגישה ותיעוד פעולות עריכה.'],
        },
        {
          h: 'שיתוף מידע',
          p: ['איננו מוכרים מידע אישי. מידע מועבר לספקי שירות (אחסון, מסד נתונים, פרסום) רק במידה הנדרשת להפעלת האתר, או כשהדבר נדרש על פי דין.'],
        },
        {
          h: 'קטינים',
          p: ['האתר אינו מיועד לילדים מתחת לגיל 13, ואיננו אוספים ביודעין מידע עליהם.'],
        },
        {
          h: 'הזכויות שלכם',
          p: [`לפי חוק הגנת הפרטיות, התשמ"א-1981, ולגולשים מאירופה גם לפי ה-GDPR, אתם רשאים לבקש לעיין במידע עליכם, לתקן אותו או למחוק אותו. פנו אלינו ב-${mail}.`],
        },
        {
          h: 'שינויים במדיניות',
          p: ['אנחנו עשויים לעדכן מדיניות זו. תאריך העדכון האחרון מופיע בראש העמוד.'],
        },
      ],
    },
    contact: {
      title: 'יצירת קשר',
      intro: `לכל פנייה כתבו לנו ב-${mail}. אנחנו משתדלים להשיב תוך כמה ימי עבודה.`,
      sections: [
        {
          h: 'תיקון טעות בדיווח',
          p: ['ציינו את כותרת האירוע או צרפו קישור אליו (כפתור "שיתוף" או כתובת הדף), ומה לדעתכם שגוי. מקור שמאמת את התיקון יעזור לנו.'],
        },
        {
          h: 'זכויות יוצרים ובקשות הסרה',
          p: ['בעלי זכויות ביצירה (תמונה, סרטון או טקסט) המופיעה באתר מתבקשים לכלול בפנייה:'],
          ul: [
            'קישור לאירוע או תיאור מדויק של היצירה באתר.',
            'פרטים המעידים על הבעלות ביצירה (למשל קישור לפרסום המקורי).',
            'מה אתם מבקשים: הסרה, או הוספת קרדיט וקישור.',
          ],
        },
        {
          h: 'דיווחים, שיתופי פעולה ופרסום',
          p: ['רוצים להציע מקור מידע, לשתף פעולה או לפרסם באתר? כתבו לנו באותה כתובת.'],
        },
      ],
    },
  },
  en: {
    about: {
      title: 'About Osintfront',
      intro:
        'Osintfront is a live map of security, military and political events in Israel and the Middle East. It gathers reports from open sources, places them on the map and shows the sources of every event.',
      sections: [
        {
          h: 'What you will find here',
          ul: [
            'A live map and feed of events, filterable by category, area and time.',
            'Home Front Command alerts (red alerts) as areas on the map, from the public Tzofar feed.',
            'For every event: place, time, a Hebrew summary, links to the sources and sometimes possible implications.',
            'A daily archive of past events.',
          ],
        },
        {
          h: 'How we work',
          p: [
            'Reports come from open sources: news sites and research institutes, public Telegram channels, reporting groups and the official Home Front Command alerts.',
            'Processing is assisted by artificial intelligence (AI) under the oversight of our analysts: classifying the report, translating it into Hebrew, summarising it, merging duplicate reports of the same event and locating it. Analysts may correct, merge or remove any event.',
            'We do not copy articles. Each event is a short summary with a link to the full source; further reports of the same event are listed under "Sources".',
          ],
        },
        {
          h: 'Please note',
          ul: [
            'This site is not an official channel and does not replace the Home Front Command. During an alert, follow Home Front Command instructions only.',
            'First reports may be partial or wrong. We mark approximate locations and update as more information arrives.',
            'Found a mistake? Write to us and we will fix it.',
          ],
        },
        {
          h: 'Copyright and images',
          p: [
            'Images and videos come from open sources and are shown with a link to where they were published. Works whose owners could not be found are used under section 27A of the Israeli Copyright Act, 2007.',
            `If you own the rights to a work shown here, write to ${mail} and it will be removed or credited, as you prefer. See also [Contact](/contact).`,
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy policy',
      intro: `This policy explains what information is collected when you use ${SITE_DOMAIN} ("the site"), operated by ${SITE_NAME}, and why.`,
      sections: [
        { h: 'Browsing the site', p: ['You do not need an account to use the site. We do not ask visitors for their name, phone number or other identifying details.'] },
        {
          h: 'Information stored in your browser',
          p: ['The site stores preferences only in your browser (localStorage): language, dark/light mode, sound and filter settings. This is never sent to us and you can clear it in your browser settings at any time.'],
        },
        {
          h: 'Statistics and operation',
          ul: [
            'We use Vercel Web Analytics to count visits in aggregate (how many visits, which pages, which country). It uses no cookies and does not identify individual visitors.',
            'Our hosting (Vercel) and database (Supabase, in the EU) log technical data such as IP address and browser type for security and operation, for a limited time.',
          ],
        },
        {
          h: 'Advertising and third-party cookies',
          p: [
            "The site may show ads from Google and other vendors. These vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites.",
            "Google's use of advertising cookies enables it and its partners to serve ads to you based on your visits to this and other sites. You can opt out of personalised advertising in [Google Ads Settings](https://adssettings.google.com), and read [how Google uses information from sites that use its services](https://policies.google.com/technologies/partner-sites).",
            'You can also opt out of third-party vendors’ cookies for personalised advertising at [www.aboutads.info](https://www.aboutads.info/choices).',
            'Visitors from the European Economic Area, the UK and Switzerland are asked to accept or refuse advertising cookies in a consent window before they are used.',
          ],
        },
        { h: 'Contacting us', p: ['If you email us, we use your address and message only to reply and handle your request.'] },
        { h: 'Site staff', p: ['User accounts exist only for our analysts, by invitation. Their name and email are kept to manage access and record editing actions.'] },
        {
          h: 'Sharing information',
          p: ['We do not sell personal information. Information is passed to service providers (hosting, database, advertising) only as needed to run the site, or where the law requires it.'],
        },
        { h: 'Children', p: ['The site is not intended for children under 13 and we do not knowingly collect information about them.'] },
        {
          h: 'Your rights',
          p: [`Under the Israeli Protection of Privacy Law, 1981, and for visitors from Europe also under the GDPR, you may ask to see, correct or delete information about you. Write to ${mail}.`],
        },
        { h: 'Changes to this policy', p: ['We may update this policy. The date of the last update is shown at the top of the page.'] },
      ],
    },
    contact: {
      title: 'Contact',
      intro: `For anything, write to ${mail}. We try to reply within a few working days.`,
      sections: [
        { h: 'Correcting a report', p: ['Give the event title or a link to it, and what you think is wrong. A source that confirms the correction helps.'] },
        {
          h: 'Copyright and removal requests',
          p: ['If you own the rights to a work (image, video or text) shown on the site, please include:'],
          ul: [
            'A link to the event, or an exact description of the work on the site.',
            'Details showing you own the work (for example a link to where you first published it).',
            'What you would like: removal, or a credit and link.',
          ],
        },
        { h: 'Tips, partnerships and advertising', p: ['Want to suggest a source, work with us or advertise on the site? Write to the same address.'] },
      ],
    },
  },
};
