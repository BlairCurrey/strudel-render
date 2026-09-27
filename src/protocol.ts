// What passes between Node (render.ts) and the page (page.ts).

export interface Job {
  index: number;
  code: string;
  /** first cycle the output uses */
  from: number;
  /** first cycle the output does not use */
  to: number;
  /** schedule haps whose onset is before this cycle */
  onsetsUntil: number;
  /** render audio up to this cycle (tail) */
  renderUntil: number;
  /** the whole render's first cycle; never pre-roll before it */
  floor: number;
  /** cycles of pre-roll */
  preroll: number;
  /** max extra reach back for held notes, cycles */
  lookback: number;
  /** cycles scheduled per suspend/resume */
  window: number;
  sampleRate: number;
  maxPolyphony: number;
  uploadUrl: string;
}

export interface JobResult {
  /** the chunk's first sample, on the output's sample grid (from `floor`) */
  beginFrame: number;
  frames: number;
  cps: number;
  scheduleMs: number;
  scheduled: number;
}

declare global {
  interface Window {
    srInit(seed: number): Promise<void>;
    srInfo(code: string): Promise<{ cps: number; cycles: number | null }>;
    srRender(job: Job): Promise<JobResult>;
    srProgress?: (job: number, cycle: number) => void;
  }
}
