/**
 * Meeting layout (pure): which screen share takes the stage, and how participant tiles are arranged.
 *
 * - Tiles keep their arrival order (ParticipantView.order) and are keyed by identity, so publishing,
 *   muting or reconnecting never reshuffles or remounts them.
 * - A screen share gets the stage; participants stay visible in a strip beside/below it.
 *   Remote shares are preferred over your own (seeing your own screen full-size isn't useful).
 *   A pinned share (the user's choice) wins while it exists.
 * - Grid columns follow the participant count and the available width.
 */
import type { ParticipantView, TrackRef } from './types';

export interface StageItem {
  /** `${participantKey}:screen` */
  key: string;
  participantKey: string;
  name: string;
  isLocal: boolean;
  track: TrackRef;
}

export interface MeetingLayout {
  mode: 'grid' | 'stage';
  /** The share on the stage (mode 'stage'). */
  stage: StageItem | null;
  /** Every active share, for switching between them. */
  shares: StageItem[];
  tiles: ParticipantView[];
  /** Grid columns (mode 'grid'). */
  columns: number;
}

export function screenShares(participants: ParticipantView[]): StageItem[] {
  return participants
    .filter((p) => p.screen)
    .sort((a, b) => Number(a.isLocal) - Number(b.isLocal) || a.order - b.order)
    .map((p) => ({ key: `${p.key}:screen`, participantKey: p.key, name: p.name, isLocal: p.isLocal, track: p.screen! }));
}

export function gridColumns(count: number, width: number): number {
  if (count <= 1) return 1;
  const max = width < 640 ? 2 : width < 1024 ? 3 : 4;
  const ideal = count === 2 ? (width < 640 ? 1 : 2) : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  return Math.max(1, Math.min(ideal, max));
}

export function computeLayout(participants: ParticipantView[], options: { width: number; pinnedShareKey?: string | null }): MeetingLayout {
  const tiles = [...participants].sort((a, b) => a.order - b.order);
  const shares = screenShares(tiles);
  if (shares.length === 0) return { mode: 'grid', stage: null, shares, tiles, columns: gridColumns(tiles.length, options.width) };
  const stage = (options.pinnedShareKey && shares.find((s) => s.key === options.pinnedShareKey)) || shares[0];
  return { mode: 'stage', stage, shares, tiles, columns: 1 };
}

/** Video sizing for a tile: camera feeds fill the tile (cropped, never stretched); screen shares are shown whole. */
export function objectFitFor(kind: 'camera' | 'screen'): 'cover' | 'contain' {
  return kind === 'camera' ? 'cover' : 'contain';
}

/** CSS aspect-ratio for a screen share stage: the source's own ratio when known, else 16:9. */
export function stageAspect(track: TrackRef | null): string {
  if (track?.width && track?.height && track.width > 0 && track.height > 0) return `${track.width} / ${track.height}`;
  return '16 / 9';
}
