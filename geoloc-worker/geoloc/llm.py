"""Claude vision steps: cheap triage, then reading the scene.

The geometry (solve.py) decides where the camera is. Claude only does the
judgement work: is there terrain to match, which pixel is the event's subject
(smoke, impact, building), and does the frame look edited, AI-made or filmed
off a screen.
"""
from __future__ import annotations

import base64
import json
import logging
import re

import cv2
import numpy as np

log = logging.getLogger("geoloc.llm")

MAX_SIDE = 1568

TRIAGE_PROMPT = """You check photos before an automated terrain-matching geolocation step.
Answer with JSON only: {"usable": true|false, "reason": "<short>"}.
usable = the frame shows open sky meeting terrain (hills, ridges, mountains) across a good part of its width,
taken outdoors, not a map, screenshot of text, close-up, interior, night shot or a scene with only buildings/smoke at the top."""

SCENE_PROMPT = """You assist an OSINT terrain-geolocation pipeline. The image is {w}x{h} pixels (x right, y down).
Event report (may be in Hebrew/Arabic/English):
---
{text}
---
Reported place(s): {places}

Return JSON only, no prose:
{{
 "has_skyline": true|false,          // open sky meets distant terrain across much of the width
 "target": {{"x": int, "y": int, "label": "<what it is, English, <= 12 words>"}} | null,
                                     // the pixel of the event's subject ON THE GROUND: base of the smoke column,
                                     // impact point, the struck building. null if not visible.
 "integrity": "ok" | "suspect_ai" | "suspect_edit" | "screen_recording" | "unclear",
 "integrity_reason": "<short>",
 "overlays": [[x0, y0, x1, y1], ...] // boxes of logos/captions/watermarks drawn over the sky or ridgeline, else []
}}"""


def _img_block(img_bgr: np.ndarray):
    h, w = img_bgr.shape[:2]
    s = min(1.0, MAX_SIDE / max(h, w))
    small = cv2.resize(img_bgr, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img_bgr
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 88])
    data = base64.b64encode(buf.tobytes()).decode()
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}}, s, small.shape[1], small.shape[0]


def _json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("model returned no JSON")
    return json.loads(m.group(0))


class Vision:
    def __init__(self, api_key: str, scene_model: str, triage_model: str | None):
        import anthropic
        self.client = anthropic.Anthropic(api_key=api_key)
        self.scene_model = scene_model
        self.triage_model = triage_model

    def _ask(self, model, img_block, prompt, max_tokens=600) -> dict:
        r = self.client.messages.create(model=model, max_tokens=max_tokens,
                                        messages=[{"role": "user", "content": [img_block, {"type": "text", "text": prompt}]}])
        return _json("".join(b.text for b in r.content if getattr(b, "type", "") == "text"))

    def triage(self, img_bgr) -> dict:
        if not self.triage_model:
            return {"usable": True, "reason": "triage off"}
        blk, *_ = _img_block(img_bgr)
        return self._ask(self.triage_model, blk, TRIAGE_PROMPT, 150)

    def scene(self, img_bgr, text: str, places: list[str]) -> dict:
        blk, s, w, h = _img_block(img_bgr)
        out = self._ask(self.scene_model, blk, SCENE_PROMPT.format(w=w, h=h, text=text[:2500] or "(none)",
                                                                   places=", ".join(places) or "(none)"))
        # back to full-resolution pixels
        t = out.get("target")
        if isinstance(t, dict) and "x" in t and "y" in t:
            t["x"], t["y"] = float(t["x"]) / s, float(t["y"]) / s
        out["overlays"] = [[float(c) / s for c in b] for b in out.get("overlays") or [] if len(b) == 4]
        out["model"] = self.scene_model
        return out
