import type { ComponentType, ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { ADMIN_SECTIONS } from '@/config/adminSections';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/hooks/useAuth';
import { I18nProvider } from '@/i18n';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { MapPage } from '@/pages/public/MapPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { DashboardPage } from '@/pages/admin/DashboardPage';
import { EventsListPage } from '@/pages/admin/EventsListPage';
import { EventEditorPage } from '@/pages/admin/EventEditorPage';
import { ToastProvider } from '@/components/common/Toast';
import { AccountPage } from '@/pages/admin/AccountPage';
import { SettingsPage } from '@/pages/admin/SettingsPage';
import { NewsAgentsPage } from '@/pages/admin/NewsAgentsPage';
import { LearningPage } from '@/pages/admin/LearningPage';
import { AiUsagePage } from '@/pages/admin/AiUsagePage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { ModulePlaceholderPage } from '@/pages/admin/ModulePlaceholderPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SitePage } from '@/pages/public/SitePage';

/** Section id → page. Sections not listed render their phase placeholder. */
const IMPLEMENTED: Record<string, ComponentType> = {
  dashboard: DashboardPage,
  events: EventsListPage,
  newEvent: EventEditorPage,
  eventDetail: EventEditorPage,
  settings: SettingsPage,
  newsAgents: NewsAgentsPage,
  learning: LearningPage,
  aiUsage: AiUsagePage,
  users: UsersPage,
};

/** The back office home: the dashboard, or the events list for editors (no dashboard). */
function AdminHome({ children }: { children: ReactNode }) {
  const { can } = usePermissions();
  const { status } = useAuth();
  if (status === 'signed_in' && !can('dashboard.view') && can('admin.access')) return <Navigate to="/admin/events" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
          <BrowserRouter>
            <Routes>
              {/* Public — no login required */}
              {/* Members only: the map and the archive need a signed-in, active account. */}
              <Route path="/archive" element={<RequireAuth><MapPage mode="archive" /></RequireAuth>} />
              <Route path="/about" element={<SitePage page="about" />} />
              <Route path="/privacy" element={<SitePage page="privacy" />} />
              <Route path="/contact" element={<SitePage page="contact" />} />
              <Route path="/" element={<RequireAuth><MapPage /></RequireAuth>} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* Admin — every route is authenticated and permission-checked */}
              <Route
                path="/admin"
                element={
                  <RequireAuth anyOf={['admin.access']}>
                    <AdminLayout />
                  </RequireAuth>
                }
              >
                {ADMIN_SECTIONS.map((section) => {
                  const Page = IMPLEMENTED[section.id];
                  const element = section.route === '' ? (
                    <AdminHome>
                      <RequireAuth anyOf={section.anyOf} embedded>
                        {Page ? <Page /> : <ModulePlaceholderPage sectionId={section.id} />}
                      </RequireAuth>
                    </AdminHome>
                  ) : (
                    <RequireAuth anyOf={section.anyOf} embedded>
                      {Page ? <Page /> : <ModulePlaceholderPage sectionId={section.id} />}
                    </RequireAuth>
                  );
                  return section.route === '' ? (
                    <Route key={section.id} index element={element} />
                  ) : (
                    <Route key={section.id} path={section.route} element={element} />
                  );
                })}
                <Route
                  path="account"
                  element={
                    <RequireAuth anyOf={['admin.access']} embedded>
                      <AccountPage />
                    </RequireAuth>
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
