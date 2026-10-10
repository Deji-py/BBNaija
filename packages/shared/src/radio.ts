/** Original station ids for the home theater beside the TV. These are not recordings of real songs. */
export const TV_STATIONS = [
  { id: "groove", label: "Green-white groove" },
  { id: "highlife", label: "Palm-wine strum" },
  { id: "drums", label: "Compound drums" },
] as const;

export type TvStationId = (typeof TV_STATIONS)[number]["id"];

export function tvStation(id: string): TvStationId | undefined {
  return TV_STATIONS.find((s) => s.id === id)?.id;
}
