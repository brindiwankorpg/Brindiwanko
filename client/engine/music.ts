/**
 * @file Music of the game: background music (BGM) and ambience (BGS) played
 * in a loop, and short jingles (ME).
 *
 * - Entering a map whose properties ask to play a music (or an ambience)
 *   starts it; a map that does not ask keeps what is playing, so an inside
 *   map can go on with the music of the village.
 * - Playing the music already playing only changes its volume and pitch: it
 *   does not start again from the beginning. Changing music fades the old one
 *   out quickly.
 * - A jingle pauses the music, which comes back when the jingle ends.
 * - Event commands can also play, fade out, remember and resume the music.
 *
 * Browsers refuse to play sound before the player's first key press or touch:
 * what was asked before is kept and starts at `unlock()`. The volume of the
 * options multiplies the volume of each sound; the pitch changes the speed
 * (and the tone) like in classic engines. Panning is not applied.
 */

/** A sound and how to play it (volume 0–100, pitch 50–150). */
export interface MusicRef {
  name: string;
  volume: number;
  pitch: number;
}

/** Looping channels. */
export type MusicChannel = 'bgm' | 'bgs';

/** How long a music being replaced takes to fade out. */
const SWITCH_FADE_MS = 400;

/** One looping channel. */
interface Channel {
  ref: MusicRef | null;
  audio: HTMLAudioElement | null;
}

/** The music player of the game. */
export class MusicPlayer {
  /** Volume of the options (0–1). */
  private master = 0.6;
  private unlocked = false;
  private readonly channels: Record<MusicChannel, Channel> = {
    bgm: { ref: null, audio: null },
    bgs: { ref: null, audio: null },
  };
  /** Music remembered by the "save music" command. */
  private saved: MusicRef | null = null;
  private jingle: HTMLAudioElement | null = null;

  /** @param url - URL of a sound of a resource folder (`null` when the file is missing). */
  constructor(private readonly url: (kind: 'bgm' | 'bgs' | 'me', name: string) => string | null) {}

  /** Volume of the options (0–1). */
  set volume(value: number) {
    this.master = Math.max(0, Math.min(1, value));
    for (const channel of ['bgm', 'bgs'] as const) this.applyVolume(channel);
    if (this.jingle) this.jingle.volume = this.master;
  }

  /** The first key press or touch happened: what was asked can be heard now. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const channel of ['bgm', 'bgs'] as const) {
      const c = this.channels[channel];
      if (c.audio && c.audio.paused && !this.jingle) void c.audio.play().catch(() => undefined);
    }
  }

  /** What a channel plays now (or `null`). */
  current(channel: MusicChannel): MusicRef | null {
    return this.channels[channel].ref;
  }

  /**
   * Plays a looping music or ambience; an empty name stops the channel.
   * The same sound already playing only gets its new volume and pitch.
   */
  play(channel: MusicChannel, ref: MusicRef): void {
    const c = this.channels[channel];
    if (!ref.name) {
      this.stop(channel, SWITCH_FADE_MS);
      return;
    }
    if (c.ref?.name === ref.name && c.audio) {
      c.ref = { ...ref };
      this.applyVolume(channel);
      this.applyPitch(c.audio, ref.pitch);
      if (c.audio.paused && this.unlocked && !this.jingle) void c.audio.play().catch(() => undefined);
      return;
    }
    const url = this.url(channel, ref.name);
    this.stop(channel, SWITCH_FADE_MS);
    if (!url) return;
    const audio = new Audio(url);
    audio.loop = true;
    this.applyPitch(audio, ref.pitch);
    c.ref = { ...ref };
    c.audio = audio;
    this.applyVolume(channel);
    if (this.unlocked && !(channel === 'bgm' && this.jingle)) void audio.play().catch(() => undefined);
  }

  /**
   * Fades a channel out, then stops it.
   * @param ms - Duration of the fade (0 stops at once).
   */
  stop(channel: MusicChannel, ms = 0): void {
    const c = this.channels[channel];
    const audio = c.audio;
    c.ref = null;
    c.audio = null;
    if (!audio) return;
    if (ms <= 0 || audio.paused) {
      audio.pause();
      return;
    }
    const start = performance.now();
    const from = audio.volume;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      audio.volume = from * (1 - t);
      if (t < 1) window.setTimeout(step, 50);
      else audio.pause();
    };
    step();
  }

  /** Remembers the current music ("save music" command). */
  save(): void {
    this.saved = this.channels.bgm.ref ? { ...this.channels.bgm.ref } : null;
  }

  /** Plays the music remembered by {@link save} again ("resume music" command). */
  resume(): void {
    if (this.saved) this.play('bgm', this.saved);
  }

  /** Plays a jingle once; the music pauses meanwhile and goes on afterwards. */
  playJingle(ref: MusicRef): void {
    const url = ref.name ? this.url('me', ref.name) : null;
    if (!url) return;
    this.jingle?.pause();
    const jingle = new Audio(url);
    jingle.volume = Math.max(0, Math.min(1, (this.master * ref.volume) / 100));
    this.applyPitch(jingle, ref.pitch);
    this.jingle = jingle;
    this.channels.bgm.audio?.pause();
    const done = () => {
      if (this.jingle !== jingle) return;
      this.jingle = null;
      if (this.unlocked) void this.channels.bgm.audio?.play().catch(() => undefined);
    };
    jingle.addEventListener('ended', done);
    jingle.addEventListener('error', done);
    if (this.unlocked) void jingle.play().catch(done);
    else done();
  }

  /** Stops everything (leaving the game). */
  stopAll(): void {
    this.stop('bgm');
    this.stop('bgs');
    this.jingle?.pause();
    this.jingle = null;
  }

  private applyVolume(channel: MusicChannel): void {
    const c = this.channels[channel];
    if (c.audio && c.ref) c.audio.volume = Math.max(0, Math.min(1, (this.master * c.ref.volume) / 100));
  }

  private applyPitch(audio: HTMLAudioElement, pitch: number): void {
    audio.preservesPitch = false;
    audio.playbackRate = Math.max(0.5, Math.min(1.5, pitch / 100));
  }
}
