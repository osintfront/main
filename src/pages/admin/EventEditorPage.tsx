import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, CheckCircle2, History, Lock, RotateCcw, Send, Trash2, Undo2, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n, type TranslationKey } from '@/i18n';
import { ACTION_TARGET, availableActions, canEditEvent, validateEvent, type FieldErrors, type WorkflowAction } from '@/lib/eventWorkflow';
import { fetchCategories } from '@/services/categoryService';
import {
  createEvent,
  eventToInput,
  getEvent,
  getHistory,
  getInternalNotes,
  restoreEvent,
  saveInternalNotes,
  softDeleteEvent,
  updateEvent,
} from '@/services/eventAdminService';
import { friendlyError } from '@/services/serviceError';
import { getCategoryIcon } from '@/data/categoryRegistry';
import type { GeocodeResult } from '@/services/geocodingService';
import type { EventCategory } from '@/types/category';
import { SEVERITIES, SOURCE_TYPES, type AdminEvent, type EventHistoryEntry, type EventInput, type EventStatus } from '@/types/event';
import { formatDateTime } from '@/utils/time';
import { StatusBadge } from '@/components/common/Badges';
import { Alert, Spinner } from '@/components/common/Feedback';
import { Button, SelectField, TextAreaField, TextField, ToggleField } from '@/components/common/Form';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { LocationPicker } from '@/components/admin/events/LocationPicker';

// ── datetime-local helpers (browser local time ⇄ ISO) ──────────────
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function emptyInput(): EventInput {
  return {
    title: '',
    description: '',
    originalReportText: '',
    categoryId: null,
    severity: 'medium',
    latitude: null,
    longitude: null,
    locationName: '',
    country: '',
    region: '',
    city: '',
    address: '',
    sourceName: '',
    sourceUrl: '',
    sourceType: 'manual_report',
    occurredAt: new Date().toISOString(),
    isBreaking: false,
    isVerified: false,
    geocodingConfidence: null,
    coordinatesManuallyCorrected: false,
  };
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
        {aside}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

const HISTORY_KEYS: Record<string, TranslationKey> = {
  created: 'history.created',
  edited: 'history.edited',
  submitted_for_review: 'history.submitted',
  published: 'history.published',
  approved_and_published: 'history.approved',
  rejected: 'history.rejected',
  archived: 'history.archived',
  returned_to_draft: 'history.toDraft',
  deleted: 'history.deleted',
  restored: 'history.restored',
  coordinates_corrected: 'history.coordinates',
};

type DialogKind = 'reject' | 'archive' | 'delete' | null;

export function EventEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const { t, locale, categoryLabel } = useI18n();
  const { user } = useAuth();
  const { can } = usePermissions();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [input, setInput] = useState<EventInput>(emptyInput);
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<EventHistoryEntry[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const cats = await fetchCategories();
      setCategories(cats.filter((c) => c.isActive));
      if (id) {
        const [ev, n, h] = await Promise.all([getEvent(id), getInternalNotes(id).catch(() => ''), getHistory(id).catch(() => [])]);
        setEvent(ev);
        setInput(eventToInput(ev));
        setNotes(n);
        setHistory(h);
      } else {
        setEvent(null);
        setInput(emptyInput());
        setNotes('');
        setHistory([]);
      }
      setErrors({});
    } catch (err) {
      setLoadError(friendlyError(err, t));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const who = useMemo(() => ({ can, userId: user?.id ?? null }), [can, user?.id]);
  const editable = isNew ? can('event.create') : !!event && canEditEvent(event, who);
  const actions = event ? availableActions(event, who) : [];
  const category = categories.find((c) => c.id === input.categoryId);

  const set = <K extends keyof EventInput>(key: K, value: EventInput[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const fillPlace = (r: GeocodeResult, overwrite: boolean) =>
    setInput((prev) => ({
      ...prev,
      locationName: overwrite || !prev.locationName ? r.locationName : prev.locationName,
      country: overwrite || !prev.country ? r.country : prev.country,
      region: overwrite || !prev.region ? r.region : prev.region,
      city: overwrite || !prev.city ? r.city : prev.city,
      address: overwrite || !prev.address ? r.address : prev.address,
    }));

  const errorText = (key: keyof FieldErrors) => {
    const k = errors[key];
    return k ? t(k as TranslationKey) : null;
  };

  /** Validate for the target status, then save (create or update). */
  const run = async (label: string, target: EventStatus, extra?: { rejectionReason?: string; skipValidation?: boolean }) => {
    if (busy) return;
    if (!extra?.skipValidation) {
      const v = validateEvent(input, target);
      setErrors(v);
      if (Object.keys(v).some((k) => v[k as keyof FieldErrors])) {
        toast.error(t('validation.fixFields'));
        return;
      }
    }
    setBusy(label);
    try {
      if (isNew) {
        const created = await createEvent(input, target, notes);
        toast.success(t(target === 'published' ? 'form.toastPublished' : target === 'pending_review' ? 'form.toastSubmitted' : 'form.toastDraft'));
        navigate(`/admin/events/${created.id}`, { replace: true });
        return;
      }
      if (!event) return;
      const updated = await updateEvent(event.id, editable ? input : null, {
        expectedStatus: event.status,
        status: target !== event.status ? target : undefined,
        rejectionReason: extra?.rejectionReason,
      });
      if (editable) await saveInternalNotes(event.id, notes).catch(() => undefined);
      setEvent(updated);
      setInput(eventToInput(updated));
      setHistory(await getHistory(event.id).catch(() => history));
      toast.success(
        t(
          target === event.status
            ? 'form.toastSaved'
            : target === 'published'
              ? 'form.toastPublished'
              : target === 'pending_review'
                ? 'form.toastSubmitted'
                : target === 'rejected'
                  ? 'form.toastRejected'
                  : target === 'archived'
                    ? 'form.toastArchived'
                    : 'form.toastDraft',
        ),
      );
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
      setDialog(null);
    }
  };

  const doAction = (action: WorkflowAction) => {
    if (action === 'reject') return setDialog('reject');
    if (action === 'archive') return setDialog('archive');
    void run(action, ACTION_TARGET[action], { skipValidation: action === 'toDraft' });
  };

  const doDelete = async () => {
    if (!event) return;
    setBusy('delete');
    try {
      await softDeleteEvent(event.id);
      toast.success(t('form.toastDeleted'));
      navigate('/admin/events');
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
      setDialog(null);
    }
  };

  const doRestore = async () => {
    if (!event) return;
    setBusy('restore');
    try {
      await restoreEvent(event.id);
      toast.success(t('form.toastRestored'));
      await load();
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-sm text-slate-500">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert tone="error">{loadError}</Alert>
        <Link to="/admin/events" className="text-sm font-semibold text-sky-700 dark:text-sky-400">
          {t('form.backToEvents')}
        </Link>
      </div>
    );
  }

  const disabled = !editable || !!busy;
  const categoryOptions = categories.map((c) => ({ value: c.id, label: categoryLabel(c.slug, c.name) }));
  const CategoryIcon = getCategoryIcon(category?.icon);
  const actionMeta: Record<WorkflowAction, { label: string; icon: typeof Send; variant: 'primary' | 'secondary' | 'danger' }> = {
    submit: { label: t('form.submitReview'), icon: Send, variant: 'secondary' },
    publish: { label: t('form.publish'), icon: CheckCircle2, variant: 'primary' },
    reject: { label: t('form.reject'), icon: XCircle, variant: 'secondary' },
    archive: { label: t('form.archive'), icon: Archive, variant: 'secondary' },
    toDraft: { label: t('form.returnToDraft'), icon: Undo2, variant: 'secondary' },
  };

  return (
    <div className="mx-auto max-w-6xl pb-28">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          to="/admin/events"
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          {t('form.backToEvents')}
        </Link>
        <div className="flex w-full flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {isNew ? t('form.newTitle') : t('form.editTitle')}
          </h1>
          {event ? <StatusBadge status={event.status} /> : null}
          {event?.deletedAt ? (
            <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-bold uppercase text-red-800 dark:bg-red-500/15 dark:text-red-300">
              {t('form.deletedBadge')}
            </span>
          ) : null}
        </div>
        {event ? (
          <p className="w-full text-xs text-slate-500 dark:text-slate-400">
            {t('form.meta', {
              author: event.createdByName ?? '—',
              created: formatDateTime(event.createdAt, locale),
              updated: formatDateTime(event.updatedAt, locale),
            })}
          </p>
        ) : null}
      </div>

      {!editable && event && !event.deletedAt ? (
        <Alert tone="info" className="mb-5">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden />
            {t('form.readOnly')}
          </span>
        </Alert>
      ) : null}
      {event?.status === 'rejected' && event.rejectionReason ? (
        <Alert tone="warning" className="mb-5">
          <strong>{t('form.rejectedBecause')}</strong> <span dir="auto">{event.rejectionReason}</span>
        </Alert>
      ) : null}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (isNew) void run('draft', 'draft');
          else if (event) void run('save', event.status);
        }}
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div className="flex flex-col gap-5">
          <Section title={t('form.sectionReport')}>
            <TextAreaField
              label={t('form.originalReport')}
              required
              rows={4}
              dir="auto"
              value={input.originalReportText}
              maxLength={10000}
              onChange={(e) => set('originalReportText', e.target.value)}
              error={errorText('originalReportText')}
              hint={t('form.originalReportHint')}
              disabled={disabled}
            />
            <TextField
              label={t('form.occurredAt')}
              type="datetime-local"
              required
              value={toLocalInput(input.occurredAt)}
              onChange={(e) => set('occurredAt', fromLocalInput(e.target.value))}
              error={errorText('occurredAt')}
              disabled={disabled}
              dir="ltr"
            />
          </Section>

          <Section title={t('form.sectionDetails')}>
            <TextField
              label={t('form.title')}
              value={input.title}
              maxLength={200}
              dir="auto"
              onChange={(e) => set('title', e.target.value)}
              error={errorText('title')}
              hint={t('form.titleHint')}
              disabled={disabled}
            />
            <TextAreaField
              label={t('form.summary')}
              rows={4}
              dir="auto"
              value={input.description}
              maxLength={5000}
              onChange={(e) => set('description', e.target.value)}
              hint={t('form.summaryHint')}
              disabled={disabled}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t('form.category')}
                value={input.categoryId ?? ''}
                placeholder={t('form.chooseCategory')}
                options={categoryOptions}
                onChange={(e) => set('categoryId', e.target.value || null)}
                error={errorText('categoryId')}
                disabled={disabled}
                badge={
                  category ? (
                    <span className="inline-flex size-4 items-center justify-center rounded-full text-white" style={{ backgroundColor: category.color }} aria-hidden>
                      <CategoryIcon className="size-2.5" />
                    </span>
                  ) : undefined
                }
              />
              <SelectField
                label={t('form.severity')}
                value={input.severity}
                options={SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`) }))}
                onChange={(e) => set('severity', e.target.value as EventInput['severity'])}
                disabled={disabled}
              />
            </div>
            <div className="flex flex-col gap-3 pt-1">
              <ToggleField label={t('form.breaking')} description={t('form.breakingHint')} checked={input.isBreaking} onChange={(v) => set('isBreaking', v)} disabled={disabled} />
              <ToggleField label={t('form.verified')} description={t('form.verifiedHint')} checked={input.isVerified} onChange={(v) => set('isVerified', v)} disabled={disabled} />
            </div>
          </Section>

          <Section title={t('form.sectionSource')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={t('form.sourceName')} value={input.sourceName} maxLength={200} dir="auto" onChange={(e) => set('sourceName', e.target.value)} disabled={disabled} />
              <SelectField
                label={t('form.sourceType')}
                value={input.sourceType}
                options={SOURCE_TYPES.map((s) => ({ value: s, label: t(`source.${s}`) }))}
                onChange={(e) => set('sourceType', e.target.value as EventInput['sourceType'])}
                disabled={disabled}
              />
            </div>
            <TextField
              label={t('form.sourceUrl')}
              type="url"
              inputMode="url"
              dir="ltr"
              placeholder="https://"
              value={input.sourceUrl}
              maxLength={2048}
              onChange={(e) => set('sourceUrl', e.target.value)}
              error={errorText('sourceUrl')}
              disabled={disabled}
            />
          </Section>
        </div>

        <div className="flex flex-col gap-5">
          <Section title={t('form.sectionLocation')}>
            <LocationPicker
              latitude={input.latitude}
              longitude={input.longitude}
              iconName={category?.icon ?? 'CircleDot'}
              color={category?.markerColor ?? '#0ea5e9'}
              error={errorText('latitude') ?? errorText('longitude')}
              onPick={(lat, lng) => {
                if (disabled) return;
                setInput((prev) => ({
                  ...prev,
                  latitude: Math.round(lat * 1e6) / 1e6,
                  longitude: Math.round(lng * 1e6) / 1e6,
                  geocodingConfidence: null,
                  coordinatesManuallyCorrected: prev.geocodingConfidence !== null || prev.coordinatesManuallyCorrected,
                }));
                setErrors((p) => ({ ...p, latitude: undefined, longitude: undefined }));
              }}
              onReverse={(r) => !disabled && fillPlace(r, false)}
              onSelectResult={(r) => {
                if (disabled) return;
                setInput((prev) => ({ ...prev, latitude: r.latitude, longitude: r.longitude, geocodingConfidence: Math.round(r.confidence * 1000) / 1000, coordinatesManuallyCorrected: false }));
                fillPlace(r, true);
                setErrors((p) => ({ ...p, latitude: undefined, longitude: undefined, locationName: undefined }));
              }}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t('form.latitude')}
                type="number"
                step="0.000001"
                inputMode="decimal"
                dir="ltr"
                value={input.latitude ?? ''}
                onChange={(e) => set('latitude', e.target.value === '' ? null : Number(e.target.value))}
                error={errorText('latitude')}
                disabled={disabled}
              />
              <TextField
                label={t('form.longitude')}
                type="number"
                step="0.000001"
                inputMode="decimal"
                dir="ltr"
                value={input.longitude ?? ''}
                onChange={(e) => set('longitude', e.target.value === '' ? null : Number(e.target.value))}
                error={errorText('longitude')}
                disabled={disabled}
              />
            </div>
            {input.geocodingConfidence !== null ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('form.geocodingConfidence', { value: Math.round(input.geocodingConfidence * 100) })}
              </p>
            ) : null}
            {input.coordinatesManuallyCorrected ? (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('form.manuallyCorrected')}</p>
            ) : null}
            <TextField
              label={t('form.locationName')}
              value={input.locationName}
              maxLength={200}
              dir="auto"
              onChange={(e) => set('locationName', e.target.value)}
              error={errorText('locationName')}
              disabled={disabled}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label={t('form.city')} value={input.city} maxLength={100} dir="auto" onChange={(e) => set('city', e.target.value)} disabled={disabled} />
              <TextField label={t('form.region')} value={input.region} maxLength={100} dir="auto" onChange={(e) => set('region', e.target.value)} disabled={disabled} />
              <TextField label={t('form.country')} value={input.country} maxLength={100} dir="auto" onChange={(e) => set('country', e.target.value)} disabled={disabled} />
            </div>
            <TextField label={t('form.address')} value={input.address} maxLength={300} dir="auto" onChange={(e) => set('address', e.target.value)} disabled={disabled} />
          </Section>

          <Section title={t('form.sectionInternal')}>
            <TextAreaField
              label={t('form.internalNotes')}
              rows={3}
              dir="auto"
              value={notes}
              maxLength={5000}
              onChange={(e) => setNotes(e.target.value)}
              hint={t('form.internalNotesHint')}
              disabled={disabled}
            />
          </Section>

          {!isNew ? (
            <Section title={t('form.history')} aside={<History className="size-4 text-slate-400" aria-hidden />}>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('form.historyEmpty')}</p>
              ) : (
                <ol className="relative space-y-3 border-s border-slate-200 ps-4 dark:border-slate-700">
                  {history.map((h) => {
                    const fields = Object.keys(h.newValues).filter((k) => !['updated_at', 'published_at', 'approved_by'].includes(k));
                    return (
                      <li key={h.id} className="relative">
                        <span className="absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2 border-white bg-sky-500 dark:border-slate-900" aria-hidden />
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          {HISTORY_KEYS[h.action] ? t(HISTORY_KEYS[h.action]) : h.action}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          <bdi>{formatDateTime(h.createdAt, locale)}</bdi>
                          {h.action !== 'created' && fields.length ? (
                            <span dir="ltr" className="ms-2 font-mono text-[10px]">
                              {fields.slice(0, 6).join(', ')}
                              {fields.length > 6 ? '…' : ''}
                            </span>
                          ) : null}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>
          ) : null}
        </div>

        {/* Sticky action bar */}
        <div className="fixed inset-x-0 bottom-0 z-[1100] border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:start-[68px] lg:start-64 dark:border-slate-800 dark:bg-slate-950/95">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => navigate('/admin/events')} disabled={!!busy}>
              {t('common.cancel')}
            </Button>
            {event?.deletedAt ? (
              can('event.delete') ? (
                <Button variant="secondary" onClick={() => void doRestore()} loading={busy === 'restore'}>
                  <RotateCcw className="size-4" aria-hidden />
                  {t('form.restore')}
                </Button>
              ) : null
            ) : (
              <>
                {!isNew && can('event.delete') ? (
                  <Button variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => setDialog('delete')} disabled={!!busy}>
                    <Trash2 className="size-4" aria-hidden />
                    {t('form.delete')}
                  </Button>
                ) : null}
                <span className="flex-1" />
                {isNew ? (
                  <>
                    <Button type="submit" variant="secondary" loading={busy === 'draft'} disabled={!editable || (!!busy && busy !== 'draft')}>
                      {t('form.saveDraft')}
                    </Button>
                    <Button variant="secondary" onClick={() => void run('submit', 'pending_review')} loading={busy === 'submit'} disabled={!editable || (!!busy && busy !== 'submit')}>
                      <Send className="size-4" aria-hidden />
                      {t('form.submitReview')}
                    </Button>
                    {can('event.publish') ? (
                      <Button onClick={() => void run('publish', 'published')} loading={busy === 'publish'} disabled={!!busy && busy !== 'publish'}>
                        <CheckCircle2 className="size-4" aria-hidden />
                        {t('form.publish')}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {actions.map((a) => {
                      const meta = actionMeta[a];
                      return (
                        <Button key={a} variant={meta.variant} onClick={() => doAction(a)} loading={busy === a} disabled={!!busy && busy !== a}>
                          <meta.icon className="size-4" aria-hidden />
                          {meta.label}
                        </Button>
                      );
                    })}
                    {editable ? (
                      <Button type="submit" variant={actions.includes('publish') ? 'secondary' : 'primary'} loading={busy === 'save'} disabled={!!busy && busy !== 'save'}>
                        {t('form.saveChanges')}
                      </Button>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={dialog === 'reject'}
        title={t('form.rejectTitle')}
        body={t('form.rejectBody')}
        confirmLabel={t('form.reject')}
        reasonLabel={t('form.rejectReason')}
        reasonRequiredMessage={t('validation.reasonRequired')}
        busy={busy === 'reject'}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => void run('reject', 'rejected', { rejectionReason: reason, skipValidation: true })}
      />
      <ConfirmDialog
        open={dialog === 'archive'}
        title={t('form.archiveTitle')}
        body={t('form.archiveBody')}
        confirmLabel={t('form.archive')}
        busy={busy === 'archive'}
        onCancel={() => setDialog(null)}
        onConfirm={() => void run('archive', 'archived', { skipValidation: true })}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title={t('form.deleteTitle')}
        body={t('form.deleteBody')}
        confirmLabel={t('form.delete')}
        tone="danger"
        busy={busy === 'delete'}
        onCancel={() => setDialog(null)}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
