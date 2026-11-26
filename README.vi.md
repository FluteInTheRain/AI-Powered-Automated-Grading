# AI-Powered Automated Grading

[English](README.md) | **Tiếng Việt**

**Chấm bài lập trình bằng LLM nhỏ: lặp lại ra cùng điểm, kiểm tra lại được, kèm một app cho giáo viên chạy hoàn toàn trên Cloudflare.**

[![CI](https://github.com/FluteInTheRain/AI-Powered-Automated-Grading/actions/workflows/ci.yml/badge.svg)](https://github.com/FluteInTheRain/AI-Powered-Automated-Grading/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/demo-grading.khangnguyen.workers.dev-f38020?logo=cloudflare&logoColor=white)](https://grading.khangnguyen.workers.dev)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776ab?logo=python&logoColor=white)](requirements.txt)
[![TypeScript](https://img.shields.io/badge/typescript-Hono%20on%20Workers-3178c6?logo=typescript&logoColor=white)](app-worker)
[![React 18](https://img.shields.io/badge/react-18-61dafb?logo=react&logoColor=black)](app-ui/package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Đây là một dự án cá nhân gồm hai phần dùng chung một bộ chấm:

- **Một câu hỏi nghiên cứu.** Một model **tối đa 7B tham số** có chấm code được không, sao cho
  **cùng một bài nộp luôn được cùng một điểm**, và giáo viên thấy rõ vì sao bài được điểm đó?
- **Một sản phẩm xây trên câu trả lời đó.** Một app nhỏ cho giáo viên, chạy hoàn toàn trên **gói Free** của
  Cloudflare: giáo viên tạo bài thi nhiều câu, học sinh nộp một lần, AI chấm từng câu ở chế độ nền và lưu
  đầy đủ nhật ký để kiểm tra lại.

Phần lớn các demo "chấm bài bằng LLM" chỉ hỏi model một điểm tổng. Điểm đó thay đổi giữa các lần chạy và không
ai kiểm tra lại được. Dự án này thiết kế khác:

- **Điểm đúng/sai lấy từ việc chạy code thật.** Hàm của học sinh được chạy với các test case trong sandbox,
  không dùng LLM, nên phần này luôn cho cùng kết quả.
- **Mỗi tiêu chí còn lại là một câu hỏi nhỏ, đóng.** Hiệu năng, phong cách code và xử lý trường hợp biên: mỗi
  tiêu chí có một prompt hẹp. Câu trả lời bị ràng buộc bởi JSON schema (đúng/sai hoặc một mức ngắn), không phải
  văn bản tự do.
- **Điểm cuối tính bằng Python.** Đó là tổng có trọng số cố định của các phần. LLM không bao giờ đưa ra hay chỉnh
  một con số nào.

## Thử ngay

| Gì | Link | Ghi chú |
|---|---|---|
| Bản demo công khai | https://grading.khangnguyen.workers.dev | Không cần đăng nhập. Tạo đề, chia sẻ link bài thi, nộp bài với vai học sinh, rồi xem điểm cùng toàn bộ nhật ký gọi LLM. Mỗi bài thi một câu. |
| App giáo viên | https://teacher-app.khangnguyen.workers.dev | Các trang giáo viên nằm sau Cloudflare Access và chỉ cho email của tác giả, nên người xem không đăng nhập được. Link bài thi của học sinh mở được không cần đăng nhập. Kiến trúc, test và CI nằm trong repo này. |

## Mục lục

- [Kết quả](#kết-quả)
- [Cách chấm điểm](#cách-chấm-điểm)
- [App cho giáo viên](#app-cho-giáo-viên)
- [Công nghệ](#công-nghệ)
- [Cấu trúc repo](#cấu-trúc-repo)
- [Bắt đầu](#bắt-đầu)
- [Chạy thí nghiệm](#chạy-thí-nghiệm)
- [Kiểm thử và CI/CD](#kiểm-thử-và-cicd)
- [Triển khai](#triển-khai)
- [Giới hạn](#giới-hạn)
- [Tình trạng và lộ trình](#tình-trạng-và-lộ-trình)
- [Tài liệu](#tài-liệu)
- [Giấy phép](#giấy-phép)

## Kết quả

Mọi con số dưới đây lấy từ các lần chạy trong `experiments/`, trừ khi có ghi khác. Bảng đầy đủ, phương pháp và
các lưu ý nằm trong [`docs/report/results.md`](docs/report/results.md).

**Độ ổn định.** Model: Qwen2.5-Coder-7B-Instruct (Q4_K_M), chạy bằng llama.cpp; temp=0; seed cố định. Mỗi bài
được chấm 100 lần.

| Điều kiện | Bài thử | Tỉ lệ trùng khớp tuyệt đối |
|---|---|---|
| Gửi tuần tự, không gom request | 4 bài đúng, code sạch | 1.0 cả 4 bài |
| Server gom request (`--parallel 4`, 8 client đồng thời) | cùng 4 bài | 1.0 cả 4 bài |
| Cả hai điều kiện | 4 bài có bug khó thấy hoặc chạy theo thời gian mũ | 1.0 cả 4 bài |

Từng tiêu chí riêng lẻ cũng chỉ ra đúng một giá trị trong cả 100 lần chạy.

**Ablation.** Chia nhỏ rubric có giúp ích không? Bảng dưới là hệ số Spearman ρ so với nhãn tham chiếu của bộ dữ
liệu, trên 65 bài (16 đề).

| Cách chấm | LLM làm gì | ρ |
|---|---|---|
| `free_form` | Một prompt, một điểm tổng | 0.60 |
| `hybrid_freeform` | Sandbox chấm đúng/sai; một prompt tự do chấm phần còn lại | 0.85 |
| `hybrid_decomposed` (thiết kế này) | Sandbox chấm đúng/sai; mỗi tiêu chí một prompt có schema | **0.88** |

Mỗi bước chia nhỏ đều làm mức đồng thuận tăng lên. Vì chỉ cần prompt kèm structured decoding đã đạt mục tiêu
(trùng khớp >98%, đồng thuận tốt), giai đoạn fine-tune LoRA dự kiến **không cần làm nữa**. Quyết định bỏ qua được
ghi lại qua một bước kiểm tra go/no-go.

**Điểm phong cách code không trừ vì thiếu comment.** Prompt style đầu tiên không nhắc đến comment, và trên model
32B mọi bài đúng nhưng không có comment đều bị `medium` (0 trên 16 bài đạt `clean`). Sau khi nêu rõ comment,
docstring, type hint là tùy chọn, 13 trên 16 bài đạt `clean`. Đây là phép đo mỗi bài một lần gọi trên Workers
AI, không phải kiểm tra độ ổn định: xem các lưu ý trong [`docs/report/results.md`](docs/report/results.md).

> **Đọc các con số này cùng với lưu ý của chúng.**
> - Nhãn tham chiếu cho hiệu năng và phong cách code do một người (tác giả) gán, nên các giá trị ρ chỉ là phép
>   kiểm tra pipeline có hợp lý không. Đó không phải mức đồng thuận với giáo viên chấm thật. Xem
>   [`data/script.md`](data/script.md).
> - "1.0 ở n=100" nghĩa là chưa phát hiện lệch điểm ở cỡ mẫu đó. Nó không chứng minh bộ chấm luôn cho cùng kết
>   quả: trong một lần test thủ công, đã có một tiêu chí đổi kết quả giữa hai lần gọi giống hệt nhau.
> - Ablation được chạy trước quy tắc hiện tại (code không chạy được, hoặc không qua test nào, thì mọi tiêu chí
>   đều 0 điểm) và trước khi đổi prompt style. Nó chưa được chạy lại, nên các con số mô tả những prompt trước đó.

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

Lý do của thiết kế này và các tài liệu tham khảo nằm trong [`docs/architecture.md`](docs/architecture.md).

## App cho giáo viên

Giáo viên đăng nhập, tạo bài thi từ kho câu hỏi (hoặc câu hỏi tự soạn) và chia sẻ một link. Học sinh mở link,
làm hết các câu rồi nộp **một lần**. Mọi câu được chấm song song và học sinh thấy một kết quả cho cả bài.

```mermaid
flowchart LR
    T[Teacher] -->|login| AC[Cloudflare Access]
    S[Student] -->|exam link| GATE["Turnstile +<br/>rate limits"]
    AC --> API
    GATE --> API
    subgraph APP["teacher-app Worker (TypeScript, Hono)"]
        API["API + static React UI"]
        QC[Queue consumer]
    end
    API --> D1[(D1)]
    API --> DO["Durable Object<br/>one per attempt: clock + lock"]
    API -- "one message per question" --> Q[(Queues)]
    Q --> QC
    QC --> D1
    QC --> R2[("R2<br/>LLM audit log")]
    QC -- "service binding" --> G["grading Worker<br/>(Python)"]
    G -- "code + inputs only" --> SB["grading-sandbox Worker<br/>no bindings, no public URL"]
    G --> AI[Workers AI]
```

**App làm được gì**
- **Bài thi.** Kho 16 đề cùng đề giáo viên tự soạn (qua API), bài thi tối đa 20 câu có trọng số, hạn nộp và
  thời gian làm bài.
- **Luồng học sinh.** Nhập tên và qua kiểm tra Turnstile, rồi các câu hiện ra cùng đồng hồ phía server. "Run
  Tests" kiểm tra các test công khai theo từng câu; một lần "Nộp bài" có xác nhận sẽ nộp tất cả. Tải lại trang
  thì tiếp tục lượt làm cũ, và mã biên nhận cho phép xem lại điểm sau này.
- **Chấm nền.** Nộp bài lưu mỗi câu một bài nộp và một công việc chấm trong cùng một batch D1 rồi trả lời ngay.
  Một consumer của hàng đợi chấm từng câu qua Worker Python, ghi điểm và lưu toàn bộ prompt cùng câu trả lời thô
  của LLM vào R2. Công việc được thử lại an toàn, công việc bị kẹt có thể xếp lại hàng, và câu bỏ trống được 0
  điểm mà không chạy sandbox hay gọi LLM.
- **Điểm chỉ được thêm, không bị ghi đè.** Bản ghi điểm và bài nộp không sửa hay xóa được (trigger SQL), nên
  chấm lại bằng tay sau này sẽ thêm một bản mới kèm lý do thay vì ghi đè điểm của AI.
- **Giới hạn lạm dụng.** Giới hạn tần suất theo IP và theo lượt làm, cùng kiểm tra Turnstile khi bắt đầu một
  lượt làm.
- **Màn hình giáo viên.** Danh sách bài thi, bảng kết quả theo từng học sinh và từng câu kèm trạng thái chấm,
  chỉnh hạn nộp.

**Vì sao mỗi sản phẩm Cloudflare có mặt**

| Sản phẩm | Việc trong app |
|---|---|
| Workers (TypeScript, Hono) | API, consumer của hàng đợi và giao diện React tĩnh |
| Access | Đăng nhập giáo viên, được kiểm tra lại trong Worker (đóng khi có lỗi) |
| D1 | Giáo viên, đề, bài thi, lượt làm, bài nộp, các bản ghi điểm chỉ-thêm |
| Queues | Chấm ở chế độ nền; giao tin nhắn ít nhất một lần được xử lý bằng công việc idempotent |
| Durable Objects | Đồng hồ chuẩn của một lượt làm và khoá "mỗi lúc chỉ một lần nộp" |
| R2 | Toàn bộ nhật ký gọi LLM của mọi bài đã chấm |
| Rate Limiting, Turnstile | Giới hạn theo IP và theo lượt làm; kiểm tra bot khi bắt đầu lượt làm |
| Workers AI + service binding | Worker Python chấm bài gọi model; app TypeScript gọi bộ chấm |

Thiết kế nằm ở [`docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md`](docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md);
hướng dẫn vận hành và API nằm ở [`app-worker/README.md`](app-worker/README.md).

## Công nghệ

| Mảng | Công nghệ |
|---|---|
| Pipeline chấm | Python 3.12, pydantic, client tương thích OpenAI, llama.cpp (Qwen2.5-Coder-7B) hoặc Workers AI |
| Backend app giáo viên | TypeScript, Hono trên Cloudflare Workers, D1, Queues, Durable Objects, R2, Rate Limiting, Turnstile, Access |
| Các Worker chấm | Python Workers (FastAPI trên Pyodide) và một Worker sandbox riêng |
| Giao diện | React 18 + Vite (`app-ui/`), trình soạn thảo Monaco; file tĩnh do Worker phục vụ |
| App gốc | FastAPI, SQLAlchemy, Postgres, React (`server/`, `frontend/`) |
| Kiểm thử | pytest, vitest chạy trong runtime Workers, Testing Library |
| CI/CD | GitHub Actions, wrangler |

## Cấu trúc repo

```
src/grader/        Grading pipeline: sandbox, LLM checks, schemas, aggregation, feedback
prompts/           One narrowly scoped prompt per rubric dimension (+ ablation baselines)
experiments/       Consistency test, ablation, metrics
data/              Pilot dataset source (problems.py) and generator (build_dataset.py)
configs/           Model and serving settings that affect determinism
app-worker/        Teacher app: TypeScript Worker (Hono, D1, Queues, Durable Objects, R2)
app-ui/            Teacher app UI: React + Vite, built to static files
worker/            Python grading Worker (+ the original single-question demo API)
sandbox-worker/    Isolated Cloudflare Worker that runs student code
server/, frontend/ Original product app: FastAPI + Postgres, React UI
deploy/            Single-VM deployment (Docker Compose + nginx + llama-server)
scripts/           Model server helper, question-bank seed generator
tests/             pytest suite (grader, rules, Workers, prompts, migrations)
docs/              Architecture, roadmap, results, design specs and plans
.github/workflows/ CI and deploy workflows
```

## Bắt đầu

Cần có:
- Python 3.12
- Node.js 24 (phiên bản CI dùng) hoặc một bản LTS gần đây
- Một LLM endpoint tương thích OpenAI cho các thí nghiệm. Mặc định là `llama-server` của llama.cpp, nhưng
  endpoint nào hỗ trợ output theo JSON schema cũng dùng được.
- Chỉ cho app gốc: Docker, để chạy Postgres trên máy.

### Pipeline chấm và test của nó

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

`scripts/model_server.sh start --parallel 4` bật chế độ server gom request, chính là cấu hình dùng cho thí
nghiệm độ ổn định khi gom request.

Muốn dùng endpoint hosted thay vì chạy trên máy, đặt biến môi trường `LLM_API_KEY` và truyền `--base_url` cùng
`--model`. Ví dụ với Cloudflare Workers AI:

```bash
export LLM_API_KEY=...             # đọc từ biến môi trường, không bao giờ từ tham số dòng lệnh
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 5 \
  --base_url https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1 \
  --model @cf/qwen/qwen2.5-coder-32b-instruct --seed 1   # Workers AI không nhận seed 0
```

### App giáo viên (Cloudflare)

```bash
cd app-worker && npm install
npm test && npm run typecheck      # vitest chạy trong runtime Workers, không cần đăng nhập Cloudflare
cd ../app-ui && npm install
npm test && npm run build          # Worker phục vụ app-ui/dist như file tĩnh
```

Cách chạy với tài nguyên Cloudflare thật (D1, hàng đợi, bucket R2, Access, Turnstile) được mô tả từng bước trong
[`app-worker/README.md`](app-worker/README.md).

### App gốc (Postgres)

```bash
docker compose up -d                          # Postgres 16 ở cổng 5433
alembic upgrade head                          # tạo bảng
uvicorn server.main:app --reload --port 8001  # API
cd frontend && npm install && npm run dev     # giao diện; chuyển tiếp /api tới :8001
```

`DATABASE_URL` mặc định là `postgresql+psycopg://grading:grading@localhost:5433/grading`. Database này tách riêng
khỏi bộ dữ liệu nghiên cứu; bản thân pipeline không cần database. `streamlit run app.py` mở một trang demo nhỏ,
chỉ chạy riêng pipeline.

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

Kết quả được ghi ra `results/` dưới dạng JSON (thư mục này nằm trong gitignore). Mã bài có dạng
`P<nn>_<problem>__S<n>_<variant>`; xem `data/problems.py`.

Bộ dữ liệu có 16 đề và 65 bài nộp. Mỗi đề có một lời giải đúng, cùng các biến thể được cố ý cài bug, làm chậm
hoặc viết xấu. Muốn thêm đề, sửa `data/problems.py` rồi chạy lại `python3 data/build_dataset.py`; đừng sửa file
JSON bằng tay. Kho câu hỏi của app giáo viên được sinh từ chính file này bằng
`python3 scripts/export_bank_seed.py`.

## Kiểm thử và CI/CD

- **Kiểm thử.** `pytest` bao phủ bộ chấm, các quy tắc dùng chung, các Worker Python, các prompt và migration D1.
  `vitest` chạy Worker TypeScript trong runtime Workers (binding D1, Durable Objects, R2 thật) và giao diện React
  bằng Testing Library. Các tính năng được viết theo hướng test trước.
- **CI** ([`ci.yml`](.github/workflows/ci.yml)). Mỗi pull request và mỗi lần push vào `main` chạy ba job song
  song: test Python, test Worker cùng typecheck, test giao diện cùng build.
- **Deploy** ([`deploy.yml`](.github/workflows/deploy.yml)). Mỗi lần push vào `main`, sau cùng các bước kiểm tra
  trên, workflow deploy Worker sandbox, Worker Python chấm bài, áp migration D1, build giao diện rồi deploy app
  giáo viên, sau đó kiểm tra nhanh các URL thật. Hai lần deploy không bao giờ chạy chồng nhau.

## Triển khai

| Nơi chạy | Công nghệ | Chi phí | Hướng dẫn |
|---|---|---|---|
| **App giáo viên trên Cloudflare** | Worker TypeScript + D1 + Queues + Durable Objects + R2 + Access + Turnstile, gọi Worker Python chấm bài | $0 (Workers Free) | [`app-worker/README.md`](app-worker/README.md) |
| Bản demo công khai trên Cloudflare | Python Worker (FastAPI trên Pyodide) + D1 + Workers AI + một Worker sandbox riêng | $0 (Workers Free) | [`worker/README.md`](worker/README.md) |
| Một máy ảo | Docker Compose: FastAPI, Postgres, nginx, một unit systemd chạy llama-server | Một VM có GPU | [`deploy/README.md`](deploy/README.md) |

Trên Cloudflare, code của học sinh không bao giờ chạy cạnh database. Worker sandbox không có binding nào và không
có URL công khai; nó chỉ nhận code và input của test, và chỉ trả về output. Worker chấm bài so output đó với đáp
án, nên đáp án của các test ẩn không bao giờ nằm trong môi trường chạy code học sinh. Thiết kế và các rủi ro đã
chấp nhận khi dùng gói Free nằm trong
[`docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md`](docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md).

## Giới hạn

- **Nhãn.** Nhãn hiệu năng và phong cách code chỉ do một người gán, như đã nói ở [Kết quả](#kết-quả). Việc đối
  chiếu với điểm của giáo viên độc lập vẫn chưa làm.
- **Phạm vi của độ ổn định.** Kết quả độ ổn định được đo bằng llama.cpp, ở 8 request đồng thời. Các bài code sạch
  được chạy trên cả model 7B và 1.5B; các bài khó chỉ chạy trên 7B. Kết quả có thể không đúng với vLLM, mức gom
  request lớn hơn hay model khác. Các app đang chạy dùng model 32B trên hạ tầng dùng chung của Cloudflare, nằm
  ngoài phạm vi dưới 7B, và mới chỉ được kiểm tra độ ổn định vài lần. Việc đổi prompt style được đo trên chính
  model 32B đó, mỗi bài một lần gọi.
- **Tên không phải danh tính.** Học sinh chỉ là một cái tên cộng một link. Mỗi tên chỉ dùng được một lần trong một
  bài thi, nên một bạn cùng lớp có thể chiếm tên trước, và đổi tên khác thì luôn bắt đầu một đồng hồ mới. Giới hạn
  thật theo từng học sinh cần danh sách lớp hoặc lời mời do giáo viên cấp.
- **Bản nháp và thiết bị.** Code đang gõ chỉ được lưu nháp trong trình duyệt của học sinh. Xóa dữ liệu trình duyệt
  hoặc đổi thiết bị là mất, và không tiếp tục lượt làm từ thiết bị khác được.
- **Sandbox.** Trên Cloudflare, môi trường chạy của sandbox được dùng lại giữa các request và code học sinh gửi
  được request ra ngoài; trên máy ảo, code chạy ngay trong tiến trình của server. Cả hai đều chưa đủ an toàn cho
  kỳ thi quan trọng với code không tin cậy.
- **Chưa làm.** Khiếu nại của học sinh, chấm lại bằng tay và màn hình xem nhật ký chấm cho giáo viên (mô hình dữ
  liệu đã hỗ trợ sẵn), xuất Excel cho app mới, và tự soạn câu hỏi ngay trên giao diện.

## Tình trạng và lộ trình

Các giai đoạn nghiên cứu đã xong. App giáo viên đã có phần nền (đăng nhập, kho đề, bài thi, chấm bài) cùng chấm
nền, giới hạn tần suất và nhật ký chấm đã được deploy. Tiếp theo là luồng khiếu nại: học sinh phản đối một điểm,
giáo viên xem lại chính xác AI đã chấm thế nào và chấm lại bằng tay nếu cần. Lịch sử theo từng task nằm trong
[`docs/roadmap.md`](docs/roadmap.md).

## Tài liệu

| Tài liệu | Đọc để biết |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Vì sao thiết kế kết hợp và chia nhỏ, kèm trích dẫn |
| [`docs/report/results.md`](docs/report/results.md) | Bảng thí nghiệm đầy đủ và các lưu ý |
| [`docs/roadmap.md`](docs/roadmap.md) | Lịch sử dự án theo từng task |
| [`app-worker/README.md`](app-worker/README.md) | Hướng dẫn vận hành app giáo viên, API và các giới hạn đã biết |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) và [`plans/`](docs/superpowers/plans/) | Tài liệu thiết kế và kế hoạch triển khai |
| [`docs/TECHNICAL_OVERVIEW.md`](docs/TECHNICAL_OVERVIEW.md) | Phân tích kỹ thuật chi tiết cho người xem portfolio (có cả bản PDF) |
| [`docs/productionization.md`](docs/productionization.md) | Ý tưởng và việc còn lại để biến pipeline thành sản phẩm thật |
| [`data/script.md`](data/script.md) | Cấu trúc dữ liệu, cách gán nhãn, các giới hạn đã biết |
| [`worker/README.md`](worker/README.md) | Triển khai và vận hành Worker Python chấm bài và bản demo |

Repo cũng có [`CLAUDE.md`](CLAUDE.md) và các slash command trong `.claude/commands/` (`/run-consistency`,
`/run-ablation`, `/add-problem`, `/report-section`) để làm việc với Claude Code.

## Giấy phép

[MIT](LICENSE) © 2026 Khang Nguyen
