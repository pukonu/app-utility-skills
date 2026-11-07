/**
 * Sketch of the feedback tab + sheet for a React Native (Expo) app. Adapt the imports to
 * your component library and router. The shape matters more than the components:
 *
 *   tap tab → hide tab → wait two frames → screenshot → snapshot screen/route → reset form → open sheet
 *   submit  → require comment or rating → upload screenshot → POST batch → close (or keep queued)
 *
 * Dependencies used here: expo-router (path + segments), react-native-view-shot
 * (captureScreen), expo-application (version), expo-secure-store (queue). Swap freely.
 */
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { usePathname, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { Dimensions, Image, PixelRatio, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { captureScreen } from 'react-native-view-shot';
import type { FeedbackEntry, FeedbackKind, Screenshot } from './types';

/** Show in development builds, and in tester builds made with a flag. */
export const FEEDBACK_ON = __DEV__ || process.env.EXPO_PUBLIC_FEEDBACK === '1';

// ---------------------------------------------------------------------------------------
// Queue: notes given before sign-in (or that failed to send) wait on the device.
// ---------------------------------------------------------------------------------------

const QUEUE_KEY = 'app.feedback.queue';
const QUEUE_CAP = 30;

async function readQueue(): Promise<FeedbackEntry[]> {
  try {
    const raw = await SecureStore.getItemAsync(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as FeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

export async function keep(entry: FeedbackEntry) {
  const queued = await readQueue();
  await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify([...queued, entry].slice(-QUEUE_CAP)));
  return queued.length + 1;
}

/** Your app's upload flow (presign → PUT → complete). Returns the file id, or null on failure. */
async function uploadScreenshot(shot: Screenshot | null): Promise<string | null> {
  if (!shot) return null;
  try {
    return await uploadFile({ uri: shot.uri, mimeType: 'image/jpeg' }, 'feedback_screenshot');
  } catch {
    return null; // the note is worth more than the picture
  }
}

/** Sends this entry (if any) plus everything waiting, in one call; anything unsent stays queued. */
export async function send(entry?: FeedbackEntry) {
  const queued = await readQueue();
  const entries = entry ? [...queued, entry] : queued;
  if (!entries.length) return 0;
  try {
    const payload = [];
    for (const { screenshot, ...e } of entries) payload.push({ ...e, screenshotFileId: await uploadScreenshot(screenshot) });
    await api.post('/api/feedback', { entries: payload });
  } catch (e) {
    if (entry) await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(entries.slice(-QUEUE_CAP)));
    throw e;
  }
  if (queued.length) await SecureStore.deleteItemAsync(QUEUE_KEY);
  return entries.length;
}

export const waiting = async () => (await readQueue()).length;

// ---------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The screen as it is now; null when the device will not take it. */
async function takeScreenshot(): Promise<Screenshot | null> {
  try {
    const uri = await captureScreen({ format: 'jpg', quality: 0.8, result: 'tmpfile' });
    const { width, height } = Dimensions.get('screen');
    const scale = PixelRatio.get();
    return { uri, width: Math.round(width * scale), height: Math.round(height * scale) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Tab + sheet
// ---------------------------------------------------------------------------------------

export function FeedbackButton({ signedIn }: { signedIn: boolean }) {
  const screen = usePathname();
  const route = useSegments().join('/');
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [about, setAbout] = useState({ screen, route });
  const [kind, setKind] = useState<FeedbackKind>('change');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [round, setRound] = useState(0); // fresh key for the comment field per opening
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Anything kept before sign-in goes as soon as there is a session.
  useEffect(() => {
    if (signedIn) void send().catch(() => {});
  }, [signedIn]);

  async function show() {
    setCapturing(true); // the tab steps aside so the screenshot shows only the screen
    await nextFrame();
    await nextFrame();
    const taken = await takeScreenshot();
    setCapturing(false);
    setShot(taken);
    setAbout({ screen, route }); // where they were when they tapped, not where they end up
    setKind('change');
    setRating(null);
    setComment('');
    setRound((r) => r + 1);
    setNote(null);
    setOpen(true);
  }

  // A low rating is usually something wrong: suggest the kind, let them change it.
  function chooseRating(n: number | null) {
    setRating(n);
    if (n !== null && n <= 2 && kind === 'change') setKind('problem');
  }

  async function submit() {
    const entry: FeedbackEntry = {
      screen: about.screen, route: about.route || null, kind, rating, comment: comment.trim() || null, screenshot: shot,
      appVersion: Application.nativeApplicationVersion ?? null, platform: Platform.OS,
    };
    if (!entry.comment && entry.rating === null) {
      setNote('Say what should change, or give the screen a rating.');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      if (signedIn) await send(entry);
      else await keep(entry);
      setOpen(false);
    } catch {
      const left = await waiting();
      setNote(`That did not send. Check the connection and try again${left ? ` (${left} waiting on this phone)` : ''}.`);
    } finally {
      setBusy(false);
    }
  }

  if (!FEEDBACK_ON) return null;
  return (
    <>
      {capturing ? null : (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 0, top: '42%' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Give feedback on this screen" onPress={() => void show()}
            style={{ width: 40, height: 48, borderTopLeftRadius: 24, borderBottomLeftRadius: 24, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff' }}>💬</Text>
          </Pressable>
        </View>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Feedback on this screen"
        footer={<Button loading={busy} onPress={() => void submit()}>{signedIn ? 'Send feedback' : 'Save, sends after sign-in'}</Button>}>
        <Text numberOfLines={1}>{`${about.screen} · ${shot ? 'screenshot attached' : 'no screenshot'}`}</Text>
        {/* Comment first so it stays above the keyboard; uncontrolled with a fresh key per opening
            (a controlled input inside a bottom sheet loses iOS keyboard shortcuts). */}
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <TextInput key={round} style={{ flex: 1, minHeight: 112, textAlignVertical: 'top' }} multiline defaultValue=""
            placeholder="What should change? Wording, layout, something missing or broken" onChangeText={setComment} />
          {shot ? (
            <View style={{ width: 72 }}>
              <Image source={{ uri: shot.uri }} accessibilityLabel="Screenshot of this screen" style={{ width: 72, aspectRatio: shot.width / shot.height, borderRadius: 8 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Remove the screenshot" hitSlop={12} onPress={() => setShot(null)}
                style={{ position: 'absolute', top: -8, right: -8, width: 26, height: 26, borderRadius: 13, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff' }}>✕</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <SegmentedControl<FeedbackKind> label="What is it?" value={kind} onChange={setKind}
          options={[{ value: 'problem', label: 'Problem' }, { value: 'change', label: 'Improve' }, { value: 'idea', label: 'Idea' }]} />
        <RatingPicker label="How easy is this screen?" value={rating} onChange={chooseRating} />
        {note ? <Text style={{ color: '#b00' }}>{note}</Text> : null}
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Placeholders for your own components and API client.
// ---------------------------------------------------------------------------------------
declare function uploadFile(asset: { uri: string; mimeType: string }, purpose: 'feedback_screenshot'): Promise<string>;
declare const api: { post: (path: string, body: unknown) => Promise<unknown> };
declare function Sheet(props: { open: boolean; onClose: () => void; title: string; footer: React.ReactNode; children: React.ReactNode }): React.JSX.Element;
declare function Button(props: { loading?: boolean; onPress: () => void; children: React.ReactNode }): React.JSX.Element;
declare function SegmentedControl<V extends string>(props: { label: string; value: V; onChange: (v: V) => void; options: { value: V; label: string }[] }): React.JSX.Element;
declare function RatingPicker(props: { label: string; value: number | null; onChange: (n: number | null) => void }): React.JSX.Element;
