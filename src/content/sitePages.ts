/**
 * Text of the public information pages (About, Privacy policy, Contact).
 * Hebrew is the main language; English mirrors it. Inline links: [text](url).
 * When the text changes, update UPDATED (shown on each page).
 */
export const SITE_EMAIL = 'service@osintfront.com';
export const SITE_NAME = 'Osintfront';
export const SITE_DOMAIN = 'osintfront.com';
export const UPDATED = '2026-11-02';

export type PageId = 'about' | 'privacy' | 'terms' | 'contact';

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
      intro: `מדיניות זו מסבירה איזה מידע נאסף כשאתם משתמשים באתר ${SITE_DOMAIN} (להלן "האתר"), המופעל על ידי ${SITE_NAME} כעסק פרטי (עצמאי, ללא תאגיד רשום), ולאילו מטרות.`,
      sections: [
        {
          h: 'גיל מינימום',
          p: ['בשל אופי התוכן (אירועי ביטחון וצבא, לרבות תיאורים ותמונות קשים) האתר מיועד למשתמשים בני 18 ומעלה בלבד. איננו אוספים ביודעין מידע על מי שמתחת לגיל זה, ואם נודע לנו על כך נמחק את המידע.'],
        },
        {
          h: 'גלישה באתר',
          p: ['אין צורך להירשם כדי לצפות במפה הציבורית. אנחנו לא מבקשים מגולשים שם, טלפון או פרטים מזהים אחרים.'],
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
            'נכון לעכשיו האתר אינו מציג פרסומות של צד שלישי. בעתיד האתר עשוי להציג פרסומות של Google או ספקים נוספים, שישתמשו בעוגיות להצגת מודעות על סמך ביקורים קודמים. אם וכאשר יופעל פרסום כזה, נעדכן סעיף זה ונציג חלון הסכמה לעוגיות לא־הכרחיות לפני הפעלתן.',
            'אפשר כבר היום לבטל מראש פרסום מותאם אישית ב[הגדרות המודעות של Google](https://adssettings.google.com) ובאתר [www.aboutads.info](https://www.aboutads.info/choices).',
          ],
        },
        {
          h: 'הודעות דחיפה (push) ומייל',
          p: [
            'מי שנרשם להתראות מקבל הודעות push ו/או מייל תפעוליים בלבד: התראות פיקוד העורף שביקשתם, איפוס סיסמה והתראות חשבון. איננו שולחים כיום תוכן שיווקי.',
            'אם בעתיד נוסיף תוכן שיווקי בערוצים אלה, הדבר ייעשה רק לאחר הסכמה נפרדת ומפורשת (אופט-אין), ובכל הודעה שיווקית תתאפשר הסרה מיידית, בהתאם לחוק התקשורת (תיקון 40).',
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
          h: 'מנויים בתשלום',
          p: ['האתר כולל מסלולי מנוי (Free / Pro / Max) שטרם הופעלו לגבייה בפועל. כאשר ייפתחו לגבייה, נעדכן מדיניות זו ואת [תנאי השימוש](/terms) בהתאם לחוק הגנת הצרכן, לרבות זכות ביטול בתוך 14 יום.'],
        },
        {
          h: 'שיתוף מידע',
          p: ['איננו מוכרים מידע אישי. מידע מועבר לספקי שירות (אחסון, מסד נתונים) רק במידה הנדרשת להפעלת האתר, או כשהדבר נדרש על פי דין.'],
        },
        {
          h: 'הזכויות שלכם',
          p: [`לפי חוק הגנת הפרטיות, התשמ"א-1981 (לרבות תיקון 13), ולגולשים מאירופה גם לפי ה-GDPR, אתם רשאים לבקש לעיין במידע עליכם, לתקן אותו או למחוק אותו. פנו אלינו ב-${mail}.`],
        },
        {
          h: 'שינויים במדיניות',
          p: ['אנחנו עשויים לעדכן מדיניות זו. תאריך העדכון האחרון מופיע בראש העמוד. שינוי מהותי יוצג גם במסך אישור תנאים בכניסה למערכת.'],
        },
      ],
    },
    terms: {
      title: 'תנאי שימוש',
      intro: `תנאים אלה חלים על השימוש באתר ${SITE_DOMAIN} (להלן "האתר"), המופעל על ידי ${SITE_NAME} כעסק פרטי (עצמאי). שימוש באתר מהווה הסכמה לתנאים אלה ולמדיניות הפרטיות.`,
      sections: [
        {
          h: 'כשירות וגיל',
          p: ['השימוש באתר מיועד לבני 18 ומעלה בלבד, בשל אופי התוכן. ביצוע פעולה באתר (לרבות הרשמה או אישור תנאים) מהווה הצהרה שגילכם 18 ומעלה.'],
        },
        {
          h: 'אופי השירות',
          p: [
            'האתר מציג מידע שמקורו בדיווחים ממקורות פתוחים (חדשות, ערוצי טלגרם ציבוריים, התרעות רשמיות), מעובד בסיוע בינה מלאכותית תחת בקרת צוות אנליסטים.',
            'האתר אינו ערוץ רשמי ואינו תחליף להנחיות פיקוד העורף או כל גורם ביטחוני רשמי. בזמן אמת יש לפעול אך ורק לפי ההנחיות הרשמיות.',
            'המידע מוצג "כפי שהוא" (as is). איננו מתחייבים לדיוק, שלמות או עדכניות מלאה של כל דיווח, ואיננו אחראים להחלטות שתתקבלו על בסיסו.',
          ],
        },
        {
          h: 'קניין רוחני ואיסור שימוש לרעה',
          p: [
            'כל זכויות הקניין הרוחני באתר — לרבות עיצוב, קוד, מבנה מסד הנתונים, לוגו וסימני מסחר — שייכות למפעיל האתר, אלא אם צוין אחרת.',
            'תוכן הדיווחים המקורי (תמונות, סרטונים, ציטוטים) שייך לבעליו המקורי ומוצג בהתאם לסעיף "זכויות יוצרים ותמונות" בעמוד [אודות](/about).',
          ],
          ul: [
            'אסור להעתיק, לשכפל, להפיץ מחדש בהיקף מסחרי, לבצע reverse engineering, או ל"גרד" (scrape) את האתר באופן אוטומטי ושיטתי ללא אישור מראש ובכתב.',
            'אסור לעקוף אמצעי הגנה טכנולוגיים של האתר (לרבות הגבלות קצב, אימות משתמשים) או לנסות לקבל גישה לחלקים לא ציבוריים של המערכת.',
            'אסור להשתמש באתר למטרה בלתי חוקית, או באופן שפוגע בזמינותו לאחרים (למשל עומס מכוון על השרתים).',
          ],
        },
        {
          h: 'חשבונות צוות',
          p: ['חשבונות התחברות קיימים כיום רק לצוות האתר, בהזמנה. משתמש אחראי לסודיות פרטי ההתחברות שלו ולכל פעולה שתתבצע דרך חשבונו.'],
        },
        {
          h: 'מנויים ותשלום',
          p: [
            'באתר מוצגים מסלולי מנוי (Free / Pro / Max) שטרם הופעלו לגבייה בפועל. תנאים אלה יעודכנו לפני הפעלת גבייה בפועל, לרבות פרטי מחיר, אמצעי תשלום וזכות ביטול עסקה בתוך 14 יום בהתאם לחוק הגנת הצרכן, התשמ"א-1981.',
            'ראו גם [מדיניות ביטולים והחזרים](/refund-policy) — **הטקסט בעמוד זה טרם הושלם ודורש בדיקה משפטית לפני הפעלת גבייה.**',
          ],
        },
        {
          h: 'הגבלת אחריות',
          p: ['השירות ניתן כמות שהוא (AS IS), ללא אחריות מכל סוג. ככל שיתאפשר על פי דין, מפעיל האתר לא יישא באחריות לנזק עקיף, תוצאתי או מיוחד שייגרם משימוש באתר או הסתמכות על תוכנו.'],
        },
        {
          h: 'שינוי והפסקת השירות',
          p: ['מפעיל האתר רשאי לשנות, להשעות או להפסיק את השירות, כולו או חלקו, בכל עת. שינוי מהותי בתנאים אלה יוצג למשתמשים הרשומים לאישור מחדש.'],
        },
        {
          h: 'דין וסמכות שיפוט',
          p: ['על תנאים אלה יחולו דיני מדינת ישראל, וסמכות השיפוט הבלעדית נתונה לבתי המשפט המוסמכים בישראל. **נקודה זו, כמו גם אכיפה מול משתמשים מחוץ לישראל, דורשת בדיקה משפטית.**'],
        },
        {
          h: 'יצירת קשר',
          p: [`שאלות על תנאים אלה: ${mail}. ראו גם [מדיניות הפרטיות](/privacy).`],
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
      intro: `This policy explains what information is collected when you use ${SITE_DOMAIN} ("the site"), operated by ${SITE_NAME} as a private (sole-proprietor, unincorporated) business, and why.`,
      sections: [
        {
          h: 'Minimum age',
          p: ['Because of the nature of the content (security and military events, including difficult descriptions and images), the site is intended for users aged 18 and over only. We do not knowingly collect information about anyone younger, and will delete it if we learn we have.'],
        },
        { h: 'Browsing the site', p: ['You do not need an account to view the public map. We do not ask visitors for their name, phone number or other identifying details.'] },
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
            'The site currently shows no third-party advertising. In the future it may show ads from Google or other vendors, who would use cookies to serve ads based on prior visits. If and when such advertising is enabled, this section will be updated and a consent window for non-essential cookies will be shown first.',
            'You can already opt out of personalised advertising in advance at [Google Ads Settings](https://adssettings.google.com) and at [www.aboutads.info](https://www.aboutads.info/choices).',
          ],
        },
        {
          h: 'Push notifications and email',
          p: [
            'Anyone who signs up for alerts gets operational push and/or email messages only: the Home Front Command alerts you asked for, password resets and account notices. We do not currently send marketing content.',
            'If we add marketing content to these channels in the future, it will only be after separate, explicit opt-in consent, with an immediate unsubscribe option on every marketing message, as required by Israeli telecom law (Amendment 40).',
          ],
        },
        { h: 'Contacting us', p: ['If you email us, we use your address and message only to reply and handle your request.'] },
        { h: 'Site staff', p: ['User accounts exist only for our analysts, by invitation. Their name and email are kept to manage access and record editing actions.'] },
        {
          h: 'Paid subscriptions',
          p: ['The site lists subscription tiers (Free / Pro / Max) that are not yet charged in practice. When billing is enabled, this policy and the [Terms of Use](/terms) will be updated accordingly, including consumer-protection rights such as a 14-day cancellation window.'],
        },
        {
          h: 'Sharing information',
          p: ['We do not sell personal information. Information is passed to service providers (hosting, database) only as needed to run the site, or where the law requires it.'],
        },
        {
          h: 'Your rights',
          p: [`Under the Israeli Protection of Privacy Law, 1981 (including Amendment 13), and for visitors from Europe also under the GDPR, you may ask to see, correct or delete information about you. Write to ${mail}.`],
        },
        { h: 'Changes to this policy', p: ['We may update this policy. The date of the last update is shown at the top of the page. A material change will also be shown on a terms-acceptance screen on sign-in.'] },
      ],
    },
    terms: {
      title: 'Terms of use',
      intro: `These terms govern use of ${SITE_DOMAIN} ("the site"), operated by ${SITE_NAME} as a private (sole-proprietor) business. Using the site means you accept these terms and the privacy policy.`,
      sections: [
        {
          h: 'Eligibility and age',
          p: ['The site is intended for users aged 18 and over only, given the nature of the content. Taking any action on the site (including registering or accepting these terms) is a representation that you are 18 or older.'],
        },
        {
          h: 'Nature of the service',
          p: [
            'The site shows information drawn from open-source reports (news, public Telegram channels, official alerts), processed with AI assistance under analyst oversight.',
            'The site is not an official channel and does not replace Home Front Command instructions or any official security body. In real time, follow official instructions only.',
            'Information is shown "as is". We do not warrant the accuracy, completeness or full timeliness of any report, and are not responsible for decisions made based on it.',
          ],
        },
        {
          h: 'Intellectual property and misuse',
          p: [
            'All intellectual-property rights in the site — including design, code, database structure, logo and trademarks — belong to the site operator, unless stated otherwise.',
            'Original report content (images, videos, quotes) belongs to its original owner and is shown per the "Copyright and images" section of the [About](/about) page.',
          ],
          ul: [
            'Copying, reproducing, redistributing at commercial scale, reverse-engineering, or systematically scraping the site without prior written permission is prohibited.',
            'Bypassing the site\'s technical protections (including rate limits, user authentication) or attempting to access non-public parts of the system is prohibited.',
            'Using the site for an unlawful purpose, or in a way that harms its availability to others (e.g. deliberate server load), is prohibited.',
          ],
        },
        {
          h: 'Staff accounts',
          p: ['Login accounts currently exist only for site staff, by invitation. A user is responsible for keeping their login details confidential and for any action taken through their account.'],
        },
        {
          h: 'Subscriptions and payment',
          p: [
            'The site lists subscription tiers (Free / Pro / Max) not yet charged in practice. These terms will be updated before billing is enabled, including price, payment method and a 14-day cancellation right under the Israeli Consumer Protection Law, 1981.',
            'See also [Refund and cancellation policy](/refund-policy) — **that page\'s text is not yet complete and needs legal review before billing is enabled.**',
          ],
        },
        {
          h: 'Limitation of liability',
          p: ['The service is provided AS IS, without warranty of any kind. To the extent permitted by law, the site operator is not liable for indirect, consequential or special damages arising from use of the site or reliance on its content.'],
        },
        {
          h: 'Changes and discontinuation',
          p: ['The site operator may change, suspend or discontinue the service, in whole or in part, at any time. A material change to these terms will be shown to registered users for re-acceptance.'],
        },
        {
          h: 'Governing law and jurisdiction',
          p: ['These terms are governed by the laws of the State of Israel, and the courts of Israel have exclusive jurisdiction. **This point, and enforcement against users outside Israel, needs legal review.**'],
        },
        { h: 'Contact', p: [`Questions about these terms: ${mail}. See also the [privacy policy](/privacy).`] },
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
