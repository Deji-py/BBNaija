export type Role = "housemate" | "viewer" | "admin";

export type AreaId = "lounge" | "kitchen" | "bedroom" | "garden" | "gym" | "diary";

/** Response shape of the server's GET /health endpoint. */
export interface HealthResponse {
  ok: true;
  name: string;
  uptimeSec: number;
}
