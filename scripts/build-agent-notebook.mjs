import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "apps/agent/";
const sourceFiles = [
  "requirements-test.txt",
  "requirements-colab.txt",
  "model-versions.json",
];
for (const folder of ["pjflim_agent", "tests", "colab_cells"])
  for (const file of (await readdir(root + folder)).sort()) {
    if (file.endsWith(".py") && !file.startsWith("run_isolated"))
      sourceFiles.push(folder + "/" + file);
  }
const files = {};
for (const file of sourceFiles)
  files[file] = await readFile(root + file, "utf8");
const raw = JSON.stringify(files),
  bundle = Buffer.from(raw).toString("base64"),
  sha = createHash("sha256").update(raw).digest("hex");
const bootstrap = `# 1. Cấu hình + bộ source đi kèm: không cần clone/push GitHub.
USE_DEMO = True
REQUIRE_GPU = True
SHOW_CHAT_PANEL = True  # Ô nhập và nút hỏi ở cell 8; không cài thêm package vào kernel.
CONTEXT_TOKENS = 8192  # Nếu OOM: thử 4096, đo lại smoke và chất lượng.
ENABLE_OMDB = True  # Đọc OMDB_API_KEY từ Colab Secrets khi dùng catalog thật.
OMDB_MAPPINGS = {}  # UUID: {"imdb_id":"tt1375666","verified":True}; chỉ sau đối chiếu đúng tên/năm/loại.
ENABLE_TMDB = False
ENABLE_WEB_DISCOVERY = False  # Chỉ tìm URL; không đọc/copy bài review.
TMDB_MAPPINGS = {}  # UUID: {"kind":"movie" hoặc "tv","id":123,"verified":True}; chỉ sau khi đối chiếu đúng phim.

import base64, hashlib, json, platform, sys
from pathlib import Path
if platform.system() != "Linux" or not Path("/content").is_dir():
    raise RuntimeError("Mở notebook trong Google Colab Linux; notebook không cài Ollama trên PC.")
if sys.version_info < (3, 11):
    raise RuntimeError("Python 3.11+ required")
WORKSPACE = Path("/content/pj-flim-agent")
SOURCE = WORKSPACE / "source"
SOURCE.mkdir(parents=True, exist_ok=True)
encoded = "${bundle}"
payload = base64.b64decode(encoded)
if hashlib.sha256(payload).hexdigest() != "${sha}":
    raise RuntimeError("BUNDLE_HASH_INVALID")
sources = json.loads(payload)
for relative_name, content in sources.items():
    target = (SOURCE / relative_name).resolve()
    if not target.is_relative_to(SOURCE.resolve()):
        raise RuntimeError("BUNDLE_PATH_INVALID")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))
MODEL_CONFIG = json.loads((SOURCE / "model-versions.json").read_text())
print("Source bundle verified. Demo:", USE_DEMO, "OMDb:", ENABLE_OMDB, "TMDB:", ENABLE_TMDB, "Web:", ENABLE_WEB_DISCOVERY)
`;
const explanations = [
  [
    "1. Chọn dữ liệu và nguồn",
    "Mặc định dùng 4 phim giả do dự án tạo. Đổi USE_DEMO=False để nạp snapshot public của pj-Flim đã được phép xử lý cloud/embedding. Không đưa credential, lịch sử xem hoặc signed URL vào notebook. Source đi kèm có checksum; không cần GitHub đã cập nhật.",
  ],
  [
    "2. Kiểm runtime",
    "Chọn Runtime → Change runtime type → GPU rồi chạy. Tài nguyên Colab không bảo đảm. Bản 7B cần đo VRAM/context thực, không coi file 4,7 GB là toàn bộ bộ nhớ.",
  ],
  [
    "3. Cài dependency",
    "Cài trong venv riêng, không thay thư viện của kernel Colab. Agent chạy trong subprocess giữ trạng thái qua pipe, không mở cổng. E5 dùng Torch CPU; Qwen dùng GPU qua Ollama. Không cần restart vì NumPy của kernel khác phiên bản. Không có telemetry/tracing ứng dụng chủ động bật; tắt LangSmith tracing.",
  ],
  [
    "4. Ollama + Qwen",
    "Cell này cài Ollama phiên bản đã chọn và tải Qwen2.5:7b nhiều GB vào runtime Google. Chỉ bind 127.0.0.1:11434, không tunnel hoặc public model. Chỉ tái sử dụng/dừng process notebook sở hữu. Runtime được reset có thể cần tải lại.",
  ],
  [
    "5. Smoke model thật",
    "Kiểm tiếng Việt, tool calling, JSON schema và digest/GPU offload của model sau inference bằng /api/ps; nếu lỗi hãy dừng tại đây. Nhãn kiểm thử trong tài liệu repo chưa thay bằng chứng Colab. Không lưu chain-of-thought.",
  ],
  [
    "6. Nạp catalog",
    "Demo mặc định không phải catalog thật. Với dữ liệu pj-Flim, chạy npm.cmd run agent:export-catalog trên PC khi API local đang chạy rồi chọn file .local/agent/catalog.snapshot.json. Snapshot hạn 24 giờ, có hash/schema và giới hạn 1.000 title. Đây là dữ liệu đủ điều kiện ở thời điểm xuất, không kiểm live.",
  ],
  [
    "7. E5 + FAISS CPU",
    "Pin embedding revision, dùng query:/passage:, normalize và exact inner product trên candidate đã lọc. Hợp keyword + semantic bằng RRF. Checkpoint lưu vectors.npy allow_pickle=False, kiểm hash/shape/version rồi dựng index; không load pickle hoặc FAISS binary từ nguồn tùy ý.",
  ],
  [
    "8. Hỏi agent",
    "Dùng ô nhập/nút Hỏi agent ở cuối cell8 hoặc đổi QUESTION rồi chạy lại cell8 nếu runtime không có ipywidgets. Mỗi câu hỏi độc lập; không ghi hội thoại vào checkpoint. Kết quả dễ đọc bằng tiếng Việt; mỗi câu hỏi là một lượt độc lập. CATALOG không gọi nguồn ngoài. HYBRID ưu tiên OMDb: thêm OMDB_API_KEY vào Colab Secrets và xác minh OMDB_MAPPINGS để lấy IMDb rating/Metascore. Tìm candidate bằng search_omdb_metadata; không tự duyệt mapping. TMDB vẫn tùy chọn với ENABLE_TMDB=True/TMDB_API_READ_TOKEN. ENABLE_WEB_DISCOVERY chỉ tìm URL theo tên phim; không đọc snippet/toàn văn. Có adapter OMDb lookup theo mapping; chưa bulk importer, Metacritic User Score, RT hoặc review summary. Demo chặn lookup ngoài.",
  ],
  [
    "9. Nghiệm thu",
    "Chạy contract tests bằng FAISS và ChatOllama thật với HTTP/model fixtures; RUN_AGENT_EVALUATION=True thử thêm3câu demo bằng model/encoder hiện tại (có thể mất vài phút). Kết quả NEEDS_REVIEW không được ghi thành chất lượng đã đạt. Báo cáo chỉ lưu IDs/metrics/mã lỗi, không câu hỏi/hội thoại. Các nhóm live OMDb/TMDB/web chưa được đánh dấu đạt tự động. Dữ liệu nguồn chỉ là data; tool allowlist, schema, evidence registry và budget kiểm ngoài model.",
  ],
  [
    "10. Checkpoint và kết thúc",
    "Tải checkpoint về PC hoặc tự lưu nơi được phép. Không có prompt/API key/model weights trong checkpoint; source metadata vẫn cần quyền lưu. Sau reset: bootstrap, nạp snapshot/checkpoint chưa hết hạn, kiểm lại model/index. Đặt STOP_OLLAMA=True để dừng đúng process notebook tạo. Không dùng notebook free làm API/RabbitMQ worker 24/7.",
  ],
];
const md = (id, s) => ({
  cell_type: "markdown",
  id,
  metadata: {},
  source: s.split(/(?<=\n)/),
});
const code = (id, s) => ({
  cell_type: "code",
  id,
  metadata: {},
  execution_count: null,
  outputs: [],
  source: s.split(/(?<=\n)/),
});
const cells = [
  md(
    "intro",
    "# pj-Flim movie agent — Colab agent v0.4\n\nQwen2.5:7b/Ollama + LangChain + multilingual E5/FAISS. Chạy từ trên xuống trong notebook. Đây là agent tìm phim và dẫn nguồn có giới hạn, website đã có tra cứu catalog/FAQ; notebook này thử Qwen độc lập, chưa huấn luyện model.\n\nNotebook độc lập, không cần push GitHub. GPU/model trên Colab chưa được người tạo notebook chạy nghiệm thu thay bạn. Chọn dữ liệu/nguồn ở cell 1 trước khi Run all.\n\nNguồn: [Colab FAQ](https://research.google.com/colaboratory/faq.html), [Ollama Linux](https://docs.ollama.com/linux), [ChatOllama](https://docs.langchain.com/oss/python/integrations/chat/ollama), [E5](https://huggingface.co/intfloat/multilingual-e5-small).\n",
  ),
];
for (let i = 1; i <= 10; i++) {
  const [title, body] = explanations[i - 1];
  cells.push(md("guide-" + i, "## " + title + "\n\n" + body + "\n"));
  const file =
    i === 1
      ? null
      : (await readdir(root + "colab_cells")).find((f) =>
          f.startsWith(String(i).padStart(2, "0") + "_"),
        );
  let content = i === 1 ? bootstrap : await readFile(root + "colab_cells/" + file, "utf8");
  if ([4, 5, 7, 9].includes(i)) content = "session.execute(" + JSON.stringify(content) + ")\n";
  if (i === 6) content = [
    'INPUT_NAME = ""',
    'if not USE_DEMO:',
    '    from google.colab import files',
    '    uploaded = files.upload()',
    '    if len(uploaded) != 1:',
    '        raise RuntimeError("SELECT_ONE_SNAPSHOT_OR_CHECKPOINT")',
    '    INPUT_NAME, input_content = next(iter(uploaded.items()))',
    '    if len(input_content) > 8_000_000:',
    '        raise RuntimeError("UPLOAD_TOO_LARGE")',
    '    (WORKSPACE / "input-upload").write_bytes(input_content)',
    '    del input_content, uploaded',
    'session.execute(' + JSON.stringify(content) + ', {"INPUT_NAME": INPUT_NAME, "USE_DEMO": USE_DEMO})',
  ].join("\n") + "\n";
  if (i === 8) content = [
    '# Nhập câu hỏi bên dưới hoặc dùng ô chat; mỗi câu hỏi độc lập.',
    'QUESTION = "Tìm phim khoa học viễn tưởng nhẹ nhàng, tránh spoiler."',
    'MODE = "CATALOG" if USE_DEMO else "HYBRID"',
    'def ask_notebook(question, mode="CATALOG", quiet=True):',
    '    secrets = {}',
    '    if not USE_DEMO and (ENABLE_OMDB or ENABLE_TMDB):',
    '        from google.colab import userdata',
    '        for enabled, key in [(ENABLE_OMDB, "OMDB_API_KEY"), (ENABLE_TMDB, "TMDB_API_READ_TOKEN")]:',
    '            if enabled:',
    '                try:',
    '                    secrets[key] = userdata.get(key) or ""',
    '                except Exception:',
    '                    if not quiet: print(key + "_NOT_CONFIGURED: thêm key vào Colab Secrets, cấp quyền notebook.")',
    '    previous_output = session.output',
    '    try:',
    '        if quiet: session.output = lambda event: None',
    '        return session.execute(' + JSON.stringify(content) + ', {"QUESTION": question, "MODE": mode, "NOTEBOOK_SECRETS": secrets,',
    '            "OMDB_MAPPINGS": OMDB_MAPPINGS, "TMDB_MAPPINGS": TMDB_MAPPINGS, "ENABLE_WEB_DISCOVERY": ENABLE_WEB_DISCOVERY})',
    '    finally:',
    '        session.output = previous_output',
    '        secrets.clear()',
    'if "CHAT_PANEL" in globals() and CHAT_PANEL is not None:',
    '    CHAT_PANEL.close()',
    'CHAT_PANEL = None',
    '# Không giữ thành công cũ nếu lượt hỏi lại thất bại.',
    'globals().pop("result", None)',
    'result = ask_notebook(QUESTION, MODE, quiet=False)',
    'if SHOW_CHAT_PANEL:',
    '    from pjflim_agent.notebook_ui import build_chat_panel',
    '    CHAT_PANEL = build_chat_panel(ask_notebook, MODE)',
    '    if CHAT_PANEL is not None:',
    '        display(CHAT_PANEL)',
    '    else:',
    '        print("Runtime chưa có ipywidgets. Sửa QUESTION rồi chạy lại cell8 để hỏi tiếp.")',
  ].join("\n") + "\n";
  if (i === 9) content = [
    'RUN_AGENT_EVALUATION = True  # 3 câu demo qua model hiện tại; False để chỉ chạy contract tests.',
    'session.execute(' + JSON.stringify(await readFile(root + "colab_cells/" + file, "utf8")) + ', {"RUN_AGENT_EVALUATION": RUN_AGENT_EVALUATION})',
  ].join("\n") + "\n";
  if (i === 10) content = [
    'DOWNLOAD_CHECKPOINT = False',
    'DOWNLOAD_REPORT = False',
    'STOP_OLLAMA = False',
    'session.execute(' + JSON.stringify(content) + ', {"STOP_OLLAMA": STOP_OLLAMA})',
    'if DOWNLOAD_CHECKPOINT:',
    '    from google.colab import files',
    '    files.download(str(WORKSPACE / "pj-flim-agent-checkpoint.zip"))',
    'if DOWNLOAD_REPORT:',
    '    from google.colab import files',
    '    files.download(str(WORKSPACE / "runtime-report.json"))',
    'if STOP_OLLAMA:',
    '    session.close()',
    '    if globals().get("CHAT_PANEL") is not None: CHAT_PANEL.close()',
  ].join("\n") + "\n";
  cells.push(code("step-" + i, content));
}
const notebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: {
      display_name: "Python 3",
      language: "python",
      name: "python3",
    },
    language_info: { name: "python" },
    colab: { provenance: [] },
    pj_flim: {
      version: "0.4.0",
      bundle_sha256: sha,
      model: "qwen2.5:7b",
      requires_runtime_validation: true,
    },
  },
  cells,
};
await mkdir("notebooks", { recursive: true });
await writeFile(
  "notebooks/movie-agent-colab.ipynb",
  JSON.stringify(notebook, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    event: "agent.notebook.built",
    codeCells: 10,
    bundleFiles: sourceFiles.length,
    bundleSha256: sha,
  }),
);
