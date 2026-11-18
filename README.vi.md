# AI-Powered Automated Grading

[English](README.md) | **Tiếng Việt**

**Chấm bài lập trình bằng LLM nhỏ: lặp lại ra cùng điểm, và kiểm tra lại được.**

[![Live demo](https://img.shields.io/badge/demo-grading.khangnguyen.workers.dev-f38020?logo=cloudflare&logoColor=white)](https://grading.khangnguyen.workers.dev)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776ab?logo=python&logoColor=white)](requirements.txt)
[![React 18](https://img.shields.io/badge/react-18-61dafb?logo=react&logoColor=black)](frontend/package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Đây là một dự án nghiên cứu cá nhân. Câu hỏi dự án muốn trả lời: một model **tối đa 7B tham
số** có chấm code được không, sao cho **cùng một bài nộp luôn được cùng một điểm**, và giáo
viên thấy rõ vì sao bài được điểm đó?

Phần lớn các demo "chấm bài bằng LLM" chỉ hỏi model một điểm tổng. Điểm đó thay đổi giữa các
lần chạy và không ai kiểm tra lại được. Dự án này thiết kế khác:

- **Điểm đúng/sai lấy từ việc chạy code thật.** Hàm của học sinh được chạy với các test case
  trong sandbox, không dùng LLM, nên phần này luôn cho cùng kết quả.
- **Mỗi tiêu chí còn lại là một câu hỏi nhỏ, đóng.** Hiệu năng, phong cách code và xử lý
  trường hợp biên: mỗi tiêu chí có một prompt hẹp. Câu trả lời bị ràng buộc bởi JSON schema
  (đúng/sai hoặc một mức ngắn), không phải văn bản tự do.
- **Điểm cuối tính bằng Python.** Đó là tổng có trọng số cố định của các phần. LLM không
  bao giờ đưa ra hay chỉnh một con số nào.

Dùng thử: **https://grading.khangnguyen.workers.dev**. Tạo đề, chia sẻ link bài thi, nộp bài
với vai học sinh, rồi xem điểm cùng toàn bộ nhật ký gọi LLM (audit trail).

## Mục lục

- [Kết quả](#kết-quả)
- [Cách chấm điểm](#cách-chấm-điểm)
- [Repo gồm những gì](#repo-gồm-những-gì)
- [Bắt đầu](#bắt-đầu)
- [Chạy thí nghiệm](#chạy-thí-nghiệm)
- [Triển khai](#triển-khai)
- [Giới hạn](#giới-hạn)
- [Tài liệu](#tài-liệu)
- [Giấy phép](#giấy-phép)

## Kết quả

Mọi con số dưới đây lấy từ các lần chạy trong `experiments/`. Bảng đầy đủ, phương pháp và các
lưu ý nằm trong [`docs/report/results.md`](docs/report/results.md).

**Độ ổn định.** Model: Qwen2.5-Coder-7B-Instruct (Q4_K_M), chạy bằng llama.cpp; temp=0;
seed cố định. Mỗi bài được chấm 100 lần.

| Điều kiện | Bài thử | Tỉ lệ trùng khớp tuyệt đối |
|---|---|---|
| Gửi tuần tự, không gom request | 4 bài đúng, code sạch | 1.0 cả 4 bài |
| Server gom request (`--parallel 4`, 8 client đồng thời) | cùng 4 bài | 1.0 cả 4 bài |
| Cả hai điều kiện | 4 bài có bug khó thấy hoặc chạy theo thời gian mũ | 1.0 cả 4 bài |

Từng tiêu chí riêng lẻ cũng chỉ ra đúng một giá trị trong cả 100 lần chạy.

**Ablation.** Chia nhỏ rubric có giúp ích không? Bảng dưới là hệ số Spearman ρ so với nhãn
tham chiếu của bộ dữ liệu, trên 65 bài (16 đề).

| Cách chấm | LLM làm gì | ρ |
|---|---|---|
| `free_form` | Một prompt, một điểm tổng | 0.60 |
| `hybrid_freeform` | Sandbox chấm đúng/sai; một prompt tự do chấm phần còn lại | 0.85 |
| `hybrid_decomposed` (thiết kế này) | Sandbox chấm đúng/sai; mỗi tiêu chí một prompt có schema | **0.88** |

Mỗi bước chia nhỏ đều làm mức đồng thuận tăng lên. Vì chỉ cần prompt kèm structured decoding
đã đạt mục tiêu (trùng khớp >98%, đồng thuận tốt), giai đoạn fine-tune LoRA dự kiến **không
cần làm nữa**. Quyết định bỏ qua được ghi lại qua một bước kiểm tra go/no-go.

> **Đọc các con số này cùng với lưu ý của chúng.**
> - Nhãn tham chiếu cho hiệu năng và phong cách code do một người (tác giả) gán, nên các giá
>   trị ρ chỉ là phép kiểm tra pipeline có hợp lý không. Đó không phải mức đồng thuận với
>   giáo viên chấm thật. Xem [`data/script.md`](data/script.md).
> - "1.0 ở n=100" nghĩa là chưa phát hiện lệch điểm ở cỡ mẫu đó. Nó không chứng minh bộ chấm
>   luôn cho cùng kết quả: trong một lần test thủ công, đã có một tiêu chí đổi kết quả giữa
>   hai lần gọi giống hệt nhau.

## Cách chấm điểm

```mermaid
flowchart LR
    S[Student submission] --> X[Sandbox: run test cases]
    X -->|pass rate| C[correctness]
    X -->|"0 tests passed or compile error"| Z[All dimensions = 0]
    S --> E[LLM check: efficiency]
    S --> T[LLM check: code style]
    S --> H[LLM check: edge cases]
    C --> A["aggregate()<br/>fixed weighted sum in Python"]
    E --> A
    T --> A
    H --> A
    A --> F[Final score 0-100]
    F -.-> FB[LLM feedback text<br/>generated after scoring,<br/>never changes the score]
```

| Bước | Code | Ghi chú |
|---|---|---|
| Chạy test | [`src/grader/sandbox.py`](src/grader/sandbox.py) | Nguồn duy nhất của điểm đúng/sai. Nếu code lỗi biên dịch hoặc không qua test nào, mọi tiêu chí đều bằng 0, để LLM không cho điểm một bài bỏ trống. |
| Kiểm tra bằng LLM | [`src/grader/rubric_checks.py`](src/grader/rubric_checks.py), [`prompts/`](prompts/) | Mỗi tiêu chí một lần gọi độc lập. Kết quả được kiểm tra theo các model pydantic trong [`src/grader/schemas.py`](src/grader/schemas.py). |
| Các thiết lập để kết quả ổn định | [`src/grader/llm_client.py`](src/grader/llm_client.py) | temperature=0, seed cố định và decoding ràng buộc theo JSON schema, đặt ở một chỗ duy nhất. Mọi lần gọi được ghi vào `call_log` để làm audit trail. |
| Tính điểm | [`src/grader/aggregator.py`](src/grader/aggregator.py) | Tổng có trọng số theo rubric (ví dụ 60/15/15/10). |
| Điều phối | [`src/grader/pipeline.py`](src/grader/pipeline.py) | `grade()` là một hàm chạy tuần tự. Không dùng agent framework, nên không có thêm lớp nào để kết quả mất ổn định. |

Lý do của thiết kế này và các tài liệu tham khảo nằm trong
[`docs/architecture.md`](docs/architecture.md).

## Repo gồm những gì

Repo có hai phần: một **pipeline nghiên cứu** để đo bộ chấm, và một **app** cho giáo viên và
học sinh dùng.

```
src/grader/        Grading pipeline: sandbox, LLM checks, schemas, aggregation, feedback
prompts/           One narrowly scoped prompt per rubric dimension (+ ablation baselines)
experiments/       Consistency test, ablation, metrics
data/              Pilot dataset source (problems.py) and generator (build_dataset.py)
configs/           Model and serving settings that affect determinism
server/            Product API: FastAPI + SQLAlchemy + Postgres
frontend/          Product UI: React + Vite (teacher authoring, exam page, results)
worker/            The same product API as a Cloudflare Python Worker (D1 + Workers AI)
sandbox-worker/    Isolated Cloudflare Worker that runs student code
deploy/            Single-VM deployment (Docker Compose + nginx + llama-server)
tests/             pytest suite (grader, rules, both Workers)
docs/              Architecture, roadmap, results, deployment design
```

**Luồng sử dụng app:**
1. Giáo viên soạn đề, lời giải mẫu và input của các test. App chạy lời giải mẫu để tính đáp
   án mong đợi.
2. Giáo viên tạo bài thi và nhận hai link: một link cho học sinh, một link riêng để xem kết
   quả.
3. Học sinh nộp code và nhận điểm kèm nhận xét.
4. Giáo viên xem từng bài nộp, kể cả prompt và câu trả lời thô của LLM, và có thể xuất kết
   quả ra Excel.

## Bắt đầu

Cần có:
- Python 3.12
- Node.js 18+
- Docker, để chạy Postgres trên máy
- Một LLM endpoint tương thích OpenAI. Mặc định là `llama-server` của llama.cpp, nhưng
  endpoint nào hỗ trợ output theo JSON schema cũng dùng được.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python3 data/build_dataset.py      # sinh data/dataset.json (không commit)
pytest                             # không cần LLM hay database
```

### Chạy model server

```bash
brew install llama.cpp
scripts/model_server.sh start      # chạy Qwen2.5-Coder-7B-Instruct ở cổng 8080
```

`scripts/model_server.sh start --parallel 4` bật chế độ server gom request, chính là cấu hình
dùng cho thí nghiệm độ ổn định khi gom request.

Muốn dùng endpoint hosted thay vì chạy trên máy, đặt biến môi trường `LLM_API_KEY` và truyền
`--base_url` cùng `--model`. Ví dụ với Cloudflare Workers AI:

```bash
export LLM_API_KEY=...             # đọc từ biến môi trường, không bao giờ từ tham số dòng lệnh
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 5 \
  --base_url https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1 \
  --model @cf/qwen/qwen2.5-coder-32b-instruct --seed 1   # Workers AI không nhận seed 0
```

### Chạy app trên máy

```bash
docker compose up -d                          # Postgres 16 ở cổng 5433
alembic upgrade head                          # tạo bảng
uvicorn server.main:app --reload --port 8001  # API
cd frontend && npm install && npm run dev     # giao diện; chuyển tiếp /api tới :8001
```

`DATABASE_URL` mặc định là `postgresql+psycopg://grading:grading@localhost:5433/grading`.
Database này tách riêng khỏi bộ dữ liệu nghiên cứu; bản thân pipeline không cần database.

`streamlit run app.py` mở một trang demo nhỏ, chỉ chạy riêng pipeline.

## Chạy thí nghiệm

```bash
# Chấm một bài N lần và đếm xem có bao nhiêu điểm khác nhau
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100

# Như trên, nhưng gửi các request chồng nhau để server phải gom request
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100 \
  --concurrency 8 --tag batched

# So sánh ba cách chấm trên toàn bộ dữ liệu
python3 experiments/ablation.py --arm all
```

Kết quả được ghi ra `results/` dưới dạng JSON (thư mục này nằm trong gitignore). Mã bài có
dạng `P<nn>_<problem>__S<n>_<variant>`; xem `data/problems.py`.

Bộ dữ liệu có 16 đề và 65 bài nộp. Mỗi đề có một lời giải đúng, cùng các biến thể được cố ý
cài bug, làm chậm hoặc viết xấu. Muốn thêm đề, sửa `data/problems.py` rồi chạy lại
`python3 data/build_dataset.py`; đừng sửa file JSON bằng tay.

## Triển khai

Có hai cách triển khai, mỗi cách có tài liệu hướng dẫn riêng.

| Nơi chạy | Công nghệ | Chi phí | Hướng dẫn |
|---|---|---|---|
| **Cloudflare (bản demo đang chạy)** | Python Worker (FastAPI trên Pyodide) + D1 + Workers AI + một Worker sandbox riêng | $0 (Workers Free) | [`worker/README.md`](worker/README.md) |
| Một máy ảo | Docker Compose: FastAPI, Postgres, nginx, một unit systemd chạy llama-server | Một VM có GPU | [`deploy/README.md`](deploy/README.md) |

Trên Cloudflare, code của học sinh không bao giờ chạy cạnh database:

```mermaid
flowchart LR
    U[Browser] --> G["grading Worker<br/>UI + API"]
    G --> D[(D1)]
    G --> AI[Workers AI]
    G -- "service binding<br/>code + inputs only" --> SB["grading-sandbox Worker<br/>no bindings, no public URL"]
```

Worker sandbox chỉ nhận code và input của test, và chỉ trả về output. Worker chính so output
đó với đáp án, nên đáp án của các test ẩn không bao giờ nằm trong môi trường chạy code học
sinh. Thiết kế và các rủi ro đã chấp nhận khi dùng gói Free nằm trong
[`docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md`](docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md).

## Giới hạn

- **Nhãn:** nhãn hiệu năng và phong cách code chỉ do một người gán, như đã nói ở
  [Kết quả](#kết-quả). Việc đối chiếu với điểm của giáo viên độc lập vẫn chưa làm.
- **Phạm vi của độ ổn định:**
  - Kết quả độ ổn định được đo bằng llama.cpp, với model 7B và 1.5B, ở 8 request đồng thời.
    Kết quả có thể không đúng với vLLM, mức gom request lớn hơn hay model khác.
  - Bản demo dùng model 32B trên hạ tầng dùng chung của Cloudflare. Model này nằm ngoài phạm
    vi dưới 7B, và mới chỉ được kiểm tra độ ổn định vài lần.
- **App chưa được gia cố:**
  - Bản demo không có đăng nhập, không giới hạn số request.
  - Sau khi nộp, học sinh thấy được những test ẩn nào bị sai, kể cả input của chúng.
  - App không chặn nộp lại.
- **Sandbox:**
  - Trên Cloudflare, môi trường chạy của sandbox được dùng lại giữa các request, và code học
    sinh gửi được request ra ngoài.
  - Trên máy ảo, code chạy ngay trong tiến trình của server.
  - Cả hai đều chưa đủ an toàn cho kỳ thi quan trọng với code không tin cậy.

## Tài liệu

| Tài liệu | Đọc để biết |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Vì sao thiết kế kết hợp và chia nhỏ, kèm trích dẫn |
| [`docs/report/results.md`](docs/report/results.md) | Bảng thí nghiệm đầy đủ và các lưu ý |
| [`docs/roadmap.md`](docs/roadmap.md) | Lịch sử dự án theo từng task |
| [`docs/TECHNICAL_OVERVIEW.md`](docs/TECHNICAL_OVERVIEW.md) | Phân tích kỹ thuật chi tiết cho người xem portfolio (có cả bản PDF) |
| [`docs/productionization.md`](docs/productionization.md) | Ý tưởng và việc còn lại để biến pipeline thành sản phẩm thật |
| [`data/script.md`](data/script.md) | Cấu trúc dữ liệu, cách gán nhãn, các giới hạn đã biết |
| [`worker/README.md`](worker/README.md) | Triển khai và vận hành bản Cloudflare |

Repo cũng có [`CLAUDE.md`](CLAUDE.md) và các slash command trong `.claude/commands/`
(`/run-consistency`, `/run-ablation`, `/add-problem`, `/report-section`) để làm việc với
Claude Code.

## Giấy phép

[MIT](LICENSE) © 2026 Khang Nguyen
