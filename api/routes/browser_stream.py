"""
WebSocket endpoint for live browser automation screenshots.
"""
from __future__ import annotations

import asyncio
import base64
from typing import Any, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["browser_stream"])

_subscribers: Set[WebSocket] = set()
_active_browser_page: Any = None


def set_active_browser_page(page: Any | None) -> None:
    global _active_browser_page
    _active_browser_page = page


def get_active_browser_page() -> Any | None:
    return _active_browser_page


async def broadcast_event(event_type: str, payload: dict[str, Any] | None = None) -> None:
    """Broadcast lightweight automation events to all connected viewers."""
    message: dict[str, Any] = {"type": event_type}
    if payload:
        message.update(payload)

    stale: list[WebSocket] = []
    for socket in _subscribers:
        try:
            await socket.send_json(message)
        except Exception:
            stale.append(socket)

    for socket in stale:
        _subscribers.discard(socket)


@router.websocket("/ws/browser-stream")
async def browser_stream(websocket: WebSocket):
    await websocket.accept()
    _subscribers.add(websocket)

    # Initial handshake for status UI.
    try:
        await websocket.send_json({"type": "connected"})
    except RuntimeError:
        _subscribers.discard(websocket)
        return

    try:
        while True:
            page = get_active_browser_page()
            if page is None:
                try:
                    await websocket.send_json({"type": "idle"})
                except RuntimeError:
                    break
                await asyncio.sleep(0.5)
                continue

            try:
                screenshot = await page.screenshot(type="jpeg", quality=50)
                screenshot_b64 = base64.b64encode(screenshot).decode("utf-8")
                try:
                    await websocket.send_json(
                        {
                            "type": "frame",
                            "data": screenshot_b64,
                            "timestamp": asyncio.get_event_loop().time(),
                        }
                    )
                except RuntimeError:
                    break
            except Exception:
                # Browser/page can momentarily disappear between steps.
                await asyncio.sleep(0.2)
                continue

            await asyncio.sleep(0.3)  # About 3 FPS
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _subscribers.discard(websocket)
