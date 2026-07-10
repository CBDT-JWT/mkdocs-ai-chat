from app.crawler.github_sync import GitHubSync


def test_git_sync_env_removes_proxy_by_default(monkeypatch, tmp_path):
    monkeypatch.setenv("https_proxy", "http://127.0.0.1:7890")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:7890")

    sync = GitHubSync("owner/repo", "main", tmp_path)

    env = sync._env()
    assert "https_proxy" not in env
    assert "HTTPS_PROXY" not in env


def test_git_sync_env_can_keep_system_proxy(monkeypatch, tmp_path):
    monkeypatch.setenv("https_proxy", "http://127.0.0.1:7890")

    sync = GitHubSync("owner/repo", "main", tmp_path, use_system_proxy=True)

    assert sync._env()["https_proxy"] == "http://127.0.0.1:7890"
