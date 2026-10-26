import { Logo } from '@/components/common/Logo';
import { UserMenu } from '@/components/layout/UserMenu';
import { AccountPage } from '@/pages/admin/AccountPage';

/** Account settings for every signed-in member (also the "user" role, which has no back office). */
export function MemberAccountPage() {
  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <Logo />
        <UserMenu />
      </header>
      <main className="px-4 py-8">
        <AccountPage />
      </main>
    </div>
  );
}
