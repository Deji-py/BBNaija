/** Original station ids for the home theater beside the TV. These are not recordings of real songs. */
export const TV_STATIONS = [
  { id: "groove", label: "Green-white groove" },
  { id: "highlife", label: "Palm-wine strum" },
  { id: "drums", label: "Compound drums" },
] as const;

export type TvStationId = (typeof TV_STATIONS)[number]["id"];

/** One uploaded song on the sound bar. Replaces whatever was playing. */
export const FILE_STATION = "file";

export const TRACK_MAX_BYTES = 12 * 1024 * 1024;
export const TRACK_MAX_LABEL = "12 MB";

export function tvStation(id: string): TvStationId | undefined {
  return TV_STATIONS.find((s) => s.id === id)?.id;
}
