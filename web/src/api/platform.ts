import { del, get, post } from "./client";

// /version returns the build-info baked into the running broker binary
// (set at link time via -ldflags `-X .../buildinfo.Version=...`). For an
// upgrade-vs-latest comparison, call /upgrade-check instead.
export interface VersionInfo {
  version: string;
  // Always populated by the backend. Defaults to "unknown" when no
  // BuildTimestamp ldflag was set.
  build_timestamp: string;
}

export interface HealthResponse {
  status: string;
  session_mode: string;
  one_on_one_agent: string;
  focus_mode: boolean;
  provider: string;
  provider_model: string;
  memory_backend: string;
  memory_backend_active: string;
  memory_backend_ready: boolean;
  nex_connected: boolean;
  build: VersionInfo;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost_usd: number;
  requests: number;
}

export type AgentUsage = UsageTotals;

export interface UsageData {
  total: UsageTotals;
  session?: UsageTotals;
  agents?: Record<string, AgentUsage>;
  since?: string;
}

export function getHealth() {
  return get<HealthResponse>("/health");
}

export interface HumanSession {
  id: string;
  invite_id: string;
  human_slug: string;
  display_name: string;
  device?: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string;
  last_seen_at?: string;
}

export interface HumanMe {
  human: {
    id?: string;
    slug?: string;
    role?: string;
    invite_id?: string;
    human_slug?: string;
    display_name?: string;
    device?: string;
    created_at?: string;
    expires_at?: string;
    revoked_at?: string;
    last_seen_at?: string;
  };
  // host_display_name is the host's local git-config name. The broker only
  // emits it for member sessions when a real identity is registered, so the
  // welcome card can swap "this office" for "Sam's office" without leaking
  // the literal "wuphf" fallback when no identity is set.
  host_display_name?: string;
}

// Shared TanStack Query identity for /humans/me. Both useSessionRole and
// HealthCheckApp must import these so the cache dedupes a single poll cycle.
export const HUMAN_ME_QUERY_KEY = ["humans", "me"] as const;
export const HUMAN_ME_REFETCH_MS = 30_000;

export function getHumanMe() {
  return get<HumanMe>("/humans/me");
}

export function getHumanSessions() {
  return get<{ sessions?: HumanSession[] }>("/humans/sessions");
}

export function revokeHumanSession(id: string) {
  return del<{ ok: boolean }>("/humans/sessions", { id });
}

export interface WebShareStatus {
  running: boolean;
  bind?: string;
  interface?: string;
  invite_url?: string;
  expires_at?: string;
  error?: string;
}

export function getShareStatus() {
  return get<WebShareStatus>("/share/status");
}

export function startShare() {
  return post<WebShareStatus>("/share/start", {});
}

/**
 * Stops an active web share session.
 *
 * @returns The updated WebShareStatus describing whether the share is running and any related metadata (bind, invite_url, expires_at, error).
 */
export function stopShare() {
  return post<WebShareStatus>("/share/stop", {});
}

// WebTunnelStatus mirrors team.WebTunnelStatus on the Go side. The tunnel
// controller spawns `cloudflared` to publish a one-off TryCloudflare URL
// pointing at a loopback share server, so non-technical hosts can hand a
// teammate a link without setting up Tailscale or an SSH tunnel.
//
// `cloudflared_missing` is a separate flag (rather than an error string the
// UI sniffs) so a future error-message tweak does not silently switch the
// disclaimer back to a generic failure card.
export interface WebTunnelStatus {
  running: boolean;
  public_url?: string;
  invite_url?: string;
  expires_at?: string;
  error?: string;
  cloudflared_missing?: boolean;
}

/**
 * Fetches the current web tunnel status from the platform.
 *
 * @returns The `WebTunnelStatus` object describing whether the tunnel is running and, when available, `public_url`, `invite_url`, `expires_at`, `error`, and the optional `cloudflared_missing` flag.
 */
export function getTunnelStatus() {
  return get<WebTunnelStatus>("/share/tunnel/status");
}

/**
 * Starts a web tunnel for sharing and returns its runtime status.
 *
 * @returns The tunnel status including `running`, optional `public_url`, `invite_url`, `expires_at`, `error`, and optional `cloudflared_missing`.
 */
export function startTunnel() {
  return post<WebTunnelStatus>("/share/tunnel/start", {});
}

/**
 * Stop the running web tunnel used for sharing.
 *
 * @returns The current tunnel status as a `WebTunnelStatus` object
 */
export function stopTunnel() {
  return post<WebTunnelStatus>("/share/tunnel/stop", {});
}

/**
 * Retrieves server build and version metadata.
 *
 * @returns The server's version information, containing `version` and `build_timestamp`.
 */
export function getVersion() {
  return get<VersionInfo>("/version");
}

export function getUsage() {
  return get<UsageData>("/usage");
}
