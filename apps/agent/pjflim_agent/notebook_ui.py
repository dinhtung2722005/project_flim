"""Optional Colab widgets; stdlib-only import keeps the kernel independent of ML packages."""
from __future__ import annotations

from html import escape
import re

HINTS = {
    "AGENT_PROCESS_STOPPED": "Chạy lại cell 3 rồi cell 4–8 để kết nối lại.",
    "AGENT_PROCESS_INTERRUPTED": "Đã dừng xử lý. Chạy lại cell 3 rồi cell 4–8.",
    "MODEL_UNAVAILABLE": "Kiểm tra Ollama, bộ nhớ GPU; thử CONTEXT_TOKENS=4096 rồi chạy lại smoke.",
    "MODEL_GPU_NOT_USED": "Qwen chưa dùng GPU. Kiểm tra runtime GPU và khởi động lại từ cell 4.",
    "SNAPSHOT_EXPIRED": "Xuất snapshot mới từ website rồi nạp lại ở cell 6.",
    "AGENT_DEADLINE_EXCEEDED": "Câu hỏi hết thời gian. Thử câu hỏi ngắn hơn.",
    "AGENT_INPUT_INVALID": "Nhập câu hỏi từ 2 đến 1.000 ký tự.",
}


def safe_error(error):
    match = re.match(r"^([A-Z][A-Z0-9_]{2,80})(?::|$| \()", str(error))
    candidate = match.group(1) if match else ""
    allowed = set(HINTS) | {"AGENT_BUSY", "MODEL_TOOL_OUTPUT_INVALID", "AGENT_MODEL_BUDGET_EXCEEDED",
                            "AGENT_TOOL_BUDGET_EXCEEDED", "ANSWER_EVIDENCE_INVALID", "MODEL_UNAVAILABLE"}
    code = candidate if candidate in allowed else "AGENT_REQUEST_FAILED"
    return code + ": " + HINTS.get(code, "Chạy lại câu hỏi hoặc xem hướng dẫn lỗi trong README agent.")


def answer_html(result):
    """Render plain facts; never execute model HTML or make source links clickable."""
    e = lambda value: escape(str(value), quote=True)
    parts = ["<p><strong>Trợ lý pj-Flim</strong></p>", "<p>" + e(result.get("answer", "")) + "</p>"]
    if result.get("demo"):
        parts.append("<p><em>Dữ liệu demo: phim giả, không có video hoặc điểm thật.</em></p>")
    for card in result.get("cards", []):
        parts.append("<hr><p><strong>" + e(card.get("name", "")) + "</strong> · " + e(card.get("year") or "Chưa có năm") + "</p>")
        parts.append("<p>" + e(" · ".join(card.get("genres", []))) + "</p>")
        if card.get("synopsis"):
            parts.append("<p>" + e(card["synopsis"]) + "</p>")
        for fact in card.get("external_ratings", []):
            value = fact.get("value", {})
            if not isinstance(value, dict):
                continue
            label = {"imdb_rating": "IMDb", "metacritic_metascore": "Metacritic Metascore",
                     "tmdb_rating": "TMDB"}.get(fact.get("field"), "Điểm nguồn ngoài")
            score = value.get("value")
            scale = value.get("scale_max")
            parts.append("<p>" + e(label) + ": " + e("Chưa có điểm" if score is None else score)
                         + ("/" + e(scale) if scale is not None else "")
                         + " · nguồn " + e(fact.get("source", {}).get("provider", "")) + "</p>")
        sources = sorted({f.get("source", {}).get("provider", "") for f in card.get("evidence", [])})
        parts.append("<p><small>Nguồn: " + e(", ".join(sources)) + "</small></p>")
        for ref in card.get("review_refs", []):
            parts.append("<p><small>Link tham khảo (chưa đọc bài): " + e(ref.get("url", "")) + "</small></p>")
    if result.get("warnings"):
        parts.append("<p><small>Lưu ý: " + e(", ".join(result["warnings"])) + "</small></p>")
    parts.append("<p><small>Chưa kiểm tra khả năng phát hiện tại trên website. Mỗi câu hỏi là một lượt độc lập.</small></p>")
    return "".join(parts)


class NotebookChat:
    def __init__(self, ask, max_turns=10):
        self.ask = ask
        self.max_turns = max_turns
        self.turns = []
        self.busy = False

    def submit(self, question, mode="CATALOG"):
        if self.busy:
            raise RuntimeError("AGENT_BUSY")
        if not isinstance(question, str) or not 2 <= len(question.strip()) <= 1000 or mode not in ("CATALOG", "HYBRID"):
            raise RuntimeError("AGENT_INPUT_INVALID")
        self.busy = True
        try:
            result = self.ask(question.strip(), mode)
            self.turns.append({"question": question.strip(), "result": result})
            self.turns = self.turns[-self.max_turns:]
            return result
        finally:
            self.busy = False

    def clear(self):
        if not self.busy:
            self.turns.clear()


def build_chat_panel(ask, mode="CATALOG"):
    """Return None if widgets are absent; QUESTION + rerun remains supported."""
    try:
        import ipywidgets as widgets
        from IPython.display import HTML, display
    except ImportError:
        return None
    chat = NotebookChat(ask)
    question = widgets.Textarea(placeholder="Nhập tên phim hoặc yêu cầu tìm phim…",
                               layout=widgets.Layout(width="100%", height="80px"))
    modes = widgets.Dropdown(options=["CATALOG", "HYBRID"], value=mode, description="Nguồn:")
    send = widgets.Button(description="Hỏi agent", button_style="primary")
    clear = widgets.Button(description="Xóa hiển thị")
    status = widgets.Label(value="Sẵn sàng. Mỗi câu hỏi độc lập; không gửi mật khẩu/API key.")
    output = widgets.Output(layout=widgets.Layout(max_height="500px", overflow="auto"))
    closed = False

    def redraw():
        output.clear_output(wait=True)
        with output:
            for turn in chat.turns:
                display(HTML("<p><strong>Bạn:</strong> " + escape(turn["question"]) + "</p>"))
                display(HTML(answer_html(turn["result"])))

    def submit(_):
        if closed or chat.busy:
            return
        send.disabled = clear.disabled = question.disabled = modes.disabled = True
        status.value = "Đang tìm dữ liệu và kiểm tra nguồn…"
        try:
            chat.submit(question.value, modes.value)
            question.value = ""
            redraw()
            status.value = "Đã trả lời. Có thể nhập câu hỏi tiếp theo."
        except Exception as error:
            status.value = safe_error(error)
        finally:
            send.disabled = clear.disabled = question.disabled = modes.disabled = False

    def reset(_):
        chat.clear()
        output.clear_output()
        status.value = "Đã xóa lịch sử hiển thị trong ô chat."

    send.on_click(submit)
    clear.on_click(reset)
    panel = widgets.VBox([question, widgets.HBox([modes, send, clear]), status, output])
    # Close the old callback when re-running cell 8, so it cannot use a stale session.
    original_close = panel.close
    def close():
        nonlocal closed
        closed = True
        send.on_click(submit, remove=True)
        clear.on_click(reset, remove=True)
        for item in (question, modes, send, clear, status, output):
            item.close()
        original_close()
    panel.close = close
    return panel
