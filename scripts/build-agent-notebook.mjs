import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "apps/agent/";
const sourceFiles = [
  "requirements-test.txt",
  "requirements-colab.txt",
  "model-versions.json",
];
for (const folder of ["pjflim_agent", "tests"])
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
    "Cài các phiên bản trực tiếp đã pin, không nâng toàn bộ môi trường. Khi có yêu cầu restart kernel, restart session rồi chạy lại. Không có telemetry/tracing ứng dụng chủ động bật; tắt LangSmith tracing.",
  ],
  [
    "4. Ollama + Qwen",
    "Cell này cài Ollama phiên bản đã chọn và tải Qwen2.5:7b nhiều GB vào runtime Google. Chỉ bind 127.0.0.1:11434, không tunnel hoặc public model. Chỉ tái sử dụng/dừng process notebook sở hữu. Runtime được reset có thể cần tải lại.",
  ],
  [
    "5. Smoke model thật",
    "Kiểm tiếng Việt, tool calling và JSON schema bằng model thực; nếu lỗi hãy dừng tại đây. Nhãn kiểm thử trong tài liệu repo chưa thay bằng chứng Colab. Không lưu chain-of-thought.",
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
    "Đổi QUESTION và chạy lại cell. CATALOG không gọi nguồn ngoài. HYBRID ưu tiên OMDb: thêm OMDB_API_KEY vào Colab Secrets và xác minh OMDB_MAPPINGS để lấy IMDb rating/Metascore. Tìm candidate bằng search_omdb_metadata; không tự duyệt mapping. TMDB vẫn tùy chọn với ENABLE_TMDB=True/TMDB_API_READ_TOKEN. ENABLE_WEB_DISCOVERY chỉ tìm URL theo tên phim; không đọc snippet/toàn văn. Có adapter OMDb lookup theo mapping; chưa bulk importer, Metacritic User Score, RT hoặc review summary. Demo chặn lookup ngoài.",
  ],
  [
    "9. Nghiệm thu",
    "Chạy contract tests bằng FAISS và ChatOllama thật với HTTP/model fixtures, rồi xuất báo cáo inference/retrieval của phiên này. Các nhóm live OMDb/TMDB/web chưa được đánh dấu đạt tự động. Dữ liệu nguồn chỉ là data; tool allowlist, schema, evidence registry và budget kiểm ngoài model.",
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
    "# pj-Flim movie agent — Colab PoC v0.1\n\nQwen2.5:7b/Ollama + LangChain + multilingual E5/FAISS. Chạy từ trên xuống trong notebook. Đây là agent tìm phim và dẫn nguồn có giới hạn, chưa tích hợp website hoặc huấn luyện model.\n\nNotebook độc lập, không cần push GitHub. GPU/model trên Colab chưa được người tạo notebook chạy nghiệm thu thay bạn. Chọn dữ liệu/nguồn ở cell 1 trước khi Run all.\n\nNguồn: [Colab FAQ](https://research.google.com/colaboratory/faq.html), [Ollama Linux](https://docs.ollama.com/linux), [ChatOllama](https://docs.langchain.com/oss/python/integrations/chat/ollama), [E5](https://huggingface.co/intfloat/multilingual-e5-small).\n",
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
  cells.push(
    code(
      "step-" + i,
      i === 1
        ? bootstrap
        : await readFile(root + "colab_cells/" + file, "utf8"),
    ),
  );
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
      version: "0.2.0",
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
