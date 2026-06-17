/**
 * Plays a short, soft two-note chime for new-comment notifications, synthesized
 * with the Web Audio API so there's no binary asset to ship across web and
 * desktop (both run on Chromium). The AudioContext is created lazily and reused;
 * browsers start it "suspended" until a user gesture, so we resume() on play —
 * after the user has interacted with the app (which they have, by navigating),
 * resume succeeds and the chime is audible.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

/** Schedule a single sine tone with a quick attack and exponential decay. */
function tone(ctx: AudioContext, freq: number, startAt: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;

  const peak = 0.12; // keep it subtle
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

export function playCommentSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  // Resume if the autoplay policy left the context suspended.
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  tone(ctx, 660, now, 0.18); // E5
  tone(ctx, 880, now + 0.1, 0.22); // A5 — a gentle rising two-note ping
}
