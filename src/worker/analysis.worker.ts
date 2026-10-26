import { createHandler } from "./handler";
import type { WorkerRequest, WorkerResponse } from "./protocol";

// The project compiles against the DOM lib, which conflicts with the
// WebWorker lib; describe just the slice of the worker scope used here.
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}
const scope = self as unknown as WorkerScope;

const handle = createHandler({ notify: (response) => scope.postMessage(response) });

scope.onmessage = (event) => {
  void handle(event.data, (response) => scope.postMessage(response));
};
