globals().pop("result", None)
from pjflim_agent.agent import MovieAgent
from pjflim_agent.providers import Tmdb, ReviewDiscovery
from pjflim_agent.omdb import Omdb
from pjflim_agent.catalog import AgentError

omdb_key = NOTEBOOK_SECRETS.pop("OMDB_API_KEY", "")
tmdb_token = NOTEBOOK_SECRETS.pop("TMDB_API_READ_TOKEN", "")
if "_omdb_client" not in globals() or not _omdb_client.matches_key(omdb_key):
    _omdb_client = Omdb(api_key=omdb_key, mappings=OMDB_MAPPINGS)
else:
    _omdb_client.mappings = OMDB_MAPPINGS
tmdb = Tmdb(token=tmdb_token, mappings=TMDB_MAPPINGS)
del omdb_key, tmdb_token
discovery = ReviewDiscovery(enabled=ENABLE_WEB_DISCOVERY)
agent = MovieAgent(catalog, search, llm, tmdb=tmdb, discovery=discovery, omdb=_omdb_client)
try:
    result = agent.ask(QUESTION, mode=MODE)
    display(result["answer"])
    for card in result["cards"]:
        display({"phim": card["name"], "nam": card["year"], "the_loai": card["genres"],
                 "nguon": sorted({e["source"]["provider"] for e in card["evidence"]}),
                 "diem_ngoai": card["external_ratings"]})
        display({"lien_ket_review": card.get("review_refs", []), "da_doc_bai": False})
    display({"status": result["status"], "demo": result["demo"], "warnings": result["warnings"],
             "tool_calls": result["tool_calls"], "live_checked": False})
except AgentError as error:
    globals().pop("result", None)
    raise RuntimeError(error.code) from None


__reply__ = result
