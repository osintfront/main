# הגדרת הרשמה (Google + אימייל) — פעולות בעל האתר

## 1. Google Cloud — יצירת OAuth Client
1. https://console.cloud.google.com → בחר/צור פרויקט "Osintfront".
2. APIs & Services → OAuth consent screen → External → שם האפליקציה "Osintfront", מייל תמיכה osintfront@gmail.com, דומיין osintfront.com, קישורים: https://osintfront.com/privacy ו-https://osintfront.com/terms → Publish app.
3. APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
4. Authorized JavaScript origins: `https://osintfront.com`
5. Authorized redirect URIs: `https://kbfggmvrfevstzneqfzf.supabase.co/auth/v1/callback`
6. שמור את ה-Client ID וה-Client secret.

## 2. Supabase — Authentication
1. Authentication → Sign In / Providers → Google → Enable → הדבק Client ID + Client secret → Save.
2. Authentication → Sign In / Providers → Email: **Allow new users to sign up = ON**, **Confirm email = ON**.
3. Authentication → URL Configuration: Site URL = `https://osintfront.com`; Redirect URLs כוללים `https://osintfront.com/**`.

## 3. בדיקה
- https://osintfront.com/login?mode=signup → "המשך עם Google" → חוזרים למפה מחוברים.
- הרשמה באימייל → מגיע מייל אימות → לחיצה → החשבון פעיל (חינמי).
