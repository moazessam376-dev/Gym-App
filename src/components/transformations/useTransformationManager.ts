// Shared state + handlers for the Transformation Manager (0087) — consumed by BOTH the
// mobile screen (app/coach/transformations.tsx) and the desktop portal view
// (TransformationsDesktop). One place owns the queries, the editor open/close state, and
// the save/delete/resolve mutations, so the two surfaces can't drift.
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui';
import {
  createTransformation,
  updateTransformation,
  deleteTransformation,
  type ConsentingClient,
  type MyTransformation,
} from '@/lib/coach-transformations';
import { resolveSubmission, requestTransformation } from '@/lib/transformation-submissions';
import { useMyClients } from '@/lib/queries/home';
import {
  useMyTransformations,
  useCoachTransformationCards,
  useConsentingClients,
  usePendingSubmissions,
  invalidateTransformations,
} from '@/lib/queries/transformations';
import { confirmDestructive } from '@/lib/confirm';
import type { CoachTransformation, TransformationCardInput } from '@/lib/public-profiles';

export type ManagerTab = 'pending' | 'published';

export type EditorTarget = {
  /** Present = editing an existing card; absent = creating a new one. */
  id?: string;
  clientId: string;
  clientFirstName: string | null;
  initial?: Partial<TransformationCardInput> & { bodyFatLostPct?: number | null; leanMassGainedKg?: number | null };
};

export type ClientTimelineGroup = {
  clientId: string;
  clientName: string | null;
  avatarMediaId: string | null;
  rows: MyTransformation[];
};

/** A client in the "feature a new client" row. Non-consenting clients show with an
 *  ASK affordance instead of being silently hidden (the "why do I only see Taha" fix —
 *  featuring requires the client's allow_transformation_sharing consent by design). */
export type FeatureCandidate = {
  user_id: string;
  full_name: string | null;
  avatar_media_id: string | null;
  consented: boolean;
  /** Nudge already sent this session (chip flips to a checkmark). */
  asked: boolean;
};

/** A stored raw card row → the editor's initial values. */
export function rawToInitial(row: MyTransformation): EditorTarget['initial'] {
  return {
    caption: row.caption,
    beforeMediaId: row.before_media_id,
    afterMediaId: row.after_media_id,
    bodyFatLostPct: row.body_fat_delta_bp_override != null ? row.body_fat_delta_bp_override / 100 : null,
    leanMassGainedKg: row.lean_mass_delta_grams_override != null ? row.lean_mass_delta_grams_override / 1000 : null,
    tierBeforeOverride: row.tier_before_override,
    tierAfterOverride: row.tier_after_override,
    measurementStartedAt: row.measurement_started_at,
    measurementEndedAt: row.measurement_ended_at,
    layout: row.layout,
    beforeFrame: row.before_frame,
    afterFrame: row.after_frame,
    beforeMetricId: row.before_metric_id,
    afterMetricId: row.after_metric_id,
    photos: row.photos.map((p) => ({ mediaId: p.media_id, takenOn: p.taken_on, frame: p.frame })),
  };
}

export function useTransformationManager() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const toast = useToast();
  const userId = session?.user?.id;
  const coachName = session?.user?.user_metadata?.full_name as string | undefined;

  const rawQ = useMyTransformations(userId);
  const cardsQ = useCoachTransformationCards(userId);
  const clientsQ = useConsentingClients(userId);
  const pendingQ = usePendingSubmissions(userId);
  const allClientsQ = useMyClients();

  const [tab, setTab] = useState<ManagerTab>('pending');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [askedIds, setAskedIds] = useState<Set<string>>(new Set());

  const raw = rawQ.data ?? [];
  const cards = cardsQ.data ?? [];
  const clients = clientsQ.data ?? [];
  const pending = pendingQ.data ?? [];

  /** Server-computed card shape by id (verified badge / weeks label for the thumbnails). */
  const cardById = useMemo(
    () => new Map<string, CoachTransformation>(cards.map((c) => [c.transformation_id, c])),
    [cards],
  );

  /** Raw rows grouped per client, newest card first (rows arrive featured_at-desc). */
  const timelines = useMemo<ClientTimelineGroup[]>(() => {
    const avatarByClient = new Map(clients.map((c) => [c.user_id, c.avatar_media_id]));
    const groups = new Map<string, ClientTimelineGroup>();
    for (const row of raw) {
      let g = groups.get(row.client_id);
      if (!g) {
        g = {
          clientId: row.client_id,
          clientName: row.client_name,
          avatarMediaId: avatarByClient.get(row.client_id) ?? null,
          rows: [],
        };
        groups.set(row.client_id, g);
      }
      g.rows.push(row);
    }
    return [...groups.values()];
  }, [raw, clients]);

  /** Consenting clients who don't have a card yet (the "feature a new client" chips). */
  const clientsWithoutCards = useMemo<ConsentingClient[]>(() => {
    const withCards = new Set(raw.map((r) => r.client_id));
    return clients.filter((c) => !withCards.has(c.user_id));
  }, [clients, raw]);

  /** EVERY card-less client — consenting ones open the editor, the rest get an ASK chip. */
  const featureCandidates = useMemo<FeatureCandidate[]>(() => {
    const withCards = new Set(raw.map((r) => r.client_id));
    const consentingById = new Map(clients.map((c) => [c.user_id, c]));
    return (allClientsQ.data ?? [])
      .filter((c) => !withCards.has(c.id))
      .map((c) => {
        const consenting = consentingById.get(c.id);
        return {
          user_id: c.id,
          full_name: c.full_name,
          avatar_media_id: consenting?.avatar_media_id ?? null,
          consented: !!consenting,
          asked: askedIds.has(c.id),
        };
      });
  }, [allClientsQ.data, clients, raw, askedIds]);

  /** Nudge a non-consenting client to submit (dedupe is server-side, 7 days). */
  const onAsk = useCallback(
    async (clientId: string) => {
      try {
        const res = await requestTransformation(clientId);
        setAskedIds((prev) => new Set(prev).add(clientId));
        toast.show(res === 'too_soon' ? t('transformationManager.requestTooSoon') : t('transformationManager.requestSent'), res === 'too_soon' ? 'error' : undefined);
      } catch {
        toast.show(t('common.error'), 'error');
      }
    },
    [toast, t],
  );

  const invalidate = useCallback(() => invalidateTransformations(userId), [userId]);

  const openNew = useCallback((clientId: string, clientFirstName: string | null) => {
    setEditor({ clientId, clientFirstName });
  }, []);

  const openEdit = useCallback((row: MyTransformation) => {
    setEditor({
      id: row.id,
      clientId: row.client_id,
      clientFirstName: row.client_name?.split(' ')[0] ?? null,
      initial: rawToInitial(row),
    });
  }, []);

  const closeEditor = useCallback(() => setEditor(null), []);

  const onSave = useCallback(
    async (input: TransformationCardInput) => {
      if (!userId || !editor) return;
      if (editor.id) await updateTransformation(editor.id, input);
      else await createTransformation({ coachId: userId, clientId: editor.clientId, ...input });
      await invalidate();
      toast.show(t('common.saved'));
      setEditor(null);
    },
    [userId, editor, invalidate, toast, t],
  );

  /** Delete the card currently open in the editor (confirm-guarded). */
  const onDeleteCurrent = useCallback(async () => {
    if (!editor?.id) return;
    const ok = await confirmDestructive(t('coachProfile.deleteTitle'), t('coachProfile.deleteMessage'), t('common.delete'));
    if (!ok) return;
    try {
      await deleteTransformation(editor.id);
      await invalidate();
      toast.show(t('common.saved'));
      setEditor(null);
    } catch {
      toast.show(t('common.error'), 'error');
    }
  }, [editor, invalidate, toast, t]);

  const onResolve = useCallback(
    (id: string, action: 'approve' | 'dismiss') => async () => {
      setResolving(id);
      try {
        await resolveSubmission(id, action);
        await invalidate();
        toast.show(action === 'approve' ? t('coachProfile.submissionApproved') : t('coachProfile.submissionDismissed'));
      } catch {
        toast.show(t('common.error'), 'error');
      } finally {
        setResolving(null);
      }
    },
    [invalidate, toast, t],
  );

  return {
    userId,
    coachName,
    loading: rawQ.isLoading || clientsQ.isLoading,
    raw,
    cards,
    cardById,
    clients,
    pending,
    timelines,
    clientsWithoutCards,
    featureCandidates,
    onAsk,
    tab,
    setTab,
    editor,
    openNew,
    openEdit,
    closeEditor,
    onSave,
    onDeleteCurrent,
    onResolve,
    resolving,
  };
}
