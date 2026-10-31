import { CSV_LOG_HEADER, formatCsvLogLine, formatLogTimestamp } from "./csvLog";
import type { LogStore } from "./logStore";
import type { TelemetrySample } from "./types";

const FLUSH_INTERVAL_MS = 1000;

export type RecordedFile = { fileName: string; text: string };

type SessionLog = {
  fileName: string;
  /** Header + rows. Kept in memory too, so a failed store never loses the file. */
  lines: string[];
  storedLines: number;
  lastFlushAtMs: number;
  writeQueue: Promise<void>;
};

function createSessionLog(startedAt: Date): SessionLog {
  return {
    fileName: `${formatLogTimestamp(startedAt)}_${startedAt.getMilliseconds()}-serial.csv`,
    lines: [`${CSV_LOG_HEADER}\n`],
    storedLines: 0,
    lastFlushAtMs: startedAt.getTime(),
    writeQueue: Promise.resolve(),
  };
}

/** Writes the serial stream to one CSV, independent of the SD card. */
export function createSessionRecorder(store: LogStore, onStoreFailure: (cause: unknown) => void) {
  let session: SessionLog | null = null;

  const flushLog = (log: SessionLog): Promise<void> => {
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
    start(startedAt: Date) {
      session = createSessionLog(startedAt);
    },

    record(sample: TelemetrySample, at: Date) {
      if (!session) return;
      session.lines.push(`${formatCsvLogLine(sample, at)}\n`);
      if (at.getTime() - session.lastFlushAtMs < FLUSH_INTERVAL_MS) return;
      session.lastFlushAtMs = at.getTime();
      void flushLog(session);
    },

    flush() {
      if (session) void flushLog(session);
    },

    sampleCount(): number {
      return session ? session.lines.length - 1 : 0;
    },

    /** Ends the session. A session without samples produces no file. */
    async stop(): Promise<RecordedFile | null> {
      if (!session) return null;
      const log = session;
      session = null;
      if (log.lines.length <= 1) return null;
      await flushLog(log);
      return { fileName: log.fileName, text: log.lines.join("") };
    },
  };
}
