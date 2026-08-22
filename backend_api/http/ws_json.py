"""JSON serialization for WebSocket frames."""

from __future__ import annotations

import json
from datetime import datetime


def dumps_ws_payload(payload: dict) -> str:
    """Serialize WS frames with ISO-8601 datetimes (same shape as REST)."""

    def default(value: object) -> str:
        if isinstance(value, datetime):
            iso = value.isoformat()
            if value.tzinfo is None:
                return f"{iso}Z"
            return iso.replace("+00:00", "Z")
        return str(value)

    return json.dumps(payload, default=default)
