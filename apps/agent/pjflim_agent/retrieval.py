from __future__ import annotations
import json
from pathlib import Path

from .catalog import AgentError, Catalog, digest, normalize

EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
PREPROCESS_VERSION = "e5-prefix-l2-v1"


class HybridSearch:
    def __init__(self, catalog: Catalog, encode=None, embedding_revision=None, checkpoint_folder=None):
        import faiss
        import numpy as np
        self.catalog, self.np, self.faiss = catalog, np, faiss
        self.ids = list(catalog.by_id)
        self.model_revision = embedding_revision
        if encode is None:
            from sentence_transformers import SentenceTransformer
            self.encoder = SentenceTransformer(EMBEDDING_MODEL, device="cpu", revision=embedding_revision, trust_remote_code=False)
            self.encoder.max_seq_length = 512
            self.encode = lambda texts: self.encoder.encode(texts, normalize_embeddings=True, show_progress_bar=False, batch_size=16)
        else:
            self.encode = encode
        if checkpoint_folder is not None:
            self.restore(checkpoint_folder)
            return
        self.vectors = self._encode(["passage: " + catalog.document(catalog.by_id[i]) for i in self.ids]) if self.ids else np.empty((0, 384), dtype="float32")

    def _encode(self, values):
        array = self.np.asarray(self.encode(values), dtype="float32")
        if array.shape != (len(values), 384) or not self.np.isfinite(array).all():
            raise AgentError("EMBEDDING_INVALID")
        norms = self.np.linalg.norm(array, axis=1, keepdims=True)
        if (norms == 0).any():
            raise AgentError("EMBEDDING_ZERO_VECTOR")
        return self.np.ascontiguousarray(array / norms)

    def search(self, query: str, limit=5, kind=None, year=None, genre=None):
        self.catalog.ensure_fresh()
        if not query.strip() or len(query) > 500 or not 1 <= limit <= 10:
            raise AgentError("SEARCH_INPUT_INVALID")
        positions = [j for j, i in enumerate(self.ids)
                     if (not kind or self.catalog.by_id[i].kind == kind)
                     and (year is None or self.catalog.by_id[i].year == year)
                     and (not genre or any(normalize(genre) == normalize(g) for g in self.catalog.by_id[i].genres))]
        if not positions:
            return []
        # Filter BEFORE top-K. Small PoC exact index, never ANN over hidden candidates.
        index = self.faiss.IndexFlatIP(384)
        index.add(self.vectors[positions])
        _, semantic = index.search(self._encode(["query: " + query]), min(30, len(positions)))
        semantic_ids = [self.ids[positions[int(j)]] for j in semantic[0] if j >= 0]
        q = normalize(query)
        words = set(q.split())
        lexical = []
        for j in positions:
            title = self.catalog.by_id[self.ids[j]]
            name = normalize(title.name)
            haystack = set(normalize(self.catalog.document(title)).split())
            score = (10 if q == name else 4 if q in name else 0) + len(words & haystack) / max(1, len(words))
            if score:
                lexical.append((score, title.id))
        lexical.sort(key=lambda row: (-row[0], row[1]))
        exact = {i for _, i in lexical if normalize(self.catalog.by_id[i].name) == q}
        fused = {}
        for ranking in [semantic_ids, [i for _, i in lexical]]:
            for rank, title_id in enumerate(ranking, 1):
                fused[title_id] = fused.get(title_id, 0) + 1 / (60 + rank)
        ranked = sorted(fused, key=lambda i: (i not in exact, -fused[i], i))[:limit]
        return [self.catalog.by_id[i] for i in ranked]

    def save(self, folder: str | Path):
        self.catalog.ensure_fresh()
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        file = folder / "vectors.npy"
        self.np.save(file, self.vectors, allow_pickle=False)
        import hashlib
        manifest = {"model": EMBEDDING_MODEL, "revision": self.model_revision,
                    "preprocess": PREPROCESS_VERSION, "snapshot_hash": self.catalog.snapshot.titles_sha256,
                    "ids": self.ids, "shape": list(self.vectors.shape),
                    "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
        (folder / "index-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    def restore(self, folder: str | Path):
        import hashlib
        self.catalog.ensure_fresh()
        folder = Path(folder)
        file, meta = folder / "vectors.npy", folder / "index-manifest.json"
        try:
            if file.stat().st_size > 2_000_000 or meta.stat().st_size > 150_000:
                raise ValueError()
            manifest = json.loads(meta.read_text(encoding="utf-8"))
            if (manifest["model"] != EMBEDDING_MODEL or manifest["revision"] != self.model_revision
                or manifest["preprocess"] != PREPROCESS_VERSION
                or manifest["snapshot_hash"] != self.catalog.snapshot.titles_sha256 or manifest["ids"] != self.ids
                or manifest["sha256"] != hashlib.sha256(file.read_bytes()).hexdigest()):
                raise ValueError()
            vectors = self.np.load(file, allow_pickle=False)
            if vectors.shape != (len(self.ids), 384) or not self.np.isfinite(vectors).all():
                raise ValueError()
            if len(vectors) and not self.np.allclose(self.np.linalg.norm(vectors, axis=1), 1, atol=1e-5):
                raise ValueError()
            self.vectors = self.np.ascontiguousarray(vectors, dtype="float32")
        except (OSError, ValueError, KeyError, TypeError):
            raise AgentError("CHECKPOINT_INVALID") from None
