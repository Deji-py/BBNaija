/** Original video channels on the lounge TV. The files live in the client at these paths. */
export const TV_CHANNELS = [
  { id: "news", label: "Villa News", src: "/tv/news.mp4" },
  { id: "pitch", label: "Pitch Day", src: "/tv/pitch.mp4" },
  { id: "market", label: "Market Hour", src: "/tv/market.mp4" },
  { id: "film", label: "The Villa", src: "/tv/film.mp4" },
] as const;

export type TvChannelId = (typeof TV_CHANNELS)[number]["id"];

export function tvChannel(id: string): (typeof TV_CHANNELS)[number] | undefined {
  return TV_CHANNELS.find((c) => c.id === id);
}
