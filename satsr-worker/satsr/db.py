"""Tiny Supabase client (REST + Storage) using only the standard library."""
from __future__ import annotations

import json
import urllib.error
import urllib.request


class Supabase:
    def __init__(self, url: str, service_key: str):
        self.url = url.rstrip("/")
        self.key = service_key

    def _req(self, method: str, path: str, body=None, headers=None, raw: bytes | None = None, timeout=60):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                out = r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} → {e.code}: {e.read()[:400].decode(errors='replace')}") from None
        return json.loads(out) if out else None

    def rpc(self, fn: str, args: dict):
        return self._req("POST", f"/rest/v1/rpc/{fn}", args)

    def upload(self, bucket: str, path: str, data: bytes, content_type="image/png"):
        self._req("POST", f"/storage/v1/object/{bucket}/{path}", raw=data,
                  headers={"Content-Type": content_type, "x-upsert": "true"}, timeout=120)
        return path

    def delete(self, bucket: str, paths: list[str]):
        """Remove objects (Storage API: DELETE /object/{bucket} with {"prefixes": [...]}); 100 per call."""
        for i in range(0, len(paths), 100):
            self._req("DELETE", f"/storage/v1/object/{bucket}", {"prefixes": paths[i:i + 100]})
