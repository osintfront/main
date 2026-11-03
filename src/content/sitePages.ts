/**
 * Text of the public information pages (About, Privacy policy, Contact).
 * Hebrew is the main language; English mirrors it. Inline links: [text](url).
 * When the text changes, update UPDATED (shown on each page).
 */
export const SITE_EMAIL = 'service@osintfront.com';
export const SITE_NAME = 'Osintfront';
export const SITE_DOMAIN = 'osintfront.com';
export const UPDATED = '2026-11-03';

export type PageId = 'about' | 'privacy' | 'terms' | 'refund' | 'contact';

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
          h: 'חשבון משתמש',
          p: ['המפה, הפיד והארכיון זמינים למשתמשים רשומים בלבד. עמודי המידע (אודות, תנאי שימוש, פרטיות, יצירת קשר) פתוחים לכולם.'],
        },
        {
          h: 'מידע שנשמר בדפדפן שלכם',
          p: ['האתר שומר בדפדפן (localStorage) רק מידע הכרחי לפעולתו: אסימון ההתחברות (כדי שתישארו מחוברים) והעדפות — שפה, מצב כהה/בהיר, הגדרות צליל וסינון. ההעדפות לא נשלחות אלינו ואפשר למחוק את הכול בכל עת מהגדרות הדפדפן (מחיקה תנתק אתכם מהחשבון).'],
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
            'האתר מציג פרסומות של Google AdSense לגולשים שאינם רשומים ולמשתמשי החבילה החינמית (מנויי Pro ו-Max אינם רואים פרסומות). Google וספקים צד שלישי משתמשים בעוגיות כדי להציג מודעות על סמך ביקורים קודמים באתר זה ובאתרים אחרים. ניתן לבטל פרסום מותאם אישית בהגדרות המודעות של Google (https://adssettings.google.com) או באתר www.aboutads.info. לגולשים מהאזור הכלכלי האירופי, בריטניה ושווייץ מוצג חלון הסכמה מוסמך של Google לפני השימוש בעוגיות לפרסום. מידע נוסף: https://policies.google.com/technologies/partner-sites.',
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
          h: 'מידע שנשמר על בעלי חשבון',
          ul: [
            'פרטי החשבון: שם, כתובת מייל, תפקיד, סטטוס, מסלול מנוי ומועד הכניסה האחרונה.',
            'חיבורים פעילים: סוג מכשיר ודפדפן ומועדי פעילות — כדי לאפשר חיבור פעיל אחד לכל חשבון ולזהות שימוש לא מורשה.',
            'אישור תנאי השימוש: גרסת התנאים שאושרה, מועד האישור וכתובת IP — לתיעוד ההסכמה.',
            'התראות push (למי שהפעיל): כתובת המנוי של הדפדפן, שפה והעדפות סינון.',
            'לצוות העריכה: תיעוד פעולות עריכה בבק-אופיס.',
          ],
          p: ['המידע נשמר כל עוד החשבון פעיל, ונמחק לבקשתכם או עם מחיקת החשבון, למעט מה שנדרש לשמור על פי דין. **משך שמירה מדויק לכל סוג מידע — דורש בדיקה משפטית.**'],
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
          h: 'חשבון משתמש',
          p: ['השימוש במפה, בפיד ובארכיון מחייב חשבון. החשבון אישי: אסור להעביר או לשתף אותו, וניתן להיות מחובר ממכשיר אחד בכל פעם. אתם אחראים לסודיות פרטי ההתחברות ולכל פעולה שתתבצע דרך החשבון. נוכל להשעות או לסגור חשבון שהופרו בו תנאים אלה.'],
        },
        {
          h: 'מנויים ותשלום',
          p: [
            'באתר מוצגים מסלולי מנוי (Free / Pro / Max) שטרם הופעלו לגבייה בפועל. כאשר תופעל גבייה, יעודכנו תנאים אלה בפרטי מחיר ואמצעי תשלום, וזכות הביטול תפעל לפי [מדיניות הביטולים וההחזרים](/refund-policy).',
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
    refund: {
      title: 'מדיניות ביטולים והחזרים',
      intro: `מסלולי המנוי (Free / Pro / Max) טרם הופעלו לגבייה בפועל. הטקסט הבא מתאר את המדיניות שתחול כאשר תופעל גבייה, לפי חוק הגנת הצרכן, התשמ"א-1981 ותקנות ביטול עסקה.`,
      sections: [
        {
          h: 'ביטול בתוך 14 יום',
          p: [`ניתן לבטל עסקת מנוי בתוך 14 יום ממועד ביצועה, ובלבד שהביטול נעשה לפחות יומיים שלפני מועד תחילת השירות (אם רלוונטי). הודעת ביטול תימסר בכתב ב-${mail}.`],
        },
        {
          h: 'אם השירות כבר החל',
          p: [
            'אם בעת הודעת הביטול המנוי כבר היה פעיל ונעשה בו שימוש, אנחנו רשאים לגבות תשלום יחסי בעד התקופה שבה השירות ניתן בפועל עד מועד הביטול (לדוגמה: שימוש של יומיים מתוך חודש מנוי — חיוב יחסי לשני הימים).',
            'בנוסף, אנחנו רשאים לגבות דמי ביטול בגובה **5% ממחיר העסקה, או 100 ש״ח — לפי הנמוך מביניהם**.',
          ],
        },
        {
          h: 'איך לבטל',
          p: [`לביטול מנוי כתבו לנו ב-${mail} עם פרטי החשבון. ההחזר (בניכוי הסכומים שלעיל, אם רלוונטי) יבוצע באותו אמצעי תשלום ששימש לרכישה, בתוך פרק הזמן הקבוע בחוק.`],
        },
        {
          h: 'ביטול עסקה בשל פגם או אי-התאמה',
          p: ['בוטלה העסקה עקב פגם בשירות או אי-התאמה בין השירות לבין הפרטים שנמסרו אודותיו, לא ייגבו דמי ביטול וההחזר יהיה מלא.'],
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
        { h: 'User account', p: ['The map, feed and archive are available to registered users only. The information pages (About, Terms, Privacy, Contact) are open to everyone.'] },
        {
          h: 'Information stored in your browser',
          p: ['The site stores in your browser (localStorage) only what it needs to work: your sign-in token (to keep you signed in) and preferences — language, dark/light mode, sound and filter settings. Preferences are never sent to us, and you can clear everything in your browser settings at any time (clearing signs you out).'],
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
            'The site shows Google AdSense ads to visitors who are not signed in and to Free plan users (Pro and Max subscribers see no ads). Google and other third-party vendors use cookies to serve ads based on prior visits to this site and other sites. You can opt out of personalised advertising in Google Ad Settings (https://adssettings.google.com) or at www.aboutads.info. Visitors from the EEA, the UK and Switzerland are shown a Google-certified consent window before advertising cookies are used. More: https://policies.google.com/technologies/partner-sites.',
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
        {
          h: 'Information kept about account holders',
          ul: [
            'Account details: name, email, role, status, subscription tier and last sign-in time.',
            'Active sessions: device type, browser and activity times — to allow one active session per account and detect unauthorised use.',
            'Terms acceptance: the version accepted, when, and the IP address — to record your consent.',
            'Push alerts (if enabled): your browser\'s subscription address, language and filter preferences.',
            'For editing staff: a log of editing actions in the back office.',
          ],
          p: ['This is kept while the account is active and deleted on request or when the account is deleted, except where the law requires us to keep it. **Exact retention periods per data type need legal review.**'],
        },
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
          h: 'User account',
          p: ['Using the map, feed and archive requires an account. The account is personal: it may not be transferred or shared, and it can be signed in on one device at a time. You are responsible for keeping your login details confidential and for any action taken through the account. We may suspend or close an account used in breach of these terms.'],
        },
        {
          h: 'Subscriptions and payment',
          p: [
            'The site lists subscription tiers (Free / Pro / Max) not yet charged in practice. When billing is enabled, these terms will be updated with price and payment details, and the cancellation right will follow the [cancellation and refund policy](/refund-policy).',
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
    refund: {
      title: 'Cancellation and refund policy',
      intro: `The subscription tiers (Free / Pro / Max) are not yet charged in practice. The following describes the policy that will apply once billing is enabled, under the Israeli Consumer Protection Law, 1981 and its transaction-cancellation regulations.`,
      sections: [
        {
          h: 'Cancelling within 14 days',
          p: [`A subscription may be cancelled within 14 days of the purchase, provided cancellation is given at least two days before the service is due to start (where relevant). Send cancellation notice in writing to ${mail}.`],
        },
        {
          h: 'If the service has already started',
          p: [
            'If the subscription was already active and in use when you cancel, we may charge a proportional amount for the period actually provided up to the cancellation date (for example: two days of use out of a monthly subscription — a proportional charge for those two days).',
            'In addition, we may charge a cancellation fee of **5% of the transaction price, or ₪100 — whichever is lower**.',
          ],
        },
        {
          h: 'How to cancel',
          p: [`To cancel a subscription, write to ${mail} with your account details. The refund (less the amounts above, where applicable) will be made to the same payment method used for the purchase, within the period set by law.`],
        },
        {
          h: 'Cancellation due to a defect or mismatch',
          p: ['If the transaction is cancelled because of a defect in the service, or a mismatch between the service and what was described, no cancellation fee applies and the refund will be in full.'],
        },
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
