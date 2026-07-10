from app.config import Settings
from app.main import create_app


def test_health_endpoint(tmp_path, monkeypatch):
    config = Settings(
        data_dir=tmp_path / "data",
        auto_sync_on_start=False,
        deepseek_api_key="test",
    )
    app = create_app(config)
    client = app.test_client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"
