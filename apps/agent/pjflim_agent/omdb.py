"""OMDb lookup with verified mappings; no raw payload or credential persistence."""
from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from datetime import timedelta
import json
import logging
import re

from .catalog import AgentError, Catalog, normalize, utcnow

IMDB_ID = re.compile(r"tt[0-9]{7,10}\Z")


class _RedactApiKey(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        redacted = re.sub(r"""(?i)([?&]apikey=)[^&\s'"<>]+""", r"\1[REDACTED]", message)
        if redacted != message:
            record.msg, record.args = redacted, ()
        return True


def _redact_http_logs():
    # httpx logs request URLs at INFO; OMDb requires the key in the query string.
    import httpx  # Load transport loggers before installing their filters.
    names = {"httpx", "httpcore", "httpcore.connection", "httpcore.http11", "httpcore.http2", "httpcore.proxy"}
    names.update(n for n in logging.Logger.manager.loggerDict if n.startswith("httpcore."))
    for name in names:
        logger = logging.getLogger(name)
        if not any(isinstance(f, _RedactApiKey) for f in logger.filters):
            logger.addFilter(_RedactApiKey())


def _score(raw, scale):
    if raw is None or raw in ("", "N/A"):
        return None
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", raw):
        raise AgentError("SOURCE_SCHEMA_INVALID")
    value = float(raw)
    if not 0 <= value <= scale or (scale == 100 and not value.is_integer()):
        raise AgentError("SOURCE_SCHEMA_INVALID")
    return int(value) if scale == 100 else value


def _votes(raw):
    if raw is None or raw in ("", "N/A"):
        return None
    if not isinstance(raw, str) or not re.fullmatch(r"(?:[0-9]+|[1-9][0-9]{0,2}(?:,[0-9]{3})+)", raw):
        raise AgentError("SOURCE_SCHEMA_INVALID")
    value = int(raw.replace(",", ""))
    if value > 10**12:
        raise AgentError("SOURCE_SCHEMA_INVALID")
    return value


class Omdb:
    def __init__(self, api_key="", mappings=None, transport=None, clock=utcnow,
                 cache_ttl_seconds=3600, session_request_limit=900):
        if type(cache_ttl_seconds) is not int or not 1 <= cache_ttl_seconds <= 86400:
            raise AgentError("OMDB_CONFIG_INVALID")
        if type(session_request_limit) is not int or not 1 <= session_request_limit <= 1000:
            raise AgentError("OMDB_CONFIG_INVALID")
        self._api_key = api_key
        self.mappings, self.transport, self.clock = mappings or {}, transport, clock
        self.cache_ttl_seconds, self.session_request_limit = cache_ttl_seconds, session_request_limit
        self.calls, self.session_calls, self._cache = 0, 0, OrderedDict()
        _redact_http_logs()

    @property
    def configured(self):
        return bool(self._api_key)

    def matches_key(self, api_key):
        return self._api_key == api_key

    def reset(self):
        # Keep cache and session quota across questions, reset only the per-run budget.
        self.calls = 0

    def _get(self, params):
        import httpx
        if not self.configured:
            raise AgentError("OMDB_NOT_CONFIGURED")
        if self.calls >= 2:
            raise AgentError("SOURCE_BUDGET_EXCEEDED")
        if self.session_calls >= self.session_request_limit:
            raise AgentError("OMDB_SESSION_QUOTA_EXCEEDED")
        self.calls += 1
        self.session_calls += 1
        try:
            with httpx.Client(timeout=8, follow_redirects=False, trust_env=False, transport=self.transport) as client:
                with client.stream("GET", "https://www.omdbapi.com/",
                                   params={**params, "r": "json", "apikey": self._api_key},
                                   headers={"Accept": "application/json"}) as response:
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
                    try:
                        row = json.loads(content)
                    except (ValueError, UnicodeError):
                        raise AgentError("SOURCE_SCHEMA_INVALID") from None
            if not isinstance(row, dict):
                raise AgentError("SOURCE_SCHEMA_INVALID")
            if row.get("Response") == "False":
                error = str(row.get("Error", "")).lower()
                if "api key" in error or "apikey" in error:
                    raise AgentError("SOURCE_AUTH_REQUIRED")
                if "limit" in error:
                    raise AgentError("SOURCE_RATE_LIMITED")
                if "not found" in error:
                    raise AgentError("SOURCE_NOT_FOUND")
                raise AgentError("SOURCE_UNAVAILABLE")
            if row.get("Response") != "True":
                raise AgentError("SOURCE_SCHEMA_INVALID")
            return row
        except AgentError:
            raise
        except Exception:
            raise AgentError("SOURCE_UNAVAILABLE") from None

    def search(self, catalog: Catalog, title_id: str):
        title = catalog.title(title_id)
        if catalog.snapshot.demo:
            raise AgentError("DEMO_HAS_NO_EXTERNAL_MAPPING")
        kind = "movie" if title.kind == "MOVIE" else "series"
        params = {"s": title.original_name or title.name, "type": kind, "page": 1}
        if title.year:
            params["y"] = title.year
        row = self._get(params)
        candidates = row.get("Search")
        if not isinstance(candidates, list):
            raise AgentError("SOURCE_SCHEMA_INVALID")
        results = []
        for item in candidates[:10]:
            if not isinstance(item, dict) or not isinstance(item.get("imdbID"), str) or not IMDB_ID.fullmatch(item["imdbID"]):
                continue
            if item.get("Type") != kind or not isinstance(item.get("Title"), str):
                continue
            results.append({"provider": "OMDB", "imdb_id": item["imdbID"], "name": item["Title"][:300],
                            "year": str(item.get("Year", ""))[:20], "media_type": kind,
                            "url": "https://www.imdb.com/title/" + item["imdbID"] + "/",
                            "mapping_verified": False, "available_on_platform": None})
            if len(results) == 5:
                break
        return results

    def rating(self, catalog: Catalog, title_id: str):
        title = catalog.title(title_id)
        mapping = self.mappings.get(title_id)
        if catalog.snapshot.demo or not isinstance(mapping, dict) or mapping.get("verified") is not True:
            raise AgentError("EXTERNAL_MAPPING_NOT_VERIFIED")
        imdb_id = mapping.get("imdb_id")
        if not isinstance(imdb_id, str) or not IMDB_ID.fullmatch(imdb_id):
            raise AgentError("EXTERNAL_MAPPING_INVALID")
        if not self.configured:
            raise AgentError("OMDB_NOT_CONFIGURED")
        kind = "movie" if title.kind == "MOVIE" else "series"
        cache_key = (title.id, imdb_id, kind, title.name, title.original_name, title.year)
        now = self.clock()
        cached = self._cache.get(cache_key)
        if cached and now < cached[0]:
            self._cache.move_to_end(cache_key)
            result = deepcopy(cached[1])
            result["cache_hit"] = True
            return result
        self._cache.pop(cache_key, None)
        row = self._get({"i": imdb_id, "plot": "short"})
        names = {normalize(title.name), normalize(title.original_name or "")} - {""}
        year = re.match(r"^[0-9]{4}", str(row.get("Year", "")))
        if (row.get("imdbID") != imdb_id or row.get("Type") != kind
                or not isinstance(row.get("Title"), str) or normalize(row["Title"]) not in names
                or (title.year is not None and (not year or abs(title.year - int(year[0])) > 1))):
            raise AgentError("EXTERNAL_MAPPING_MISMATCH")
        imdb_score, metascore = _score(row.get("imdbRating"), 10), _score(row.get("Metascore"), 100)
        votes = _votes(row.get("imdbVotes"))
        if votes == 0:
            imdb_score = None
        expires = now + timedelta(seconds=self.cache_ttl_seconds)
        result = {"provider": "OMDB", "imdb_id": imdb_id, "media_type": kind, "mapping_verified": True,
                  "fetched_at": now.isoformat(), "expires_at": expires.isoformat(), "cache_hit": False,
                  "ratings": [
                      {"rating_source": "IMDB", "score_type": "IMDB_AUDIENCE_WEIGHTED_AVERAGE",
                       "value": imdb_score, "scale_max": 10, "votes": votes,
                       "source_url": "https://www.imdb.com/title/" + imdb_id + "/"},
                      {"rating_source": "METACRITIC", "score_type": "METACRITIC_CRITIC_METASCORE",
                       "value": metascore, "scale_max": 100, "votes": None, "source_url": None},
                  ]}
        self._cache[cache_key] = (expires, deepcopy(result))
        while len(self._cache) > 200:
            self._cache.popitem(last=False)
        return result
