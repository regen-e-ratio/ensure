import { rmSync } from "node:fs";

/** Start each e2e run from an empty store so the "first visit" empty state is reproducible. */
export default function globalSetup() {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    rmSync(`./data/e2e.db${suffix}`, { force: true });
  }
}
