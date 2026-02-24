import type { SnapshotView, ParseMetrics, WorkerMessage } from './types';

export type WorkerCallbacks = {
  onSuccess: (data: SnapshotView, metrics: ParseMetrics) => void;
  onError: (error: string) => void;
};

export function createWorkerClient() {
  const worker = new Worker(
    new URL('../workers/snapshotWorker.ts', import.meta.url),
    { type: 'module' },
  );

  let pending: WorkerCallbacks | null = null;

  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    if (!pending) return;
    const cb = pending;
    pending = null;

    if (e.data.type === 'success') {
      cb.onSuccess(e.data.data, e.data.metrics);
    } else {
      cb.onError(e.data.error);
    }
  };

  worker.onerror = (err) => {
    if (pending) {
      pending.onError(err.message);
      pending = null;
    }
  };

  return {
    /** Post an ArrayBuffer to the worker for parsing. Buffer is transferred (zero-copy). */
    parse(buffer: ArrayBuffer, fileSize: number, callbacks: WorkerCallbacks) {
      pending = callbacks;
      worker.postMessage({ buffer, fileSize }, [buffer]);
    },

    destroy() {
      worker.terminate();
    },
  };
}
