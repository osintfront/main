/**
 * Welcome message for a new user (Users page → after "Create user").
 * Edit the text or the logo here. Placeholders: {name} {site_url} {email} {password} {plan}
 */
export const WELCOME_LOGO = '/icon-512.png'; // the app icon (512×512 PNG)
export const SITE_URL = 'https://osintfront.com';

export const WELCOME_TEMPLATE = `היי {name} 👋
ברוך הבא ל-OSINTFront! 🛰️
אנחנו שמחים שהצטרפת. מעכשיו יש לך גישה למפת המודיעין החיה שלנו: אירועים בזמן אמת, התרעות, תרגומים ותובנות, הכול במקום אחד.

🔐 פרטי ההתחברות שלך:
🌐 כתובת: {site_url}
📧 אימייל: {email}
🔑 סיסמה זמנית: {password}

📱 טיפ: אחרי ההתחברות, לחץ על "התקן את האפליקציה" בדף הבית כדי לקבל התראות ישירות לטלפון. אם יש לך שאלה או משהו לא עובד, אנחנו כאן בשבילך. ושיהיה בהצלחה! 🙏

צוות OSINTFront`;

export function welcomeText(v: { name: string; email: string; password: string; plan: string }): string {
  return WELCOME_TEMPLATE.replace(/\{name\}/g, v.name || v.email.split('@')[0])
    .replace(/\{site_url\}/g, SITE_URL)
    .replace(/\{email\}/g, v.email)
    .replace(/\{password\}/g, v.password)
    .replace(/\{plan\}/g, v.plan);
}
