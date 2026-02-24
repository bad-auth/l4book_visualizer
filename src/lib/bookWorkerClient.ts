import type {
  SnapshotView,
  ParseMetrics,
  StreamMetrics,
  ConnectionStatus,
  BookWorkerOutMessage,
} from './types';

export type BookWorkerCallbacks = {
  onStatus: (status: ConnectionStatus, message?: string) => void;
  onSnapshot: (data: SnapshotView, metrics: StreamMetrics) => void;
  onUpdate: (data: SnapshotView, metrics: StreamMetrics) => void;
  onFileResult: (data: SnapshotView, metrics: ParseMetrics) => void;
  onFileError: (error: string) => void;
};

export function createBookWorkerClient(callbacks: BookWorkerCallbacks) {
  const worker = new Worker(
    new URL('../workers/bookWorker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (e: MessageEvent<BookWorkerOutMessage>) => {
    const msg = e.data;
    switch (msg.type) {
      case 'status':
        callbacks.onStatus(msg.status, msg.message);
        break;
      case 'snapshot':
        callbacks.onSnapshot(msg.data, msg.metrics);
        break;
      case 'update':
        callbacks.onUpdate(msg.data, msg.metrics);
        break;
      case 'fileResult':
        callbacks.onFileResult(msg.data, msg.metrics);
        break;
      case 'fileError':
        callbacks.onFileError(msg.error);
        break;
    }
  };

  worker.onerror = (err) => {
    callbacks.onStatus('error', err.message);
  };

  return {
    connect(url: string, coin: string) {
      worker.postMessage({ type: 'connect', url, coin });
    },

    disconnect() {
      worker.postMessage({ type: 'disconnect' });
    },

    setRebuildInterval(intervalMs: number) {
      worker.postMessage({ type: 'setRebuildInterval', intervalMs });
    },

    parseFile(buffer: ArrayBuffer, fileSize: number) {
      worker.postMessage({ type: 'parseFile', buffer, fileSize }, [buffer]);
    },

    destroy() {
      worker.terminate();
    },
  };
}
