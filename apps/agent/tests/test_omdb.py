import json
import logging
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from langchain_core.messages import AIMessage, ToolMessage

from pjflim_agent.catalog import AgentError, Catalog, create_demo, digest
from pjflim_agent.omdb import Omdb
from pjflim_agent.agent import MovieAgent

NOW = datetime(2026, 11, 14, 8, tzinfo=timezone.utc)
KEY = "fixture-private-omdb-key"


class OmdbChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "catalog.snapshot.json"
        self.demo = create_demo(self.path, NOW)
        raw = json.loads(self.path.read_text())
        self.title_id = str(uuid4())
        raw.update(demo=False, source="pj-flim-public-catalog")
        title = raw["titles"][0]
        title.update(id=self.title_id, name="Phim thử", original_name="Fixture Film", year=2010, kind="MOVIE")
        raw["titles"] = [title]
        raw["titles_sha256"] = digest(raw["titles"])
        self.path.write_text(json.dumps(raw), encoding="utf-8")
        self.clock = NOW
        self.catalog = Catalog.load(self.path, clock=lambda: self.clock)
        self.requests = []
        self.payload = {"Response": "True", "imdbID": "tt0000001", "Type": "movie",
                        "Title": "Fixture Film", "Year": "2010", "imdbRating": "7.5",
                        "imdbVotes": "12,345", "Metascore": "67"}
        self.mapping = {self.title_id: {"imdb_id": "tt0000001", "verified": True}}

    def tearDown(self):
        self.tmp.cleanup()

    def code(self, expected, action):
        with self.assertRaises(AgentError) as raised:
            action()
        self.assertEqual(raised.exception.code, expected)
        self.assertNotIn(KEY, str(raised.exception))

    def provider(self, status=200, payload=None, **kwargs):
        def respond(request):
            self.requests.append(request)
            return httpx.Response(status, json=self.payload if payload is None else payload)
        return Omdb(api_key=KEY, mappings=self.mapping, transport=httpx.MockTransport(respond),
                    clock=lambda: self.clock, **kwargs)

    def test_missing_key_does_not_call_network(self):
        provider = self.provider()
        provider._api_key = ""
        self.code("OMDB_NOT_CONFIGURED", lambda: provider.rating(self.catalog, self.title_id))
        self.code("OMDB_NOT_CONFIGURED", lambda: provider.search(self.catalog, self.title_id))
        self.assertEqual(self.requests, [])

    def test_demo_never_calls_external_api(self):
        provider = self.provider()
        title_id = next(iter(self.demo.by_id))
        self.code("DEMO_HAS_NO_EXTERNAL_MAPPING", lambda: provider.search(self.demo, title_id))
        self.code("EXTERNAL_MAPPING_NOT_VERIFIED", lambda: provider.rating(self.demo, title_id))
        self.assertEqual(self.requests, [])

    def test_verified_mapping_and_bounded_id_required(self):
        for mapping, expected in [
            ({}, "EXTERNAL_MAPPING_NOT_VERIFIED"),
            ({"imdb_id": "tt0000001", "verified": False}, "EXTERNAL_MAPPING_NOT_VERIFIED"),
            ({"imdb_id": "tt0000001", "verified": 1}, "EXTERNAL_MAPPING_NOT_VERIFIED"),
            ({"imdb_id": "tt0000001&apikey=bad", "verified": True}, "EXTERNAL_MAPPING_INVALID"),
            ({"imdb_id": 123, "verified": True}, "EXTERNAL_MAPPING_INVALID"),
        ]:
            with self.subTest(mapping=mapping):
                provider = self.provider()
                provider.mappings = {self.title_id: mapping}
                self.code(expected, lambda: provider.rating(self.catalog, self.title_id))
        self.assertEqual(self.requests, [])

    def test_rating_sources_scales_votes_and_no_key_in_result(self):
        result = self.provider().rating(self.catalog, self.title_id)
        imdb, meta = result["ratings"]
        self.assertEqual((imdb["rating_source"], imdb["value"], imdb["scale_max"], imdb["votes"]), ("IMDB", 7.5, 10, 12345))
        self.assertEqual((meta["rating_source"], meta["value"], meta["scale_max"], meta["votes"]), ("METACRITIC", 67, 100, None))
        self.assertIsNone(meta["source_url"])
        self.assertIn("fetched_at", result)
        self.assertNotIn(KEY, json.dumps(result))
        request = self.requests[0]
        self.assertEqual(str(request.url.copy_with(query=None)), "https://www.omdbapi.com/")
        self.assertEqual(request.url.params["apikey"], KEY)
        self.assertEqual(request.url.params["i"], "tt0000001")

    def test_id_type_name_and_year_are_checked(self):
        for patch in [{"imdbID": "tt0000002"}, {"Type": "episode"}, {"Title": "Different film"},
                      {"Year": "1990"}, {"Year": "N/A"}]:
            with self.subTest(patch=patch):
                self.code("EXTERNAL_MAPPING_MISMATCH",
                          lambda: self.provider(payload={**self.payload, **patch}).rating(self.catalog, self.title_id))

    def test_series_accepts_year_range_but_not_movie_scope(self):
        self.catalog.by_id[self.title_id].kind = "SERIES"
        result = self.provider(payload={**self.payload, "Type": "series", "Year": "2010–2015"}).rating(self.catalog, self.title_id)
        self.assertEqual(result["media_type"], "series")

    def test_missing_and_na_scores_are_null(self):
        for patch in [{"imdbRating": "N/A", "Metascore": "N/A", "imdbVotes": "N/A"},
                      {"imdbRating": None, "Metascore": None, "imdbVotes": None}]:
            with self.subTest(patch=patch):
                result = self.provider(payload={**self.payload, **patch}).rating(self.catalog, self.title_id)
                self.assertTrue(all(r["value"] is None for r in result["ratings"]))

    def test_invalid_numeric_formats_and_ranges_rejected(self):
        for patch in [{"imdbRating": "NaN"}, {"imdbRating": "11"}, {"imdbRating": True},
                      {"Metascore": "101"}, {"Metascore": "67.5"}, {"imdbVotes": "1,23"},
                      {"imdbVotes": "-1"}, {"imdbVotes": "9999999999999"}]:
            with self.subTest(patch=patch):
                self.code("SOURCE_SCHEMA_INVALID",
                          lambda: self.provider(payload={**self.payload, **patch}).rating(self.catalog, self.title_id))

    def test_zero_votes_does_not_publish_an_imdb_score(self):
        result = self.provider(payload={**self.payload, "imdbVotes": "0"}).rating(self.catalog, self.title_id)
        self.assertIsNone(result["ratings"][0]["value"])

    def test_http_errors_redirect_and_false_responses(self):
        for status, payload, expected in [
            (401, {}, "SOURCE_AUTH_REQUIRED"), (403, {}, "SOURCE_AUTH_REQUIRED"),
            (429, {}, "SOURCE_RATE_LIMITED"), (302, {}, "SOURCE_UNAVAILABLE"),
            (500, {}, "SOURCE_UNAVAILABLE"),
            (200, {"Response": "False", "Error": "Invalid API key " + KEY}, "SOURCE_AUTH_REQUIRED"),
            (200, {"Response": "False", "Error": "Request limit reached!"}, "SOURCE_RATE_LIMITED"),
            (200, {"Response": "False", "Error": "Movie not found!"}, "SOURCE_NOT_FOUND"),
        ]:
            with self.subTest(status=status, expected=expected):
                self.code(expected, lambda: self.provider(status, payload).rating(self.catalog, self.title_id))

    def test_malformed_json_schema_and_oversize_are_rejected(self):
        for content, expected in [
            (b"not json", "SOURCE_SCHEMA_INVALID"),
            (b"[]", "SOURCE_SCHEMA_INVALID"),
            (b"{}", "SOURCE_SCHEMA_INVALID"),
            (b"x" * 256001, "SOURCE_RESPONSE_TOO_LARGE"),
        ]:
            with self.subTest(expected=expected):
                provider = Omdb(api_key=KEY, mappings=self.mapping, clock=lambda: self.clock,
                                transport=httpx.MockTransport(lambda r: httpx.Response(200, content=content)))
                self.code(expected, lambda: provider.rating(self.catalog, self.title_id))

    def test_per_run_and_session_request_budgets(self):
        provider = self.provider(session_request_limit=3)
        for _ in range(2):
            provider._get({"i": "tt0000001"})
        self.code("SOURCE_BUDGET_EXCEEDED", lambda: provider._get({"i": "tt0000001"}))
        provider.reset()
        provider._get({"i": "tt0000001"})
        provider.reset()
        self.code("OMDB_SESSION_QUOTA_EXCEEDED", lambda: provider._get({"i": "tt0000001"}))
        self.assertEqual(len(self.requests), 3)

    def test_cache_survives_reset_expires_and_cannot_be_mutated(self):
        provider = self.provider(cache_ttl_seconds=60)
        first = provider.rating(self.catalog, self.title_id)
        first["ratings"][0]["value"] = 0
        provider.reset()
        hit = provider.rating(self.catalog, self.title_id)
        self.assertTrue(hit["cache_hit"])
        self.assertEqual(hit["ratings"][0]["value"], 7.5)
        self.assertEqual(len(self.requests), 1)
        self.clock += timedelta(seconds=60)
        self.assertFalse(provider.rating(self.catalog, self.title_id)["cache_hit"])
        self.assertEqual(len(self.requests), 2)

    def test_cache_rechecks_mapping_and_snapshot_expiry(self):
        provider = self.provider()
        provider.rating(self.catalog, self.title_id)
        provider.mappings[self.title_id]["verified"] = False
        self.code("EXTERNAL_MAPPING_NOT_VERIFIED", lambda: provider.rating(self.catalog, self.title_id))
        provider.mappings[self.title_id]["verified"] = True
        self.clock += timedelta(hours=25)
        self.code("SNAPSHOT_EXPIRED", lambda: provider.rating(self.catalog, self.title_id))
        self.assertEqual(len(self.requests), 1)

    def test_search_returns_bounded_candidates_without_auto_mapping_or_raw_fields(self):
        provider = self.provider(payload={"Response": "True", "Search": [
            {"imdbID": "tt0000001", "Title": "Fixture Film", "Year": "2010", "Type": "movie", "Poster": "not-exported"},
            {"imdbID": "https://unsafe.invalid", "Title": "bad", "Type": "movie"},
            {"imdbID": "tt0000002", "Title": "wrong scope", "Type": "episode"},
        ]})
        provider.mappings = {}
        results = provider.search(self.catalog, self.title_id)
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0]["mapping_verified"])
        self.assertNotIn("Poster", results[0])
        self.code("EXTERNAL_MAPPING_NOT_VERIFIED", lambda: provider.rating(self.catalog, self.title_id))
        self.assertEqual(len(self.requests), 1)

    def test_normal_httpx_logging_redacts_query_api_key(self):
        provider = self.provider()
        with self.assertLogs("httpx", level=logging.INFO) as logs:
            provider.rating(self.catalog, self.title_id)
        self.assertTrue(logs.output)
        self.assertNotIn(KEY, "\n".join(logs.output))
        self.assertIn("[REDACTED]", "\n".join(logs.output))

    def test_transport_exception_never_exposes_request_url(self):
        provider = Omdb(api_key=KEY, mappings=self.mapping,
                        transport=httpx.MockTransport(lambda r: (_ for _ in ()).throw(RuntimeError(str(r.url)))))
        self.code("SOURCE_UNAVAILABLE", lambda: provider.rating(self.catalog, self.title_id))

    def test_config_limits(self):
        for options in [{"cache_ttl_seconds": 0}, {"cache_ttl_seconds": 86401}, {"session_request_limit": 1001}]:
            self.code("OMDB_CONFIG_INVALID", lambda: Omdb(**options))

    def test_agent_omdb_tools_and_final_provenance(self):
        title_id, provider = self.title_id, self.provider()
        class Retrieval:
            def search(inner, **kwargs):
                return [self.catalog.by_id[title_id]]
        class Model:
            def __init__(inner):
                inner.turn = 0
                inner.allowed = []
            def bind_tools(inner, tools):
                inner.allowed = [t.name for t in tools]
                return inner
            def invoke(inner, messages):
                inner.turn += 1
                if inner.turn == 1:
                    name, args = "search_catalog", {"query": "Phim thử"}
                elif inner.turn == 2:
                    name, args = "get_imdb_metacritic_ratings", {"title_id": title_id}
                else:
                    facts = json.loads(next(m.content for m in reversed(messages) if isinstance(m, ToolMessage)))["data"]
                    name, args = "finish_answer", {"status": "FOUND", "picks": [
                        {"title_id": title_id, "evidence_ids": [f["id"] for f in facts]}]}
                return AIMessage(content="", tool_calls=[{"id": str(inner.turn), "name": name, "args": args}])
        model = Model()
        result = MovieAgent(self.catalog, Retrieval(), model, omdb=provider).ask("Điểm IMDb và Metascore?", mode="HYBRID")
        self.assertIn("get_imdb_metacritic_ratings", model.allowed)
        self.assertNotIn("get_external_ratings", model.allowed)
        fields = result["cards"][0]["external_ratings"]
        self.assertEqual([f["source"]["provider"] for f in fields], ["OMDB", "OMDB"])
        self.assertEqual([f["value"]["scale_max"] for f in fields], [10, 100])
        self.assertNotIn(KEY, json.dumps(result))
        self.assertEqual(len(self.requests), 1)

    def test_catalog_mode_never_exposes_omdb_tools(self):
        class Model:
            def bind_tools(inner, tools):
                self.assertNotIn("get_imdb_metacritic_ratings", [t.name for t in tools])
                self.assertNotIn("search_omdb_metadata", [t.name for t in tools])
                return inner
            def invoke(inner, messages):
                return AIMessage(content="", tool_calls=[{"id": "end", "name": "finish_answer", "args": {"status": "EMPTY", "picks": []}}])
        MovieAgent(self.catalog, None, Model(), omdb=self.provider()).ask("Tìm phim", mode="CATALOG")
        self.assertEqual(self.requests, [])
