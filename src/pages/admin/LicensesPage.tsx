import { LicensePanel } from '@/components/admin/LicensePanel';

/** Super admin: eval licenses — create, revoke, delete. */
export function LicensesPage() {
  return (
    <div dir="rtl" className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">רישוי</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">"ביטול" משאיר את הרישיון ברשימה כמבוטל. "מחיקה" מבטלת אותו ומוחקת אותו לגמרי.</p>
      <LicensePanel />
    </div>
  );
}
