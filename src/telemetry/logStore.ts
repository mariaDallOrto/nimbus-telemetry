// Durable browser storage for recorded logs. Chunks land in IndexedDB while the
// session runs, so a crash or a closed tab costs at most the last unflushed chunk.

const DATABASE_NAME = "nimbus-telemetry-logs";
const CHUNK_STORE = "chunks";
const FILE_NAME_INDEX = "fileName";

type LogChunk = { fileName: string; text: string };

export type SavedLog = { fileName: string; characters: number };

export type LogStore = {
  append: (fileName: string, text: string) => Promise<void>;
  read: (fileName: string) => Promise<string>;
  list: () => Promise<SavedLog[]>;
  remove: (fileName: string) => Promise<void>;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    const chunks = request.result.createObjectStore(CHUNK_STORE, { autoIncrement: true });
    chunks.createIndex(FILE_NAME_INDEX, FILE_NAME_INDEX);
  };
  return requestResult(request);
}

export function createLogStore(): LogStore {
  let database: Promise<IDBDatabase> | null = null;
  const connection = () => {
    database ??= openDatabase().then(
      (opened) => {
        opened.onclose = () => (database = null);
        return opened;
      },
      (cause: unknown) => {
        database = null;
        throw cause;
      },
    );
    return database;
  };

  const readChunks = async (fileName?: string): Promise<LogChunk[]> => {
    const store = (await connection()).transaction(CHUNK_STORE).objectStore(CHUNK_STORE);
    const source = fileName === undefined ? store : store.index(FILE_NAME_INDEX);
    return requestResult(source.getAll(fileName));
  };

  return {
    async append(fileName, text) {
      const chunk: LogChunk = { fileName, text };
      const transaction = (await connection()).transaction(CHUNK_STORE, "readwrite", {
        durability: "strict",
      });
      transaction.objectStore(CHUNK_STORE).add(chunk);
      await transactionDone(transaction);
    },

    async read(fileName) {
      const chunks = await readChunks(fileName);
      return chunks.map((chunk) => chunk.text).join("");
    },

    async list() {
      const characters = new Map<string, number>();
      for (const chunk of await readChunks()) {
        characters.set(chunk.fileName, (characters.get(chunk.fileName) ?? 0) + chunk.text.length);
      }
      return [...characters]
        .map(([fileName, total]) => ({ fileName, characters: total }))
        .sort((a, b) => b.fileName.localeCompare(a.fileName));
    },

    async remove(fileName) {
      const transaction = (await connection()).transaction(CHUNK_STORE, "readwrite");
      const store = transaction.objectStore(CHUNK_STORE);
      const keys = await requestResult(store.index(FILE_NAME_INDEX).getAllKeys(fileName));
      for (const key of keys) store.delete(key);
      await transactionDone(transaction);
    },
  };
}
