/** Real HTTP/database security checks. Use a dedicated test DB, with ingestion workers stopped. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import pg from "pg";

export async function runApiSecurityChecks(
  baseUrl = process.env.APP_URL || "http://localhost:3000",
) {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Set DATABASE_URL to the running application test database.",
    );
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const origin = new URL(baseUrl).origin;
  const userIds: string[] = [];
  const emails: string[] = [];
  async function request(
    path: string,
    options: {
      method?: string;
      cookie?: string;
      body?: BodyInit;
      json?: unknown;
      origin?: string;
    } = {},
  ) {
    const headers = new Headers({ Origin: options.origin ?? origin });
    if (options.cookie) headers.set("Cookie", options.cookie);
    if (options.json !== undefined)
      headers.set("Content-Type", "application/json");
    return fetch(new URL(path, baseUrl), {
      method: options.method || "GET",
      headers,
      body:
        options.json !== undefined
          ? JSON.stringify(options.json)
          : options.body,
    });
  }
  async function expectStatus(response: Response, status: number) {
    assert.equal(
      response.status,
      status,
      `${response.url}: expected ${status}, got ${response.status}: ${response.status === status ? "" : await response.text()}`,
    );
    return response;
  }
  async function account() {
    const email = `researchos-test-${randomUUID()}@example.com`;
    emails.push(email);
    const response = await expectStatus(
      await request("/api/auth/register", {
        method: "POST",
        json: {
          name: "ResearchOS API test",
          email,
          password: "API test password 7! correct horse",
        },
      }),
      201,
    );
    const { user } = (await response.json()) as { user: { id: string } };
    userIds.push(user.id);
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("researchos_session="))
      ?.split(";")[0];
    assert.ok(cookie, "Registration creates a session cookie.");
    assert.match(response.headers.get("set-cookie") || "", /httponly/i);
    return { id: user.id, cookie };
  }
  async function fixture() {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage();
    page.drawText(
      "Quantum retrieval study. Methods and results are documented here.",
      { x: 40, y: 750, size: 12, font },
    );
    return await pdf.save();
  }
  function upload(bytes: Uint8Array) {
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(bytes)], "Quantum study.pdf", {
        type: "application/pdf",
      }),
    );
    return form;
  }
  try {
    await expectStatus(await request("/api/papers"), 401);
    const a = await account();
    const b = await account();
    const bytes = await fixture();
    const created = await expectStatus(
      await request("/api/papers", {
        method: "POST",
        cookie: a.cookie,
        body: upload(bytes),
      }),
      202,
    );
    const { paper } = (await created.json()) as {
      paper: { id: string; status: string; collection_ids: string[] };
    };
    assert.equal(paper.status, "queued");
    assert.deepEqual(paper.collection_ids, []);
    await expectStatus(
      await request("/api/papers", {
        method: "POST",
        cookie: a.cookie,
        body: upload(bytes),
      }),
      409,
    );
    // Content hashes deduplicate per owner; another account may upload the same public PDF.
    const otherCreated = await expectStatus(
      await request("/api/papers", {
        method: "POST",
        cookie: b.cookie,
        body: upload(bytes),
      }),
      202,
    );
    const other = (await otherCreated.json()) as { paper: { id: string } };
    assert.notEqual(other.paper.id, paper.id);
    const unfiltered = await expectStatus(
      await request("/api/papers?q=&collection=&tag=", { cookie: a.cookie }),
      200,
    );
    assert.deepEqual(
      ((await unfiltered.json()) as { papers: { id: string }[] }).papers.map(
        (item) => item.id,
      ),
      [paper.id],
    );

    const download = await expectStatus(
      await request(`/api/papers/${paper.id}/file`, { cookie: a.cookie }),
      200,
    );
    assert.match(download.headers.get("cache-control") || "", /no-store/);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.deepEqual(
      new Uint8Array(await download.arrayBuffer()),
      new Uint8Array(bytes),
    );
    for (const [path, method, json] of [
      [`/api/papers/${paper.id}`, "GET", undefined],
      [`/api/papers/${paper.id}/file`, "GET", undefined],
      [`/api/papers/${paper.id}`, "PATCH", { title: "Unauthorized" }],
      [`/api/papers/${paper.id}`, "DELETE", undefined],
      [`/api/papers/${paper.id}/retry`, "POST", undefined],
    ] as const)
      await expectStatus(
        await request(path, { method, cookie: b.cookie, json }),
        404,
      );
    await expectStatus(
      await request(`/api/papers/${paper.id}`, {
        method: "DELETE",
        cookie: a.cookie,
        origin: "https://untrusted.example",
      }),
      403,
    );

    const collectionResponse = await expectStatus(
      await request("/api/collections", {
        method: "POST",
        cookie: a.cookie,
        json: { name: "Review sources" },
      }),
      201,
    );
    const { collection } = (await collectionResponse.json()) as {
      collection: { id: string };
    };
    await expectStatus(
      await request(`/api/papers/${other.paper.id}`, {
        method: "PATCH",
        cookie: b.cookie,
        json: { collection_ids: [collection.id] },
      }),
      404,
    );
    await expectStatus(
      await request(`/api/collections/${collection.id}`, {
        method: "DELETE",
        cookie: b.cookie,
      }),
      404,
    );
    await expectStatus(
      await request(`/api/papers/${paper.id}`, {
        method: "PATCH",
        cookie: a.cookie,
        json: {
          title: "Revised quantum study",
          tags: ["retrieval", "evaluation"],
          collection_ids: [collection.id],
        },
      }),
      200,
    );
    const filtered = await expectStatus(
      await request(
        `/api/papers?collection=${collection.id}&tag=retrieval&q=quantum`,
        { cookie: a.cookie },
      ),
      200,
    );
    const listed = (await filtered.json()) as {
      papers: {
        id: string;
        title: string;
        tags: string[];
        collection_ids: string[];
      }[];
    };
    assert.equal(listed.papers.length, 1);
    assert.equal(listed.papers[0].title, "Revised quantum study");
    assert.deepEqual(listed.papers[0].collection_ids, [collection.id]);
    const isolated = await request(`/api/papers?collection=${collection.id}`, {
      cookie: b.cookie,
    });
    assert.deepEqual(
      ((await isolated.json()) as { papers: unknown[] }).papers,
      [],
    );
    const counts = await request("/api/collections", { cookie: a.cookie });
    assert.equal(
      ((await counts.json()) as { collections: { paper_count: number }[] })
        .collections[0].paper_count,
      1,
    );
    await expectStatus(
      await request(`/api/papers/${paper.id}`, {
        method: "PATCH",
        cookie: a.cookie,
        json: { tags: new Array(21).fill("too many") },
      }),
      400,
    );
    await expectStatus(
      await request("/api/papers/not-a-uuid", { cookie: a.cookie }),
      400,
    );
    const invalid = new FormData();
    invalid.set(
      "file",
      new File(["not a PDF"], "fake.pdf", { type: "application/pdf" }),
    );
    await expectStatus(
      await request("/api/papers", {
        method: "POST",
        cookie: a.cookie,
        body: invalid,
      }),
      415,
    );

    await expectStatus(
      await request(`/api/papers/${paper.id}/retry`, {
        method: "POST",
        cookie: a.cookie,
      }),
      409,
    );
    await db.query(
      "UPDATE papers SET status='failed',error='Test failure' WHERE id=$1 AND user_id=$2",
      [paper.id, a.id],
    );
    await db.query(
      "UPDATE jobs SET status='failed',attempts=3 WHERE paper_id=$1",
      [paper.id],
    );
    await expectStatus(
      await request(`/api/papers/${paper.id}/retry`, {
        method: "POST",
        cookie: a.cookie,
      }),
      202,
    );
    const job = await db.query(
      "SELECT status,attempts,error FROM jobs WHERE paper_id=$1",
      [paper.id],
    );
    assert.deepEqual(job.rows[0], {
      status: "queued",
      attempts: 0,
      error: null,
    });
    const graphResponse = await expectStatus(
      await request("/api/graph", { cookie: a.cookie }),
      200,
    );
    const graph = (await graphResponse.json()) as {
      nodes: { id: string }[];
      edges: unknown[];
    };
    assert.deepEqual(
      graph.nodes.map((node) => node.id),
      [paper.id],
    );
    assert.deepEqual(graph.edges, []);

    const conversationId = randomUUID();
    await db.query(
      "INSERT INTO conversations(id,user_id,title,mode,paper_ids) VALUES($1,$2,'Security test','chat',$3)",
      [conversationId, a.id, [paper.id]],
    );
    for (const method of ["GET", "DELETE"])
      await expectStatus(
        await request(`/api/conversations/${conversationId}`, {
          method,
          cookie: b.cookie,
        }),
        404,
      );
    await expectStatus(
      await request(`/api/conversations/${conversationId}`, {
        cookie: a.cookie,
      }),
      200,
    );
    await expectStatus(
      await request(`/api/collections/${collection.id}`, {
        method: "DELETE",
        cookie: a.cookie,
      }),
      204,
    );
    const afterCollectionDelete = await request(`/api/papers/${paper.id}`, {
      cookie: a.cookie,
    });
    assert.deepEqual(
      (
        (await afterCollectionDelete.json()) as {
          paper: { collection_ids: string[] };
        }
      ).paper.collection_ids,
      [],
    );
    await expectStatus(
      await request(`/api/papers/${paper.id}`, {
        method: "DELETE",
        cookie: a.cookie,
      }),
      204,
    );
    for (const suffix of ["", "/file"])
      await expectStatus(
        await request(`/api/papers/${paper.id}${suffix}`, { cookie: a.cookie }),
        404,
      );
    const staleSelection = await db.query(
      "SELECT paper_ids FROM conversations WHERE id=$1",
      [conversationId],
    );
    assert.deepEqual(staleSelection.rows[0].paper_ids, []);
    const jobs = await db.query("SELECT id FROM jobs WHERE paper_id=$1", [
      paper.id,
    ]);
    assert.equal(jobs.rows.length, 0);
    await expectStatus(
      await request(`/api/papers/${other.paper.id}`, { cookie: b.cookie }),
      200,
    );
    await expectStatus(
      await request("/api/auth/logout", { method: "POST", cookie: a.cookie }),
      200,
    );
    await expectStatus(await request("/api/papers", { cookie: a.cookie }), 401);
    console.log(
      "API security checks passed: uploads, authentication, ownership, CSRF, collections, retry, graph, and deletion.",
    );
  } finally {
    await db.query("DELETE FROM users WHERE email=ANY($1::text[])", [emails]);
    for (const id of userIds)
      await db.query("DELETE FROM rate_limits WHERE key LIKE $1", [`%:${id}`]);
    await db.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runApiSecurityChecks().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
