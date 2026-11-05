/** OFI Insights — fixed texts (intro, disclaimer, simplified model), Hebrew and English. */

export const OFI_TEXT = {
  he: {
    intro:
      'OFI הוא מערכת ניסיונית של OSINTFront שמעריכה את הסבירות לאירועים מסוימים ב-24 השעות הקרובות. ההערכה מחושבת באופן מתמטי ממקורות מידע גלויים – אירועים שנאספו באתר, שווקי תחזיות, נתונים פיננסיים והודעות רשמיות – ומתעדכנת בדרך כלל אחת ל-24 שעות.',
    disclaimer:
      '⚠️ מערכת ניסיונית – הערכה סטטיסטית בלבד. המידע מבוסס על מקורות גלויים וחישוב אוטומטי, עשוי להיות חלקי, שגוי או לא עדכני, ואינו מהווה תחזית ודאית, התרעה רשמית, מידע מודיעיני מוסמך או ייעוץ מכל סוג שהוא (לרבות ייעוץ ביטחוני, פיננסי או השקעות). אין להסתמך על המידע לצורך קבלת החלטות. בכל מצב חירום יש לפעול אך ורק לפי הנחיות פיקוד העורף והרשויות המוסמכות. השימוש במידע הוא באחריות המשתמש בלבד, ו-OSINTFront ומפעיליה לא יישאו באחריות לכל נזק, ישיר או עקיף, הנובע מהשימוש בו.',
    disclaimerShort:
      'מערכת ניסיונית: הערכה סטטיסטית בלבד, לא התרעה רשמית ולא ייעוץ. בחירום פעלו רק לפי הנחיות פיקוד העורף.',
    model: [
      'נקודת המוצא היא שיעור הבסיס: כמה פעמים אירוע כזה קרה בעבר ביום נתון.',
      'כל אות מזיז את ההערכה למעלה או למטה, לפי המשקל שלו ולפי כמה הקריאה של היום חריגה לעומת השבוע האחרון. נתון ישן נספר פחות.',
      'שווקי התחזיות מושכים את ההערכה לעבר מה שהסוחרים מצפים לו.',
      'התוצאה מוחלקת מול ההערכה הקודמת כדי למנוע קפיצות, חוץ ממצב שבו אותות חירום (סגירת מרחב אווירי, התרעות) נדלקים יחד. התוצאה תמיד בין 1% ל-95%.',
    ],
  },
  en: {
    intro:
      'OFI is an experimental OSINTFront system that estimates the likelihood of specific events in the next 24 hours. The estimate is calculated mathematically from open sources – events collected on the site, prediction markets, financial data and official announcements – and is usually updated once every 24 hours.',
    disclaimer:
      '⚠️ Experimental system – a statistical estimate only. The information is based on open sources and automatic calculation, may be incomplete, wrong or out of date, and is not a certain forecast, an official alert, authorized intelligence or advice of any kind (including security, financial or investment advice). Do not rely on it to make decisions. In any emergency, follow only the instructions of the Home Front Command and the competent authorities. Use of the information is solely at the user’s own risk, and OSINTFront and its operators accept no liability for any damage, direct or indirect, arising from its use.',
    disclaimerShort:
      'Experimental: a statistical estimate only, not an official alert or advice. In an emergency, follow only the Home Front Command.',
    model: [
      'It starts from the base rate: how often an event like this has happened on a given day.',
      'Each signal moves the estimate up or down, by its weight and by how unusual today’s reading is compared with the past week. Older data counts for less.',
      'Prediction markets pull the estimate toward what traders expect.',
      'The result is smoothed against the previous estimate to avoid jumps, unless emergency signals (airspace closure, alerts) fire together. It always stays between 1% and 95%.',
    ],
  },
} as const;
