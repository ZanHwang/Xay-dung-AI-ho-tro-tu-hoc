import assert from "node:assert/strict";
import { test } from "node:test";
import { examApi, type Submission } from "./exam-api";

test("the exam screen explains a missing route from an older backend", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: "Not Found" }, { status: 404 }));
  await assert.rejects(examApi.history(), {
    status: 404,
    message: "Phiên bản máy chủ đang kết nối chưa có tính năng chấm bài.",
  });
});

test("personal exam uploads use multipart with every image in the selected order", async (t) => {
  const exam = new File(["pdf"], "de.pdf", { type: "application/pdf" });
  const first = new File(["png"], "trang-1.png", { type: "image/png" });
  const second = new File(["jpg"], "trang-2.jpg", { type: "image/jpeg" });
  const official = new File(["key"], "dap-an.pdf", { type: "application/pdf" });
  const request = t.mock.method(globalThis, "fetch", async (input: string, options: RequestInit) => {
    assert.match(input, /\/exams\/submissions$/);
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).has("Content-Type"), false);
    assert.ok(options.body instanceof FormData);
    assert.equal((options.body.get("exam_files") as File).name, exam.name);
    assert.deepEqual(options.body.getAll("answer_files").map((item) => (item as File).name), [first.name, second.name]);
    assert.equal((options.body.get("official_files") as File).name, official.name);
    return Response.json({ id: "personal" }, { status: 201 });
  });
  assert.equal((await examApi.personal([exam], [first, second], [official])).id, "personal");
  assert.equal(request.mock.callCount(), 1);
});

test("official grading sends the selected revision and individual scores to the server", async (t) => {
  const submission = { id: "submission", revision: 4 } as Submission;
  const scores = [{ id: "1", points: "2.75" }, { id: "2", points: "1.25" }];
  t.mock.method(globalThis, "fetch", async (input: string, options: RequestInit) => {
    assert.match(input, /\/classes\/class\/assignments\/exam\/submissions\/submission\/finalize$/);
    assert.equal(new Headers(options.headers).get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(options.body as string), { revision: 4, scores, comment: "Kiểm tra lại." });
    return Response.json({ official: { total: "4.00" } });
  });
  assert.equal((await examApi.finalize("class", "exam", submission, scores, "Kiểm tra lại.")).official?.total, "4.00");
});
