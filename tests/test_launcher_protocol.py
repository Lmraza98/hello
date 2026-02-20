import pytest

from launcher_runtime.protocol import parse_message


def test_parse_message_rejects_bad_shape():
    with pytest.raises(ValueError):
        parse_message({"payload": {}})


def test_parse_message_accepts_valid():
    msg = parse_message({"type": "ping", "payload": {"x": 1}})
    assert msg.type == "ping"
    assert msg.payload["x"] == 1
