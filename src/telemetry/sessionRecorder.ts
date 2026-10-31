import { CSV_LOG_HEADER, formatCsvLogLine, formatLogTimestamp } from "./csvLog";
import type { LogStore } from "./logStore";
import type { TelemetryLink, TelemetrySample } from "./types";

const FLUSH_INTERVAL_MS = 1000;

export type RecordedFile = { fileName: string; text: string };

type LinkLog = {
  fileName: string;
  /** Header + rows. Kept in memory too, so a failed store never loses the file. */
  lines: string[];
  storedLines: number;
  lastFlushAtMs: number;
  writeQueue: Promise<void>;
};

type SessionLogs = Record<TelemetryLink, LinkLog>;

function createLinkLog(startedAt: Date, link: TelemetryLink): LinkLog {
  return {
    fileName: `${formatLogTimestamp(startedAt)}_${startedAt.getMilliseconds()}-${link}.csv`,
    lines: [`${CSV_LOG_HEADER}\n`],
    storedLines: 0,
    lastFlushAtMs: startedAt.getTime(),
    writeQueue: Promise.resolve(),
  };
}

/** Writes one CSV per link, each independent of the other link and of the SD card. */
export function createSessionRecorder(store: LogStore, onStoreFailure: (cause: unknown) => void) {
  let session: SessionLogs | null = null;

  const flush = (log: LinkLog): Promise<void> => {
    log.writeQueue = log.writeQueue.then(async () => {
      const lineCount = log.lines.length;
      const hasOnlyHeader = lineCount <= 1;
      if (hasOnlyHeader || lineCount === log.storedLines) return;
      try {
        await store.append(log.fileName, log.lines.slice(log.storedLines, lineCount).join(""));
        log.storedLines = lineCount;
      } catch (cause) {
        onStoreFailure(cause);
      }
    });
    return log.writeQueue;
  };

  return {
    isActive: () => session !== null,

    start(startedAt: Date) {
      session = {
        wifi: createLinkLog(startedAt, "wifi"),
        serial: createLinkLog(startedAt, "serial"),
      };
    },

    record(link: TelemetryLink, sample: TelemetrySample, at: Date) {
      if (!session) return;
      const log = session[link];
      log.lines.push(`${formatCsvLogLine(sample, at)}\n`);
      if (at.getTime() - log.lastFlushAtMs < FLUSH_INTERVAL_MS) return;
      log.lastFlushAtMs = at.getTime();
      void flush(log);
    },

    flushLink(link: TelemetryLink) {
      if (session) void flush(session[link]);
    },

    sampleCount(link: TelemetryLink): number {
      return session ? session[link].lines.length - 1 : 0;
    },

    /** Ends the session. Links that never delivered a sample produce no file. */
    async stop(): Promise<RecordedFile[]> {
      if (!session) return [];
      const logs = Object.values(session).filter((log) => log.lines.length > 1);
      session = null;
      await Promise.all(logs.map(flush));
      return logs.map((log) => ({ fileName: log.fileName, text: log.lines.join("") }));
    },
  };
}
