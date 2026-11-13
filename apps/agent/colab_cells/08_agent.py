from pjflim_agent.agent import MovieAgent
from pjflim_agent.providers import Tmdb, ReviewDiscovery
from pjflim_agent.omdb import Omdb
from pjflim_agent.catalog import AgentError
from IPython.display import JSON

# Key chỉ đọc từ Secrets, không viết trực tiếp trong notebook hoặc output.
omdb_key, tmdb_token = "", ""
if (ENABLE_OMDB or ENABLE_TMDB) and not catalog.snapshot.demo:
    from google.colab import userdata
    if ENABLE_OMDB:
        try:
            omdb_key = userdata.get("OMDB_API_KEY") or ""
        except Exception:
            print("OMDB_NOT_CONFIGURED: thêm OMDB_API_KEY vào Colab Secrets, cấp quyền notebook.")
    if ENABLE_TMDB:
        try:
            tmdb_token = userdata.get("TMDB_API_READ_TOKEN") or ""
        except Exception:
            print("TMDB_NOT_CONFIGURED: thêm token vào Colab Secrets rồi cấp quyền notebook.")

# Giữ client OMDb qua các lần chạy cell8 để cache/quota không reset mỗi câu hỏi.
if "_omdb_client" not in globals() or not _omdb_client.matches_key(omdb_key):
    _omdb_client = Omdb(api_key=omdb_key, mappings=OMDB_MAPPINGS)
else:
    _omdb_client.mappings = OMDB_MAPPINGS
del omdb_key

tmdb = Tmdb(token=tmdb_token, mappings=TMDB_MAPPINGS)
discovery = ReviewDiscovery(enabled=ENABLE_WEB_DISCOVERY)
agent = MovieAgent(catalog, search, llm, tmdb=tmdb, discovery=discovery, omdb=_omdb_client)

# Demo: CATALOG, không gọi OMDb. Catalog thật: HYBRID để hỏi điểm.
QUESTION = "Tìm phim khoa học viễn tưởng nhẹ nhàng, tránh spoiler."
MODE = "CATALOG" if catalog.snapshot.demo else "HYBRID"
try:
    result = agent.ask(QUESTION, mode=MODE)
    display(JSON(result))
except AgentError as error:
    raise RuntimeError(error.code) from None

# Nếu chưa có IMDb ID: gọi _omdb_client.reset(); display(_omdb_client.search(catalog, TITLE_UUID))
# Đối chiếu candidate bằng tên/năm/loại, thêm vào OMDB_MAPPINGS ở cell1, chạy lại cell1 và cell8.
