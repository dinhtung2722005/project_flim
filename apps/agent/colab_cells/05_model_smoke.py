import time
from pydantic import BaseModel, ConfigDict
from langchain_core.tools import StructuredTool
from pjflim_agent.runtime import make_model
llm = make_model(context_tokens=CONTEXT_TOKENS)
started = time.monotonic()
hello = llm.invoke("Trả lời tiếng Việt một câu ngắn: Bạn là trợ lý tìm phim.")
if not isinstance(hello.content, str) or not hello.content.strip():
    raise RuntimeError("MODEL_SMOKE_EMPTY")
print("Smoke tiếng Việt:", hello.content[:200])

class SmokeArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    title_id: str

smoke_tool = StructuredTool.from_function(
    func=lambda title_id: {"title_id": title_id},
    name="lookup_demo_title", description="Tra cứu phim demo bằng title_id.", args_schema=SmokeArgs)
probe = llm.bind_tools([smoke_tool]).invoke(
    "Hãy gọi lookup_demo_title với title_id chính xác là demo-sao-hoa. Không trả văn bản.")
if len(probe.tool_calls) != 1 or probe.tool_calls[0]["name"] != "lookup_demo_title" or probe.tool_calls[0]["args"] != {"title_id": "demo-sao-hoa"}:
    raise RuntimeError("MODEL_TOOL_SMOKE_FAILED: chưa thể coi model đã gọi tool đúng.")

class SmokeJson(BaseModel):
    ok: bool

typed = llm.with_structured_output(SmokeJson, method="json_schema").invoke("Trả JSON với ok=true.")
if not isinstance(typed, SmokeJson) or typed.ok is not True:
    raise RuntimeError("MODEL_JSON_SMOKE_FAILED")
MODEL_SMOKE = {"nonempty_text": True, "language_needs_human_review": True, "tool_call": True, "json_schema": True,
               "duration_seconds": round(time.monotonic()-started, 2)}
display(MODEL_SMOKE)
