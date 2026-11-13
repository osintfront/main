"""SEN2SR Lite, non-reference RGBN ×4 (ESA OpenSR / tacofoundation, CC0 weights).

Four 10 m bands (B04, B03, B02, B08) → 2.5 m. Weights are downloaded once from Hugging Face
into models/SEN2SRLite_RGBN (mlstac fetches the model card, the weights and the model's small
loader script). Runs on CUDA when available, else on the CPU. torch / mlstac / sen2sr are imported
only here, so the rest of the worker and its tests run without them.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger("satsr.sen2sr")

MODEL_URL = "https://huggingface.co/tacofoundation/sen2sr/resolve/main/SEN2SRLite/NonReference_RGBN_x4/mlm.json"
MODEL_DIR = "SEN2SRLite_RGBN"
TILE = 128  # sen2sr.predict_large always works in 128 px patches


def model_dir(models_dir: Path) -> Path:
    return Path(models_dir) / MODEL_DIR


def weights_present(models_dir: Path) -> bool:
    return (model_dir(models_dir) / "mlm.json").exists()


class Sen2SRLite:
    name = "sen2sr_lite_rgbn_x4"
    scale = 4
    bands = ("B04", "B03", "B02", "B08")

    def __init__(self, models_dir: Path, threads: int | None = None):
        import mlstac
        import sen2sr
        import torch

        self._torch, self._sen2sr = torch, sen2sr
        if threads:
            torch.set_num_threads(int(threads))
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        d = model_dir(models_dir)
        if not weights_present(models_dir):
            log.info("downloading SEN2SR Lite weights to %s (first run only)", d)
            mlstac.download(file=MODEL_URL, output_dir=d)
        self.model = mlstac.load(d.as_posix()).compiled_model(device=self.device)
        try:
            self.model.eval()
        except AttributeError:
            pass
        self.version = f"sen2sr {getattr(sen2sr, '__version__', '?')} / mlstac {getattr(mlstac, '__version__', '?')}"
        log.info("SEN2SR Lite ready on %s", self.device)

    def upscale(self, x: np.ndarray) -> np.ndarray:
        torch = self._torch
        if x.ndim != 3 or x.shape[0] != 4:
            raise ValueError(f"expected [4, H, W], got {x.shape}")
        if x.shape[1] != x.shape[2] or x.shape[1] < TILE:
            # predict_large sizes its output from the first axis and walks 128 px patches
            raise ValueError(f"box must be square and at least {TILE} px, got {x.shape[1:]}")
        X = torch.nan_to_num(torch.from_numpy(np.ascontiguousarray(x, np.float32))).to(self.device)
        with torch.no_grad():
            if x.shape[1] == TILE:
                y = self.model(X[None]).squeeze(0)
            else:
                y = self._sen2sr.predict_large(model=self.model, X=X, overlap=32)
        return np.clip(y.detach().float().cpu().numpy(), 0.0, None).astype(np.float32)
