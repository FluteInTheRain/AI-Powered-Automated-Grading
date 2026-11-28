/** Turns the grader's mutation report into the plain-Vietnamese answer of POST /problems/check-tests. */

export type GraderCheckReport = {
  total: number; generated: number; capped: boolean; killed: number; score: number | null; weak: boolean | null;
  survivors: { kind: string; description: string }[];
};
export type CheckTestsAnswer = {
  score: number | null; killed: number; total: number; generated: number; capped: boolean;
  survivors: string[]; weak: boolean; note: string;
};

const HINT: Record<string, string> = {
  comparison: "hãy thêm test cho trường hợp biên",
  and_or: "hãy thêm test mà hai điều kiện cho kết quả khác nhau",
  arithmetic: "hãy thêm test có kết quả phụ thuộc vào phép tính này",
  range_bound: "hãy thêm test chạm tới phần tử đầu hoặc cuối của vòng lặp",
  wrong_end_element: "hãy thêm test mà phần tử đầu và phần tử cuối khác nhau",
  wrong_return: "hãy thêm test cho trường hợp phải trả về giá trị này",
  drop_guard: "hãy thêm test cho đầu vào mà đoạn kiểm tra này chặn lại",
  off_by_one: "hãy thêm test cho giá trị sát con số này",
};

const PREFIX = /^line (\d+|\?): /;
const RULES: [string, RegExp, (m: RegExpMatchArray) => string][] = [
  ["comparison", /^changed `(.+?)` to `(.+?)` in `(.+)`$/, (m) => `đổi \`${m[1]}\` thành \`${m[2]}\` , thành ra \`${m[3]}\``],
  ["and_or", /^swapped `(.+?)` for `(.+?)`$/, (m) => `đổi \`${m[1]}\` thành \`${m[2]}\``],
  ["arithmetic", /^replaced `(.+?)` with `(.+?)`$/, (m) => `thay \`${m[1]}\` bằng \`${m[2]}\``],
  ["range_bound", /^range upper bound off by one \(([+-])1\) in `(.+)`$/, (m) => `${m[1] === "+" ? "cộng thêm" : "trừ đi"} 1 ở cận trên của \`${m[2]}\``],
  ["wrong_end_element", /^(?:first|last)-element access `\[(.+?)\]` returns `\[(.+?)\]` instead$/, (m) => `lấy phần tử \`[${m[2]}]\` thay cho \`[${m[1]}]\``],
  ["wrong_return", /^`(return .+?)` flipped to `(return .+?)`$/, (m) => `đổi \`${m[1]}\` thành \`${m[2]}\``],
  ["drop_guard", /^removed the guard `(if .+?): \.\.\.` \(early return\/raise\)$/, (m) => `bỏ đoạn kiểm tra \`${m[1]}\``],
  ["off_by_one", /^integer literal (-?\d+) changed to (-?\d+)$/, (m) => `đổi số \`${m[1]}\` thành \`${m[2]}\``],
];

/** One survivor in plain words. Unknown shapes fall back to the grader's own description. */
export function describeSurvivor(s: { kind: string; description: string }): string {
  const pre = PREFIX.exec(s.description);
  const rest = pre ? s.description.slice(pre[0].length) : s.description;
  for (const [kind, re, say] of RULES) {
    const m = kind === s.kind ? re.exec(rest) : null;
    if (m) return `Bản sửa ${say(m)}${pre ? ` (dòng ${pre[1]})` : ""} vẫn qua hết test: ${HINT[kind]}.`;
  }
  return `Bản sửa "${s.description}" vẫn qua hết test: hãy thêm test cho trường hợp này.`;
}

export function buildAnswer(r: GraderCheckReport): CheckTestsAnswer {
  const survivors = r.survivors.map(describeSurvivor);
  const weak = r.weak === true;
  let note: string;
  if (r.total === 0) {
    note = "Từ lời giải mẫu không tạo được bản sửa lỗi nào để thử, nên chưa đánh giá được bộ test.";
  } else {
    note = `Bộ test bắt được ${r.killed} trên ${r.total} bản sửa lỗi.`;
    if (r.capped) note += ` Chỉ chạy ${r.total} trong ${r.generated} bản sửa, nên điểm chỉ là ước lượng.`;
    if (survivors.length > 0) note += " Một số bản sửa có thể cho kết quả y hệt lời giải gốc với mọi đầu vào, nên điểm thật có thể cao hơn điểm này.";
    if (weak) note += " Bộ test còn yếu, nên bổ sung trước khi dùng để chấm.";
  }
  return { score: r.score, killed: r.killed, total: r.total, generated: r.generated, capped: r.capped, survivors, weak, note };
}
