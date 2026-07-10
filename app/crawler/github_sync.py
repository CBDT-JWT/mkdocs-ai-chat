from __future__ import annotations

import subprocess
from pathlib import Path


class GitHubSyncError(RuntimeError):
    pass


class GitHubSync:
    def __init__(self, repo: str, branch: str, target_dir: Path) -> None:
        self.repo = repo
        self.branch = branch
        self.target_dir = target_dir

    @property
    def clone_url(self) -> str:
        if self.repo.startswith(("http://", "https://", "git@")):
            return self.repo
        return f"https://github.com/{self.repo}.git"

    def sync(self) -> str:
        self.target_dir.parent.mkdir(parents=True, exist_ok=True)
        if (self.target_dir / ".git").exists():
            self._run(["git", "fetch", "origin", self.branch], cwd=self.target_dir)
            self._run(["git", "checkout", self.branch], cwd=self.target_dir)
            self._run(["git", "pull", "--ff-only", "origin", self.branch], cwd=self.target_dir)
            return self.current_commit()

        self._run(
            [
                "git",
                "clone",
                "--depth",
                "1",
                "--branch",
                self.branch,
                self.clone_url,
                str(self.target_dir),
            ],
            cwd=self.target_dir.parent,
        )
        return self.current_commit()

    def current_commit(self) -> str:
        return self._run(["git", "rev-parse", "HEAD"], cwd=self.target_dir).strip()

    @staticmethod
    def _run(cmd: list[str], cwd: Path) -> str:
        try:
            completed = subprocess.run(
                cmd,
                cwd=str(cwd),
                check=True,
                text=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.strip() or exc.stdout.strip()
            raise GitHubSyncError(f"{' '.join(cmd)} failed: {detail}") from exc
        return completed.stdout
