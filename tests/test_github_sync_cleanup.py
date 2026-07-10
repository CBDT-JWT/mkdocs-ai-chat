from pathlib import Path

from app.crawler.github_sync import GitHubSync


def test_sync_removes_non_git_target_before_clone(monkeypatch, tmp_path: Path):
    target = tmp_path / "repo"
    target.mkdir()
    (target / "partial-file").write_text("leftover", encoding="utf-8")
    calls = []

    def fake_run(self, cmd, cwd):
        calls.append((cmd, cwd))
        target.mkdir(exist_ok=True)
        (target / ".git").mkdir(exist_ok=True)
        return "abc123\n" if cmd[:2] == ["git", "rev-parse"] else ""

    monkeypatch.setattr(GitHubSync, "_run", fake_run)

    commit = GitHubSync("owner/repo", "main", target).sync()

    assert commit == "abc123"
    assert not (target / "partial-file").exists()
    assert calls[0][0][:2] == ["git", "clone"]
    assert calls[0][0][-1] == str(target.resolve())
