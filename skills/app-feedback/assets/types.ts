/**
 * Shared types for the in-app feedback mechanism. Copy into a package both the client and
 * the server import, and adapt the validation to your schema library (Zod shown).
 */
import { z } from 'zod';

export const FEEDBACK_KINDS = ['problem', 'change', 'idea'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Rows with no kind read as `note` in the triage surface. */
export const TRIAGE_KINDS = [...FEEDBACK_KINDS, 'note'] as const;
export type TriageKind = (typeof TRIAGE_KINDS)[number];

export const FEEDBACK_STATUSES = ['open', 'planned', 'done', 'wont_do'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** A screenshot still on the device, taken as the sheet opened. */
export interface Screenshot {
  uri: string;
  width: number;
  height: number;
}

/** What the client keeps (and queues) before upload. */
export interface FeedbackEntry {
  screen: string;
  route: string | null;
  kind: FeedbackKind;
  rating: number | null;
  comment: string | null;
  screenshot: Screenshot | null;
  appVersion: string | null;
  platform: string | null;
}

/** Trimmed text, capped, empty stored as null. */
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

/** One entry as the submit API receives it: the screenshot has become a file id. */
export const feedbackEntryInput = z.object({
  screen: text(200),
  route: text(200),
  kind: z.enum(FEEDBACK_KINDS).nullish(),
  screenshotFileId: z.string().uuid().nullish(),
  rating: z.number().int().min(1).max(5).nullish(),
  comment: text(4000),
  appVersion: text(40),
  platform: text(20),
  // Optional, for scripted test journeys.
  journey: text(60),
  step: z.number().int().min(1).max(500).nullish(),
  stepTitle: text(160),
  asDescribed: z.enum(['yes', 'partly', 'no']).nullish(),
});
export type FeedbackEntryInput = z.infer<typeof feedbackEntryInput>;

/** The submit request: a batch, so a queue flushes in one call. */
export const submitFeedbackInput = z.object({ entries: z.array(feedbackEntryInput).min(1).max(50) });

/** One note as the triage surface shows it. */
export interface TriageEntry {
  id: string;
  tenant: { id: string; name: string };
  sender: { name: string | null; contact: string | null };
  screen: string | null;
  route: string | null;
  kind: TriageKind;
  rating: number | null;
  comment: string | null;
  appVersion: string | null;
  platform: string | null;
  status: FeedbackStatus;
  createdAt: string; // ISO
  /** Short-lived signed link, minted per listing; null without a screenshot. */
  screenshotUrl: string | null;
}

export interface TriagePage {
  entries: TriageEntry[];
  total: number;
  counts: { status: Record<FeedbackStatus, number>; kind: Record<TriageKind, number> };
}
