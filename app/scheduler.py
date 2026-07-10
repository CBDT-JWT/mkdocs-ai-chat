from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable


class Scheduler:
    def __init__(self, interval_seconds: float, job: Callable[[], None]) -> None:
        self.interval_seconds = interval_seconds
        self.job = job
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="mkdocs-ai-sync")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                self.job()
            except Exception:
                logging.exception("scheduled sync failed")
