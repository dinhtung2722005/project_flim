# Only stdlib code is imported into the Colab kernel; all ML packages live in a venv.
from pjflim_agent.colab_bridge import prepare_environment, NotebookSession
if globals().get("CHAT_PANEL") is not None:
    CHAT_PANEL.close()
    CHAT_PANEL = None
if "session" in globals():
    session.close()
print("Đang chuẩn bị môi trường riêng. Lần đầu có thể mất vài phút; không thay NumPy của Colab.")
environment = prepare_environment(WORKSPACE, SOURCE)
versions = environment["versions"]
display(environment)

def show_agent_output(event):
    if event["kind"] == "text":
        print(event["value"], end="")
    else:
        display(event["value"])

session = NotebookSession(environment["python"], SOURCE, WORKSPACE, output=show_agent_output)
session.execute("pass", {
    "USE_DEMO": USE_DEMO, "REQUIRE_GPU": REQUIRE_GPU, "CONTEXT_TOKENS": CONTEXT_TOKENS,
    "ENABLE_OMDB": ENABLE_OMDB, "ENABLE_TMDB": ENABLE_TMDB, "ENABLE_WEB_DISCOVERY": ENABLE_WEB_DISCOVERY,
    "OMDB_MAPPINGS": OMDB_MAPPINGS, "TMDB_MAPPINGS": TMDB_MAPPINGS,
    "MODEL_CONFIG": MODEL_CONFIG, "HARDWARE": HARDWARE, "versions": versions,
})
print("Môi trường riêng đã sẵn sàng. Tiếp tục cell 4; không cần restart vì NumPy.")
