import { type CSSProperties, type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getHealth,
  getHumanMe,
  getHumanSessions,
  getShareStatus,
  getTunnelStatus,
  type HealthResponse,
  HUMAN_ME_QUERY_KEY,
  HUMAN_ME_REFETCH_MS,
  type HumanMe,
  type HumanSession,
  revokeHumanSession,
  startShare,
  startTunnel,
  stopShare,
  stopTunnel,
  type WebShareStatus,
  type WebTunnelStatus,
} from "../../api/platform";
import { useAppStore } from "../../stores/app";
import { confirm } from "../ui/ConfirmDialog";

/**
 * Format an optional timestamp into a localized "Mon D, HH:MM" date/time string.
 *
 * @param value - An optional date/time string (e.g., ISO 8601). If falsy, the function returns `"never"`. If the string cannot be parsed as a date, the original `value` is returned unchanged.
 * @returns A localized date/time string formatted with short month, numeric day, and two-digit hour and minute (e.g., "May 7, 04:30"). Returns `"never"` for falsy input or the original input when the date is invalid.
 */
function formatSessionTime(value?: string): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function selfAccessDetails(hostname: string, origin: string) {
  const normalizedHost = hostname.trim().toLowerCase();
  if (normalizedHost === "localhost" || normalizedHost === "127.0.0.1") {
    return {
      detail:
        "For a server you reach through SSH, keep the tunnel open while you work.",
      code: "ssh -L 7890:localhost:7890 user@server",
      footer: "Then open http://localhost:7890",
    };
  }
  return {
    detail: "This browser is already connected through the network web UI.",
    code: origin,
    footer: "Use team-member invites for scoped shared sessions.",
  };
}

type RuntimeItem = {
  label: string;
  value: string;
  active: boolean;
};

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0,
        color: "var(--text-tertiary)",
        padding: "8px 0 6px",
      }}
    >
      {children}
    </div>
  );
}

function LoadingState({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "40px 20px",
        textAlign: "center",
        color: "var(--text-tertiary)",
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Render a responsive grid of access and invite cards: current browser status, self-access instructions, team invite controls, and public tunnel invite controls.
 *
 * @param brokerConnected - True when the broker event stream is connected (affects status badge)
 * @param humanLabel - Display label for the signed-in user
 * @param inviteCopied - True while the team invite URL has recently been copied (controls Copy button state)
 * @param isHost - Whether the current user is a host (gates host-only controls)
 * @param selfAccess - Output of `selfAccessDetails(...)` containing UI text/code/footer for local access
 * @param shareError - Optional error message for team-share operations
 * @param shareInviteURL - Current team-share invite URL (empty when not available)
 * @param shareMutationPending - True while a share start/stop mutation is in progress
 * @param shareNetworkLabel - Human-readable network/interface label for the team share
 * @param shareRunning - True when the team-share is currently running
 * @param shareStatus - Optional detailed share status object
 * @param tunnelInviteCopied - True while the tunnel invite URL has recently been copied (controls Copy button state)
 * @param tunnelInviteURL - Current public-tunnel invite URL (empty when not available)
 * @param tunnelError - Optional error message for tunnel operations
 * @param tunnelMutationPending - True while a tunnel start/stop mutation is in progress
 * @param tunnelRunning - True when the public tunnel is currently running
 * @param tunnelStatus - Optional detailed tunnel status object
 * @param onCopyInvite - Callback to copy the team-share invite URL to clipboard
 * @param onCopyTunnelInvite - Callback to copy the tunnel invite URL to clipboard
 * @param onStartShareInvite - Callback to start or create a team-share invite
 * @param onStartTunnelInvite - Callback to start or create a public-tunnel invite
 * @param onStopShareInvite - Callback to stop the team-share
 * @param onStopTunnelInvite - Callback to stop the public tunnel
 *
 * @returns The React element containing the access/invite cards grid
 */
function AccessCards({
  brokerConnected,
  humanLabel,
  inviteCopied,
  isHost,
  selfAccess,
  shareError,
  shareInviteURL,
  shareMutationPending,
  shareNetworkLabel,
  shareRunning,
  shareStatus,
  tunnelInviteCopied,
  tunnelInviteURL,
  tunnelError,
  tunnelMutationPending,
  tunnelRunning,
  tunnelStatus,
  onCopyInvite,
  onCopyTunnelInvite,
  onStartShareInvite,
  onStartTunnelInvite,
  onStopShareInvite,
  onStopTunnelInvite,
}: {
  brokerConnected: boolean;
  humanLabel: string;
  inviteCopied: boolean;
  isHost: boolean;
  selfAccess: ReturnType<typeof selfAccessDetails>;
  shareError?: string;
  shareInviteURL: string;
  shareMutationPending: boolean;
  shareNetworkLabel: string;
  shareRunning: boolean;
  shareStatus?: WebShareStatus;
  tunnelInviteCopied: boolean;
  tunnelInviteURL: string;
  tunnelError?: string;
  tunnelMutationPending: boolean;
  tunnelRunning: boolean;
  tunnelStatus?: WebTunnelStatus;
  onCopyInvite: () => void;
  onCopyTunnelInvite: () => void;
  onStartShareInvite: () => void;
  onStartTunnelInvite: () => void;
  onStopShareInvite: () => void;
  onStopTunnelInvite: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 10,
        marginBottom: 12,
      }}
    >
      <div className="app-card" style={{ minHeight: 126 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
          This browser
        </div>
        <div className="app-card-meta" style={{ marginBottom: 10 }}>
          Signed in as {humanLabel}
        </div>
        <span
          className={
            brokerConnected ? "badge badge-green" : "badge badge-yellow"
          }
        >
          {brokerConnected ? "Live event stream" : "Reconnecting events"}
        </span>
      </div>

      <SelfAccessCard selfAccess={selfAccess} />
      <TeamInviteCard
        inviteCopied={inviteCopied}
        isHost={isHost}
        shareError={shareError}
        shareInviteURL={shareInviteURL}
        shareMutationPending={shareMutationPending}
        shareNetworkLabel={shareNetworkLabel}
        shareRunning={shareRunning}
        shareStatus={shareStatus}
        onCopyInvite={onCopyInvite}
        onStartShareInvite={onStartShareInvite}
        onStopShareInvite={onStopShareInvite}
      />
      <TunnelInviteCard
        inviteCopied={tunnelInviteCopied}
        isHost={isHost}
        tunnelError={tunnelError}
        tunnelInviteURL={tunnelInviteURL}
        tunnelMutationPending={tunnelMutationPending}
        tunnelRunning={tunnelRunning}
        tunnelStatus={tunnelStatus}
        onCopyInvite={onCopyTunnelInvite}
        onStartTunnelInvite={onStartTunnelInvite}
        onStopTunnelInvite={onStopTunnelInvite}
      />
    </div>
  );
}

function SelfAccessCard({
  selfAccess,
}: {
  selfAccess: ReturnType<typeof selfAccessDetails>;
}) {
  return (
    <div className="app-card" style={{ minHeight: 126 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
        Access for you
      </div>
      <div className="app-card-meta" style={{ marginBottom: 8 }}>
        {selfAccess.detail}
      </div>
      <code
        style={{
          display: "block",
          padding: "8px 10px",
          borderRadius: 8,
          background: "var(--bg-warm)",
          color: "var(--text)",
          fontSize: 11,
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {selfAccess.code}
      </code>
      <div className="app-card-meta" style={{ marginTop: 8 }}>
        {selfAccess.footer}
      </div>
    </div>
  );
}

function TeamInviteCard({
  inviteCopied,
  isHost,
  shareError,
  shareInviteURL,
  shareMutationPending,
  shareNetworkLabel,
  shareRunning,
  shareStatus,
  onCopyInvite,
  onStartShareInvite,
  onStopShareInvite,
}: {
  inviteCopied: boolean;
  isHost: boolean;
  shareError?: string;
  shareInviteURL: string;
  shareMutationPending: boolean;
  shareNetworkLabel: string;
  shareRunning: boolean;
  shareStatus?: WebShareStatus;
  onCopyInvite: () => void;
  onStartShareInvite: () => void;
  onStopShareInvite: () => void;
}) {
  return (
    <div className="app-card" style={{ minHeight: 126 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
        Invite a team member
      </div>
      {!isHost ? (
        <div className="app-card-meta">Team-member invites are host-only.</div>
      ) : (
        <HostInviteControls
          inviteCopied={inviteCopied}
          shareError={shareError}
          shareInviteURL={shareInviteURL}
          shareMutationPending={shareMutationPending}
          shareNetworkLabel={shareNetworkLabel}
          shareRunning={shareRunning}
          shareStatus={shareStatus}
          onCopyInvite={onCopyInvite}
          onStartShareInvite={onStartShareInvite}
          onStopShareInvite={onStopShareInvite}
        />
      )}
    </div>
  );
}

/**
 * Renders controls and status for creating and managing a one-use private-network invite.
 *
 * Conditionally shows create/stop buttons, the invite URL with a copy button, the shared
 * network label, formatted expiration time when present, and any share error message.
 *
 * @param inviteCopied - Whether the invite URL was recently copied (affects copy button label)
 * @param shareError - Optional error message related to share operations
 * @param shareInviteURL - The current share invite URL to display and copy
 * @param shareMutationPending - Whether a start/stop share mutation is in progress (disables actions)
 * @param shareNetworkLabel - Human-readable network/interface label where sharing is active
 * @param shareRunning - Whether a share invite is currently active
 * @param shareStatus - Optional share status object containing metadata such as `expires_at`
 * @param onCopyInvite - Callback invoked when the copy button is clicked
 * @param onStartShareInvite - Callback invoked to create/start a share invite
 * @param onStopShareInvite - Callback invoked to stop an active share invite
 *
 * @returns A React element containing buttons, invite URL display, network/expiry info, and error text
 */
function HostInviteControls({
  inviteCopied,
  shareError,
  shareInviteURL,
  shareMutationPending,
  shareNetworkLabel,
  shareRunning,
  shareStatus,
  onCopyInvite,
  onStartShareInvite,
  onStopShareInvite,
}: {
  inviteCopied: boolean;
  shareError?: string;
  shareInviteURL: string;
  shareMutationPending: boolean;
  shareNetworkLabel: string;
  shareRunning: boolean;
  shareStatus?: WebShareStatus;
  onCopyInvite: () => void;
  onStartShareInvite: () => void;
  onStopShareInvite: () => void;
}) {
  return (
    <>
      <div className="app-card-meta" style={{ marginBottom: 8 }}>
        Create a one-use private-network invite from this browser.
      </div>
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}
      >
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={onStartShareInvite}
          disabled={shareMutationPending}
        >
          {shareRunning ? "Create new invite" : "Create invite"}
        </button>
        {shareRunning ? (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onStopShareInvite}
            disabled={shareMutationPending}
          >
            Stop sharing
          </button>
        ) : null}
      </div>
      {shareInviteURL ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <code
            style={{
              display: "block",
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--bg-warm)",
              color: "var(--text)",
              fontSize: 11,
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            {shareInviteURL}
          </code>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onCopyInvite}
          >
            {inviteCopied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
      {shareRunning && shareNetworkLabel ? (
        <div className="app-card-meta" style={{ marginTop: 8 }}>
          Sharing on {shareNetworkLabel}
        </div>
      ) : null}
      {shareRunning && shareStatus?.expires_at ? (
        <div className="app-card-meta" style={{ marginTop: 4 }}>
          Invite expires {formatSessionTime(shareStatus.expires_at)}
        </div>
      ) : null}
      {shareError ? (
        <div
          style={{
            marginTop: 8,
            color: "var(--danger, #b42318)",
            fontSize: 12,
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
          }}
        >
          {shareError}
        </div>
      ) : null}
    </>
  );
}

/**
 * Render the "Public tunnel invite" card and its host-gated controls.
 *
 * Renders a host-only message when `isHost` is false; when `isHost` is true,
 * renders `HostTunnelControls` with the provided tunnel state and handlers.
 *
 * @param inviteCopied - Whether the invite URL was recently copied (controls copy button state)
 * @param isHost - Whether the current user has host privileges (controls visibility)
 * @param tunnelError - Optional error message related to tunnel operations
 * @param tunnelInviteURL - The current invite URL to display and copy (empty if none)
 * @param tunnelMutationPending - Whether a start/stop tunnel mutation is in progress
 * @param tunnelRunning - Whether the tunnel is currently running
 * @param tunnelStatus - Optional runtime status object for the running tunnel
 * @param onCopyInvite - Callback to copy the invite URL to the clipboard
 * @param onStartTunnelInvite - Callback to start or create a tunnel invite
 * @param onStopTunnelInvite - Callback to stop the running tunnel
 * @returns The Public tunnel invite card element
 */
function TunnelInviteCard({
  inviteCopied,
  isHost,
  tunnelError,
  tunnelInviteURL,
  tunnelMutationPending,
  tunnelRunning,
  tunnelStatus,
  onCopyInvite,
  onStartTunnelInvite,
  onStopTunnelInvite,
}: {
  inviteCopied: boolean;
  isHost: boolean;
  tunnelError?: string;
  tunnelInviteURL: string;
  tunnelMutationPending: boolean;
  tunnelRunning: boolean;
  tunnelStatus?: WebTunnelStatus;
  onCopyInvite: () => void;
  onStartTunnelInvite: () => void;
  onStopTunnelInvite: () => void;
}) {
  return (
    <div className="app-card" style={{ minHeight: 126 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
        Public tunnel invite
      </div>
      {!isHost ? (
        <div className="app-card-meta">Public tunnels are host-only.</div>
      ) : (
        <HostTunnelControls
          inviteCopied={inviteCopied}
          tunnelError={tunnelError}
          tunnelInviteURL={tunnelInviteURL}
          tunnelMutationPending={tunnelMutationPending}
          tunnelRunning={tunnelRunning}
          tunnelStatus={tunnelStatus}
          onCopyInvite={onCopyInvite}
          onStartTunnelInvite={onStartTunnelInvite}
          onStopTunnelInvite={onStopTunnelInvite}
        />
      )}
    </div>
  );
}

/**
 * Render controls and status for creating, copying, and stopping a public tunnel invite.
 *
 * Renders action buttons for starting or stopping the tunnel, displays the current invite URL
 * with a copy button, and shows running tunnel details (public URL and expiration) or an error.
 *
 * @param inviteCopied - Whether the invite URL was recently copied (affects the copy button label).
 * @param tunnelError - Optional error message related to tunnel operations to display to the user.
 * @param tunnelInviteURL - The invite URL to display and copy when available.
 * @param tunnelMutationPending - Whether a start/stop mutation is in progress (disables buttons).
 * @param tunnelRunning - Whether the tunnel is currently running (controls available actions and info).
 * @param tunnelStatus - Optional tunnel status object containing runtime details such as `public_url` and `expires_at`.
 * @param onCopyInvite - Callback invoked when the user clicks the copy button.
 * @param onStartTunnelInvite - Callback invoked to start the tunnel or create a new invite.
 * @param onStopTunnelInvite - Callback invoked to stop the running tunnel.
 * @returns A React element containing the tunnel invite controls and status display.
 */
function HostTunnelControls({
  inviteCopied,
  tunnelError,
  tunnelInviteURL,
  tunnelMutationPending,
  tunnelRunning,
  tunnelStatus,
  onCopyInvite,
  onStartTunnelInvite,
  onStopTunnelInvite,
}: {
  inviteCopied: boolean;
  tunnelError?: string;
  tunnelInviteURL: string;
  tunnelMutationPending: boolean;
  tunnelRunning: boolean;
  tunnelStatus?: WebTunnelStatus;
  onCopyInvite: () => void;
  onStartTunnelInvite: () => void;
  onStopTunnelInvite: () => void;
}) {
  return (
    <>
      <div className="app-card-meta" style={{ marginBottom: 8 }}>
        For teammates outside your private network. Bringing the tunnel up takes
        about 10 seconds.
      </div>
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}
      >
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={onStartTunnelInvite}
          disabled={tunnelMutationPending}
        >
          {tunnelMutationPending && !tunnelRunning
            ? "Starting tunnel..."
            : tunnelRunning
              ? "Create new invite"
              : "Start public tunnel"}
        </button>
        {tunnelRunning ? (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onStopTunnelInvite}
            disabled={tunnelMutationPending}
          >
            Stop tunnel
          </button>
        ) : null}
      </div>
      {tunnelInviteURL ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <code
            style={{
              display: "block",
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--bg-warm)",
              color: "var(--text)",
              fontSize: 11,
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            {tunnelInviteURL}
          </code>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onCopyInvite}
          >
            {inviteCopied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
      {tunnelRunning && tunnelStatus?.public_url ? (
        <div className="app-card-meta" style={{ marginTop: 8 }}>
          Tunnel: {tunnelStatus.public_url}
        </div>
      ) : null}
      {tunnelRunning && tunnelStatus?.expires_at ? (
        <div className="app-card-meta" style={{ marginTop: 4 }}>
          Invite expires {formatSessionTime(tunnelStatus.expires_at)}
        </div>
      ) : null}
      {tunnelError ? (
        <div
          style={{
            marginTop: 8,
            color: "var(--danger, #b42318)",
            fontSize: 12,
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
          }}
        >
          {tunnelError}
        </div>
      ) : null}
    </>
  );
}

/**
 * Render a broker status card showing a connectivity indicator and an uppercase status badge.
 *
 * @param isHealthy - Whether the broker is considered healthy; controls the indicator color and badge styling
 * @param status - The broker status label to display (will be uppercased)
 * @returns A JSX element containing the status dot, title "Broker Status", and a styled status badge
 */
function BrokerStatusCard({
  isHealthy,
  status,
}: {
  isHealthy: boolean;
  status: string;
}) {
  return (
    <div
      className="app-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 12,
      }}
    >
      <span
        className={`status-dot ${isHealthy ? "active" : ""}`}
        style={{ width: 10, height: 10 }}
      />
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Broker Status</div>
        <div className="app-card-meta">
          <span
            className={isHealthy ? "badge badge-green" : "badge badge-yellow"}
          >
            {status.toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
}

function TeamMemberSessions({
  isHost,
  isRevokingSession,
  onRevokeSession,
  revokeError,
  revokingSessionID,
  sessions,
}: {
  isHost: boolean;
  isRevokingSession: boolean;
  onRevokeSession: (sessionID: string) => void;
  revokeError?: string;
  revokingSessionID?: string;
  sessions: HumanSession[];
}) {
  return (
    <>
      <SectionLabel>Team-member sessions ({sessions.length})</SectionLabel>
      {revokeError ? (
        <div
          style={{
            marginBottom: 8,
            color: "var(--danger, #b42318)",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {revokeError}
        </div>
      ) : null}
      {!isHost ? (
        <EmptyCard>Team-member session visibility is host-only.</EmptyCard>
      ) : sessions.length > 0 ? (
        sessions.map((session) => {
          const isThisSessionRevoking =
            isRevokingSession && revokingSessionID === session.id;
          return (
            <StatusRow
              key={session.id}
              action={
                <button
                  aria-label={`Disconnect ${session.display_name || session.human_slug}`}
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => onRevokeSession(session.id)}
                  disabled={isRevokingSession}
                >
                  {isThisSessionRevoking ? "Disconnecting" : "Disconnect"}
                </button>
              }
              active={true}
              label={session.display_name || session.human_slug}
              value={`Last seen ${formatSessionTime(session.last_seen_at)} · expires ${formatSessionTime(session.expires_at)}`}
            />
          );
        })
      ) : (
        <EmptyCard>No active team-member browser sessions.</EmptyCard>
      )}
    </>
  );
}

function RuntimeStatusList({
  focusMode,
  items,
}: {
  focusMode?: boolean;
  items: RuntimeItem[];
}) {
  return (
    <>
      <SectionLabel>Runtime</SectionLabel>
      {items.map((item) => (
        <StatusRow
          key={item.label}
          active={item.active}
          label={item.label}
          value={item.value}
        />
      ))}
      {focusMode ? (
        <StatusRow
          active={true}
          label="Focus Mode"
          value="enabled"
          style={{ marginTop: 12 }}
        />
      ) : null}
    </>
  );
}

function StatusRow({
  active,
  action,
  label,
  value,
  style,
}: {
  active: boolean;
  action?: ReactNode;
  label: string;
  value: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className="app-card"
      style={{
        marginBottom: 6,
        display: "flex",
        alignItems: "center",
        gap: 8,
        ...style,
      }}
    >
      <span className={`status-dot ${active ? "active" : ""}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{label}</div>
        <div
          className="app-card-meta"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </div>
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  );
}

function EmptyCard({ children }: { children: string }) {
  return (
    <div
      className="app-card"
      style={{
        marginBottom: 12,
        color: "var(--text-tertiary)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function humanDisplayName(human: HumanMe["human"] | undefined): string {
  return human?.display_name || human?.human_slug || human?.slug || "Host";
}

/**
 * Builds runtime status items from a health response for display in the UI.
 *
 * @param data - The health response (may be `undefined`); fields from this object are used to derive item values and active flags.
 * @returns An array of `RuntimeItem` objects for "Session", "Provider", "Memory", "Nex", and "Build". Each item contains a human-readable `value` (with sensible fallbacks like `"unknown"`, `"none"`, or `"disconnected"`) and an `active` boolean indicating the presence/availability of that subsystem.
 */
function runtimeItems(data: HealthResponse | undefined): RuntimeItem[] {
  const providerLabel = [data?.provider, data?.provider_model]
    .filter(Boolean)
    .join(" / ");
  const sessionLabel =
    data?.session_mode === "one_on_one" && data.one_on_one_agent
      ? `${data.session_mode} / ${data.one_on_one_agent}`
      : data?.session_mode;
  const memoryLabel = data?.memory_backend_active || data?.memory_backend;
  return [
    {
      label: "Session",
      value: sessionLabel || "unknown",
      active: Boolean(data?.session_mode),
    },
    {
      label: "Provider",
      value: providerLabel || "unknown",
      active: Boolean(data?.provider),
    },
    {
      label: "Memory",
      value: memoryLabel || "none",
      active: Boolean(data?.memory_backend_ready),
    },
    {
      label: "Nex",
      value: data?.nex_connected ? "connected" : "disconnected",
      active: Boolean(data?.nex_connected),
    },
    {
      label: "Build",
      value: data?.build?.version ?? "unknown",
      active: Boolean(data?.build?.version),
    },
  ];
}

// useTunnelControls owns every piece of state, query, and mutation for the
// public-tunnel flow (status polling, start/stop mutations, copy-to-
// clipboard, the disclaimer modal trigger). Lifted out of HealthCheckApp so
// that component stays under biome's 200-line per-function lint, and so the
// share-invite vs tunnel-invite paths read as parallel chunks instead of one
/**
 * Manage the public-tunnel lifecycle, polling, and user-facing controls for the HealthCheck UI.
 *
 * When `isHost` is true this hook polls tunnel status, exposes start/stop mutations, and provides
 * clipboard-copy handling and transient UI state (copied flag and mutation errors).
 *
 * @param isHost - Whether the current user is the host; when false, tunnel polling and mutations are disabled.
 * @returns An object with tunnel state and control handlers:
 *  - `tunnelStatus` — the latest tunnel status object from the server (or `undefined`).
 *  - `tunnelRunning` — `true` when a tunnel is currently running, `false` otherwise.
 *  - `tunnelInviteURL` — the current invite URL when running, otherwise an empty string.
 *  - `tunnelInviteCopied` — transient boolean set to `true` briefly after a successful copy.
 *  - `tunnelMutationPending` — `true` while a start/stop mutation is in flight.
 *  - `tunnelError` — a string describing the current tunnel or mutation error, or empty string.
 *  - `startTunnelInvite()` — initiates creating a tunnel invite (prompts confirmation when creating a new tunnel).
 *  - `stopTunnelInvite()` — stops the running tunnel (no-op when a mutation is pending).
 *  - `copyTunnelInvite()` — copies the invite URL to the clipboard (no-op if URL or navigator is unavailable).
 */
function useTunnelControls(isHost: boolean) {
  const queryClient = useQueryClient();
  const [tunnelInviteCopied, setTunnelInviteCopied] = useState(false);
  const [tunnelMutationError, setTunnelMutationError] = useState("");
  const { data: tunnelStatus } = useQuery({
    queryKey: ["share", "tunnel", "status"],
    queryFn: () => getTunnelStatus(),
    refetchInterval: 10_000,
    enabled: isHost,
  });
  const startTunnelMutation = useMutation({
    mutationFn: () => startTunnel(),
    onMutate: () => setTunnelMutationError(""),
    onSuccess: (tunnel) => {
      queryClient.setQueryData(["share", "tunnel", "status"], tunnel);
      setTunnelMutationError("");
    },
    onError: (err) => {
      setTunnelMutationError(
        err instanceof Error ? err.message : "Could not start tunnel.",
      );
    },
  });
  const stopTunnelMutation = useMutation({
    mutationFn: () => stopTunnel(),
    onMutate: () => setTunnelMutationError(""),
    onSuccess: (tunnel) => {
      queryClient.setQueryData(["share", "tunnel", "status"], tunnel);
      setTunnelMutationError("");
    },
    onError: (err) => {
      setTunnelMutationError(
        err instanceof Error ? err.message : "Could not stop tunnel.",
      );
    },
  });

  const tunnelRunning = Boolean(tunnelStatus?.running);
  const tunnelMutationPending =
    startTunnelMutation.isPending || stopTunnelMutation.isPending;
  const tunnelInviteURL = tunnelRunning ? tunnelStatus?.invite_url || "" : "";
  const tunnelError = tunnelMutationError || tunnelStatus?.error;

  const startTunnelInvite = () => {
    if (tunnelMutationPending) return;
    // Re-clicking once a tunnel is already up just mints a fresh invite
    // against the same public URL — no point asking for the disclaimer
    // again, the URL is already exposed.
    if (tunnelRunning) {
      startTunnelMutation.mutate();
      return;
    }
    confirm({
      title: "Start a public tunnel?",
      message:
        "This opens a Cloudflare Quick Tunnel that publishes your WUPHF web UI on the public internet so a teammate can join from any browser.",
      details: (
        <ul>
          <li>
            <strong>Anyone with the link can attempt to join</strong> until you
            stop the tunnel — treat the URL like a password.
          </li>
          <li>
            Send the invite link only through a private channel. Don't post it
            in shared Slack/Discord rooms or anywhere it could be indexed.
          </li>
          <li>
            The invite token is one-use and expires in 24 hours, but the tunnel
            itself stays open until you click <em>Stop tunnel</em>.
          </li>
          <li>
            Cloudflare terminates TLS at the edge; traffic between Cloudflare
            and this machine runs over an outbound-only encrypted tunnel.
          </li>
        </ul>
      ),
      confirmLabel: "Start tunnel",
      cancelLabel: "Cancel",
      onConfirm: () => startTunnelMutation.mutate(),
    });
  };
  const stopTunnelInvite = () => {
    if (tunnelMutationPending) return;
    stopTunnelMutation.mutate();
  };
  const copyTunnelInvite = async () => {
    if (!tunnelInviteURL || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(tunnelInviteURL);
      setTunnelMutationError("");
      setTunnelInviteCopied(true);
      setTimeout(() => setTunnelInviteCopied(false), 1600);
    } catch (err) {
      console.error("Could not copy tunnel invite URL", err);
      setTunnelMutationError(
        "Could not copy invite. Copy it manually from the field.",
      );
    }
  };
  return {
    tunnelStatus,
    tunnelRunning,
    tunnelInviteURL,
    tunnelInviteCopied,
    tunnelMutationPending,
    tunnelError,
    startTunnelInvite,
    stopTunnelInvite,
    copyTunnelInvite,
  };
}

/**
 * Render the Health & Access page, presenting controls and status for sharing, tunneling, broker connectivity, team sessions, and runtime.
 *
 * Exposes UI for creating/stopping private-network invites and public tunnels, copying invite URLs, viewing broker and runtime health, and revoking team-member sessions. The component composes query-backed state and mutation handlers and passes them to child controls.
 *
 * @returns A React element that renders the health/access UI with controls for creating and stopping invites, copying invite URLs, viewing broker and runtime status, and managing team sessions.
 */
export function HealthCheckApp() {
  const queryClient = useQueryClient();
  const [inviteCopied, setInviteCopied] = useState(false);
  const [shareMutationError, setShareMutationError] = useState("");
  const [revokeSessionError, setRevokeSessionError] = useState("");
  const brokerConnected = useAppStore((s) => s.brokerConnected);
  const { data, isLoading, error } = useQuery({
    queryKey: ["health"],
    queryFn: () => getHealth(),
    refetchInterval: 10_000,
  });
  const { data: me } = useQuery({
    queryKey: HUMAN_ME_QUERY_KEY,
    queryFn: () => getHumanMe(),
    refetchInterval: HUMAN_ME_REFETCH_MS,
  });
  const human = me?.human;
  const isHost = human?.role === "host";
  const { data: humanSessions } = useQuery({
    queryKey: ["humans", "sessions"],
    queryFn: () => getHumanSessions(),
    refetchInterval: 30_000,
    enabled: isHost,
  });
  const { data: shareStatus } = useQuery({
    queryKey: ["share", "status"],
    queryFn: () => getShareStatus(),
    refetchInterval: 10_000,
    enabled: isHost,
  });
  const tunnel = useTunnelControls(isHost);
  const startShareMutation = useMutation({
    mutationFn: () => startShare(),
    onMutate: () => {
      setShareMutationError("");
    },
    onSuccess: (share) => {
      queryClient.setQueryData(["share", "status"], share);
      setShareMutationError("");
    },
    onError: (err) => {
      setShareMutationError(
        err instanceof Error ? err.message : "Could not create invite.",
      );
    },
  });
  const stopShareMutation = useMutation({
    mutationFn: () => stopShare(),
    onMutate: () => {
      setShareMutationError("");
    },
    onSuccess: (share) => {
      queryClient.setQueryData(["share", "status"], share);
      setShareMutationError("");
    },
    onError: (err) => {
      setShareMutationError(
        err instanceof Error ? err.message : "Could not stop sharing.",
      );
    },
  });
  const revokeSessionMutation = useMutation({
    mutationFn: (sessionID: string) => revokeHumanSession(sessionID),
    onMutate: () => {
      setRevokeSessionError("");
    },
    onSuccess: (_result, sessionID) => {
      queryClient.setQueryData<{ sessions?: HumanSession[] }>(
        ["humans", "sessions"],
        (current) => ({
          sessions: (current?.sessions ?? []).filter(
            (session) => session.id !== sessionID,
          ),
        }),
      );
      setRevokeSessionError("");
    },
    onError: (err) => {
      setRevokeSessionError(
        err instanceof Error ? err.message : "Could not disconnect session.",
      );
    },
  });

  if (isLoading) {
    return <LoadingState>Checking health...</LoadingState>;
  }

  if (error) {
    return <LoadingState>Could not reach health endpoint.</LoadingState>;
  }

  const status = data?.status ?? "unknown";
  const isHealthy = status === "ok" || status === "healthy";
  const sessions = (humanSessions?.sessions ?? []).filter(
    (session) => !session.revoked_at,
  );
  const ownOrigin =
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:7890";
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  const selfAccess = selfAccessDetails(hostname, ownOrigin);
  const humanLabel = humanDisplayName(human);
  const shareRunning = Boolean(shareStatus?.running);
  const shareMutationPending =
    startShareMutation.isPending || stopShareMutation.isPending;
  const shareError = shareMutationError || shareStatus?.error;
  const shareInviteURL = shareRunning ? shareStatus?.invite_url || "" : "";
  const shareNetworkLabel = [shareStatus?.interface, shareStatus?.bind]
    .filter(Boolean)
    .join(" / ");
  const startShareInvite = () => {
    if (shareMutationPending) return;
    startShareMutation.mutate();
  };
  const stopShareInvite = () => {
    if (shareMutationPending) return;
    stopShareMutation.mutate();
  };
  const copyInvite = async () => {
    if (!shareInviteURL || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(shareInviteURL);
      setShareMutationError("");
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1600);
    } catch (err) {
      console.error("Could not copy share invite URL", err);
      setShareMutationError(
        "Could not copy invite. Copy it manually from the field.",
      );
    }
  };
  const revokeSession = (sessionID: string) => {
    if (revokeSessionMutation.isPending) return;
    revokeSessionMutation.mutate(sessionID);
  };
  const items = runtimeItems(data);

  return (
    <>
      <div
        style={{
          padding: "0 0 12px",
          borderBottom: "1px solid var(--border)",
          marginBottom: 12,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          Access & Health
        </h3>
      </div>

      <AccessCards
        brokerConnected={brokerConnected}
        humanLabel={humanLabel}
        inviteCopied={inviteCopied}
        isHost={isHost}
        selfAccess={selfAccess}
        shareError={shareError}
        shareInviteURL={shareInviteURL}
        shareMutationPending={shareMutationPending}
        shareNetworkLabel={shareNetworkLabel}
        shareRunning={shareRunning}
        shareStatus={shareStatus}
        tunnelInviteCopied={tunnel.tunnelInviteCopied}
        tunnelInviteURL={tunnel.tunnelInviteURL}
        tunnelError={tunnel.tunnelError}
        tunnelMutationPending={tunnel.tunnelMutationPending}
        tunnelRunning={tunnel.tunnelRunning}
        tunnelStatus={tunnel.tunnelStatus}
        onCopyInvite={() => void copyInvite()}
        onCopyTunnelInvite={() => void tunnel.copyTunnelInvite()}
        onStartShareInvite={startShareInvite}
        onStartTunnelInvite={tunnel.startTunnelInvite}
        onStopShareInvite={stopShareInvite}
        onStopTunnelInvite={tunnel.stopTunnelInvite}
      />

      <BrokerStatusCard isHealthy={isHealthy} status={status} />
      <TeamMemberSessions
        isHost={isHost}
        isRevokingSession={revokeSessionMutation.isPending}
        onRevokeSession={revokeSession}
        revokeError={revokeSessionError}
        revokingSessionID={revokeSessionMutation.variables}
        sessions={sessions}
      />
      <RuntimeStatusList focusMode={data?.focus_mode} items={items} />
    </>
  );
}
