import type { ComponentType } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
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
};

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
          <BrowserRouter>
            <Routes>
              {/* Public — no login required */}
              <Route path="/archive" element={<MapPage mode="archive" />} />
              <Route path="/about" element={<SitePage page="about" />} />
              <Route path="/privacy" element={<SitePage page="privacy" />} />
              <Route path="/contact" element={<SitePage page="contact" />} />
              <Route path="/" element={<MapPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* Admin — every route is authenticated and permission-checked */}
              <Route
                path="/admin"
                element={
                  <RequireAuth anyOf={['dashboard.view']}>
                    <AdminLayout />
                  </RequireAuth>
                }
              >
                {ADMIN_SECTIONS.map((section) => {
                  const Page = IMPLEMENTED[section.id];
                  const element = (
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
                    <RequireAuth anyOf={['dashboard.view']} embedded>
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
