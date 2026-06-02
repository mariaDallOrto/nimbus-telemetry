import type { ConnectionStatus } from "../telemetry/types";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  offline: "Desconectado",
  connecting: "Conectando",
  online: "Online",
  reconnecting: "Reconectando",
};

type ConnectionStatusBadgeProps = {
  status: ConnectionStatus;
  /** Compact variant used inside the sidebar footer. */
  compact?: boolean;
};

export function ConnectionStatusBadge({ status, compact = false }: ConnectionStatusBadgeProps) {
  return (
    <span
      className={`nt-status${compact ? " nt-status--sm" : ""}`}
      data-state={status}
      role="status"
      aria-label={`Conexão: ${STATUS_LABEL[status]}`}
    >
      <span className="nt-status__dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
