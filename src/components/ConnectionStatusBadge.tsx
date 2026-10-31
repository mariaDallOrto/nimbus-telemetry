import type { ConnectionStatus } from "../telemetry/types";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  offline: "Desconectado",
  connecting: "Conectando",
  online: "Online",
  reconnecting: "Reconectando",
};

type ConnectionStatusBadgeProps = {
  status: ConnectionStatus;
  /** Names the link when several are shown side by side. */
  linkLabel?: string;
  /** Compact variant used inside the sidebar footer. */
  compact?: boolean;
};

export function ConnectionStatusBadge({
  status,
  linkLabel,
  compact = false,
}: ConnectionStatusBadgeProps) {
  const label = linkLabel ? `${linkLabel}: ${STATUS_LABEL[status]}` : STATUS_LABEL[status];
  return (
    <span
      className={`nt-status${compact ? " nt-status--sm" : ""}`}
      data-state={status}
      role="status"
      aria-label={`Conexão: ${label}`}
      title={label}
    >
      <span className="nt-status__dot" aria-hidden />
      {linkLabel ? <span className="nt-status__link">{linkLabel}</span> : null}
      <span className="nt-status__value">{STATUS_LABEL[status]}</span>
    </span>
  );
}
