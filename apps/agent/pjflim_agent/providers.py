from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

from .catalog import AgentError, Catalog, normalize, utcnow


class Tmdb:
    """Structured lookup only. Key and endpoint are never controlled by the model."""
    def __init__(self, token="", mappings=None, transport=None):
        self.token = token
        self.mappings = mappings or {}
        self.transport = transport
        self.calls = 0

    def reset(self):
        self.calls = 0

    def _get(self, path, params):
        import httpx
        if not self.token:
            raise AgentError("TMDB_NOT_CONFIGURED")
        if self.calls >= 2:
            raise AgentError("SOURCE_BUDGET_EXCEEDED")
        if not re.fullmatch(r"/3/(search/(movie|tv)|(movie|tv)/[1-9][0-9]{0,9})", path):
            raise AgentError("SOURCE_ROUTE_DENIED")
        self.calls += 1
        try:
            with httpx.Client(timeout=8, follow_redirects=False, trust_env=False, transport=self.transport) as client:
                with client.stream("GET", "https://api.themoviedb.org" + path, params=params,
                                   headers={"Authorization": "Bearer " + self.token, "Accept": "application/json"}) as response:
                    if response.status_code in (401, 403):
                        raise AgentError("SOURCE_AUTH_REQUIRED")
                    if response.status_code == 429:
                        raise AgentError("SOURCE_RATE_LIMITED")
                    if response.status_code != 200:
                        raise AgentError("SOURCE_UNAVAILABLE")
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        content.extend(chunk)
                        if len(content) > 256_000:
                            raise AgentError("SOURCE_RESPONSE_TOO_LARGE")
                    import json
                    return json.loads(content)
        except AgentError:
            raise
        except Exception:
            raise AgentError("SOURCE_UNAVAILABLE") from None

    def search(self, catalog: Catalog, title_id: str):
        title = catalog.title(title_id)
        if catalog.snapshot.demo:
            raise AgentError("DEMO_HAS_NO_EXTERNAL_MAPPING")
        kind = "movie" if title.kind == "MOVIE" else "tv"
        params = {"query": title.original_name or title.name, "language": "vi-VN", "page": 1}
        if title.year:
            params["year" if kind == "movie" else "first_air_date_year"] = title.year
        data = self._get("/3/search/" + kind, params)
        results = []
        for row in data.get("results", [])[:5]:
            if type(row.get("id")) is not int or row["id"] <= 0:
                continue
            results.append({"provider": "TMDB", "media_type": kind, "external_id": row["id"],
                            "name": str(row.get("title") or row.get("name") or "")[:300],
                            "date": str(row.get("release_date") or row.get("first_air_date") or "")[:10],
                            "url": "https://www.themoviedb.org/" + kind + "/" + str(row["id"]),
                            "mapping_verified": False, "available_on_platform": None})
        return results

    def rating(self, catalog: Catalog, title_id: str):
        title = catalog.title(title_id)
        mapping = self.mappings.get(title_id)
        kind = "movie" if title.kind == "MOVIE" else "tv"
        if catalog.snapshot.demo or not mapping or mapping.get("verified") is not True or mapping.get("kind") != kind:
            raise AgentError("EXTERNAL_MAPPING_NOT_VERIFIED")
        external_id = mapping.get("id")
        if type(external_id) is not int or not 1 <= external_id < 10**10:
            raise AgentError("EXTERNAL_MAPPING_INVALID")
        row = self._get("/3/" + kind + "/" + str(external_id), {"language": "vi-VN"})
        names = {normalize(str(row.get(k) or "")) for k in ("title", "original_title", "name", "original_name")}
        local_names = {normalize(title.name), normalize(title.original_name or "")} - {""}
        date = str(row.get("release_date") or row.get("first_air_date") or "")
        if type(row.get("id")) is not int or row["id"] != external_id or not names.intersection(local_names):
            raise AgentError("EXTERNAL_MAPPING_MISMATCH")
        if title.year and date[:4].isdigit() and abs(title.year - int(date[:4])) > 1:
            raise AgentError("EXTERNAL_MAPPING_MISMATCH")
        rating, votes = row.get("vote_average"), row.get("vote_count")
        if (isinstance(rating, bool) or not isinstance(rating, (int, float)) or not 0 <= rating <= 10
            or type(votes) is not int or votes < 0):
            raise AgentError("SOURCE_SCHEMA_INVALID")
        return {"provider": "TMDB", "score_type": "TMDB_AUDIENCE_AVERAGE", "value": rating if votes else None,
                "scale_max": 10, "votes": votes, "fetched_at": utcnow().isoformat(),
                "source_updated_at": None,
                "url": "https://www.themoviedb.org/" + kind + "/" + str(external_id)}


DEFAULT_REVIEW_DOMAINS = ("theguardian.com", "moveek.com", "vnexpress.net")


def public_review_url(value, domains):
    if not isinstance(value, str) or len(value) > 1500 or any(ord(c) < 32 for c in value):
        return None
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            return None
        if not any(host == domain or host.endswith("." + domain) for domain in domains):
            return None
        # Discovery ONLY. Never fetch/resolve these result URLs, drop tracking/query parameters.
        return urlunsplit(("https", host, parsed.path or "/", "", ""))
    except ValueError:
        return None


class ReviewDiscovery:
    def __init__(self, enabled=False, domains=DEFAULT_REVIEW_DOMAINS, search=None):
        self.enabled, self.domains, self.search = enabled, tuple(domains), search
        self.calls = 0

    def reset(self):
        self.calls = 0

    def find(self, catalog: Catalog, title_id: str):
        title = catalog.title(title_id)
        if not self.enabled:
            raise AgentError("WEB_SEARCH_DISABLED")
        if catalog.snapshot.demo:
            raise AgentError("DEMO_HAS_NO_EXTERNAL_MAPPING")
        if self.calls >= 2:
            raise AgentError("SOURCE_BUDGET_EXCEEDED")
        self.calls += 1
        query = (title.original_name or title.name) + " " + (str(title.year) if title.year else "") + " review"
        query += " (" + " OR ".join("site:" + d for d in self.domains) + ")"
        try:
            if self.search is None:
                from ddgs import DDGS
                rows = DDGS(timeout=8).text(query, max_results=5, backend="duckduckgo")
            else:
                rows = self.search(query)
            found, seen = [], set()
            from itertools import islice
            for row in islice(rows, 10):
                url = public_review_url(row.get("href") or row.get("url"), self.domains)
                if url and url not in seen:
                    seen.add(url)
                    # No article text, snippets, authors, dates or numbers inferred from search results.
                    found.append({"url": url, "publisher": urlsplit(url).hostname, "content_kind": "REFERENCE_ONLY",
                                  "read_verified": False, "language": None})
                if len(found) == 5:
                    break
            return found
        except AgentError:
            raise
        except Exception:
            raise AgentError("WEB_SEARCH_UNAVAILABLE") from None
