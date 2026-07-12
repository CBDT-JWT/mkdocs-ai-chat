from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_published_widget_matches_source_assets():
    for name in ("ai-chat.js", "ai-chat.css"):
        assert (ROOT / "widget" / "src" / name).read_bytes() == (
            ROOT / "widget" / "dist" / name
        ).read_bytes()


def test_widget_motion_keeps_accessibility_fallbacks():
    css = (ROOT / "widget" / "src" / "ai-chat.css").read_text()
    javascript = (ROOT / "widget" / "src" / "ai-chat.js").read_text()

    assert '.mkai-panel[data-open="true"]' in css
    assert "@keyframes mkai-message-in" in css
    assert "@media (prefers-reduced-motion: reduce)" in css
    assert 'button.setAttribute("aria-expanded", state)' in javascript
    assert 'panel.setAttribute("aria-hidden", String(!isOpen))' in javascript
    assert 'return ".css" + (suffix || "")' in javascript
    assert "existingLink.href === href" in javascript


def test_clear_history_can_cancel_an_active_request():
    javascript = (ROOT / "widget" / "src" / "ai-chat.js").read_text()

    assert "request.controller.abort()" in javascript
    assert "if (request.cancelled) return" in javascript
    assert "clearHistoryButton.disabled = true" not in javascript


def test_mobile_layout_tracks_the_visual_viewport():
    css = (ROOT / "widget" / "src" / "ai-chat.css").read_text()
    javascript = (ROOT / "widget" / "src" / "ai-chat.js").read_text()

    assert "--mkai-mobile-viewport-height" in css
    assert "100dvh" in css
    assert "font-size: 16px" in css
    assert "mkai-mobile-chat-open" in css
    assert "window.visualViewport" in javascript
    assert "function syncInputHeight()" in javascript
