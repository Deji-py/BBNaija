export type Role = "housemate" | "viewer" | "admin";

export type AreaId = "lounge" | "kitchen" | "bedroom" | "garden" | "gym" | "diary" | "games" | "bathroom" | "party";

/** Response shape of the server's GET /health endpoint. */
export interface HealthResponse {
  ok: true;
  name: string;
  uptimeSec: number;
}
