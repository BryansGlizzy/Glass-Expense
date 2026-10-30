#!/usr/bin/env python3
"""
GlassExpense calendar client (Python 3.8+, `pip install cryptography requests`).

    GLASSEXPENSE_URL=https://expenses.example.com \
    GLASSEXPENSE_API_KEY='ge_AAAA….BBBB…' \
    python3 decrypt_calendar.py

API key = "<public half>.<private half>". Only the public half is sent to the server.
"""
import base64, json, os, sys
import requests
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE = os.environ.get("GLASSEXPENSE_URL", "").rstrip("/")
parts = os.environ.get("GLASSEXPENSE_API_KEY", "").split(".")
if not BASE or len(parts) != 2:
    sys.exit("Set GLASSEXPENSE_URL and GLASSEXPENSE_API_KEY (the full key, including the part after the dot).")
header_key, decrypt_part = parts


def b64(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def open_envelope(key: bytes, envelope: str, aad: str) -> bytes:
    # base64( IV[12] || ciphertext || tag[16] ), optionally prefixed with "v2."
    data = b64(envelope[3:] if envelope.startswith("v2.") else envelope)
    return AESGCM(key).decrypt(data[:12], data[12:], aad.encode())  # AESGCM expects ciphertext||tag


r = requests.get(f"{BASE}/api/calendar/schedule", headers={"x-api-key": header_key}, timeout=30)
r.raise_for_status()
schedule = r.json()

wrap_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=b"glassexpense/apikey-calendar/v2").derive(b64(decrypt_part))
calendar_key = open_envelope(wrap_key, schedule["wrapped_calendar_key"], "apikey-calendar")

jobs = [{
    "id": j["id"], "start_date": j["start_date"], "end_date": j["end_date"],
    "title": json.loads(open_envelope(calendar_key, j["title"], f"calendar-title|{j['id']}")) if j["title"] else None,
} for j in schedule["jobs"]]
print(json.dumps(jobs, indent=2))
