import http from "node:http";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash
} from "node:crypto";
import { promisify } from "node:util";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { members, months, schoolYear } from "./lib/roster.mjs";
import { openDatabase, configurationError } from "./lib/database.mjs";

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const sessionDuration = 8 * 60 * 60 * 1000;
const memberIds = new Set(members.map((member) => member.id));
const monthIds = new Set(months.map((month) => month.id));
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

async function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

export async function createApp(options = {}) {
  const serverless = options.serverless ?? process.env.VERCEL === '1';
  const secureCookie =
    options.secureCookie ?? (serverless || process.env.COOKIE_SECURE === "true");
  const appOrigin = options.appOrigin || process.env.APP_ORIGIN;
  const { db, bootstrapPath, remote } = await openDatabase(options);
  try {
  await db.batch(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payments (
      year INTEGER NOT NULL, member_id TEXT NOT NULL, month TEXT NOT NULL,
      paid INTEGER NOT NULL CHECK(paid IN (0, 1)), version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL, PRIMARY KEY (year, member_id, month)
    );
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL,
      member_id TEXT NOT NULL, month TEXT NOT NULL, paid INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_attempts (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL
    );
  `.split(';').map((sql) => sql.trim()).filter(Boolean));

  if (
    !(await db.prepare("SELECT value FROM settings WHERE key = 'admin_hash'").get())
  ) {
    const supplied = options.adminPassword || process.env.ADMIN_PASSWORD;
    if (remote && !supplied)
      throw configurationError('ADMIN_NOT_CONFIGURED', 'Yangi baza uchun ADMIN_PASSWORD sozlanishi kerak (12–128 belgi).');
    if (supplied && (supplied.length < 12 || supplied.length > 128)) {
      throw configurationError('ADMIN_NOT_CONFIGURED', "ADMIN_PASSWORD 12–128 belgidan iborat bo‘lishi kerak.");
    }
    const password = supplied || randomBytes(18).toString("base64url");
    const inserted = await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(
      "admin_hash",
      await passwordHash(password)
    );
    if (!supplied && bootstrapPath && inserted.rowsAffected)
      writeFileSync(
        bootstrapPath,
        `11-B fond — admin uchun boshlang‘ich parol\n\n${password}\n\nSaytga kirgach, admin menyusidan parolni almashtiring.\n`,
        { mode: 0o600 }
      );
  }
  } catch (error) {
    db.close();
    throw error;
  }

  const currentHash = async (connection = db) =>
    (await connection.prepare("SELECT value FROM settings WHERE key = 'admin_hash'").get()).value;
  async function session(req, connection = db) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("fond_session="))
      ?.slice(13);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return (
      await connection
        .prepare(
          "SELECT token_hash, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?"
        )
        .get(digest(token), Date.now()) || null
    );
  }
  const cookie = (token, seconds = sessionDuration / 1000) =>
    `fond_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secureCookie ? "; Secure" : ""}`;
  function send(res, status, data, headers = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    });
    res.end(JSON.stringify(data));
  }
  function fail(status, message) {
    return Object.assign(new Error(message), { status });
  }
  async function body(req) {
    if (
      !req.headers["content-type"]?.toLowerCase().startsWith("application/json")
    )
      throw fail(415, "JSON ma’lumot yuboring.");
    // Vercel may parse the JSON body before calling a Node.js function.
    if (req.body !== undefined) {
      const parsed = typeof req.body === 'string' ? (() => {
        try { return JSON.parse(req.body); } catch { throw fail(400, 'Ma’lumot shakli noto‘g‘ri.'); }
      })() : req.body;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw fail(400, 'Ma’lumot shakli noto‘g‘ri.');
      if (Buffer.byteLength(JSON.stringify(parsed)) > 8192) throw fail(413, 'So‘rov juda katta.');
      return parsed;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw fail(413, "So‘rov juda katta.");
      chunks.push(chunk);
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      return parsed;
    } catch {
      throw fail(400, "Ma’lumot shakli noto‘g‘ri.");
    }
  }
  function validYear(value) {
    return Number.isInteger(value) && value >= 2020 && value <= 2100;
  }
  const attemptKey = (req) => `ip:${digest(serverless
    ? String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
    : req.socket?.remoteAddress || 'unknown')}`;
  async function consumeAttempt(req) {
    const now = Date.now();
    const rows = await db.batch([
      { sql: 'DELETE FROM auth_attempts WHERE until <= ?', args: [now] },
      { sql: 'DELETE FROM sessions WHERE expires_at <= ?', args: [now] },
      ...[attemptKey(req), 'global'].map((key) => ({
        sql: 'INSERT INTO auth_attempts (key, count, until) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count',
        args: [key, now + 15 * 60_000],
      })),
    ]);
    if (rows[2].rows[0].count > 5 || rows[3].rows[0].count > 100)
      throw fail(
        429,
        "Urinishlar ko‘payib ketdi. 15 daqiqadan keyin qayta urinib ko‘ring."
      );
  }
  async function state(year) {
    const [paymentResult, yearResult, activityResult] = await db.batch([
      { sql: 'SELECT member_id, month, paid, version, updated_at FROM payments WHERE year = ?', args: [year] },
      'SELECT DISTINCT year FROM payments',
      { sql: 'SELECT id, member_id AS memberId, month, paid, created_at AS createdAt FROM activity WHERE year = ? ORDER BY id DESC LIMIT 100', args: [year] },
    ], 'read');
    const rows = paymentResult.rows;
    const payments = {};
    for (const row of rows)
      payments[`${row.member_id}:${row.month}`] = {
        paid: Boolean(row.paid),
        version: row.version,
        updatedAt: row.updated_at
      };
    const currentYear = schoolYear();
    const storedYears = yearResult.rows.map((row) => row.year);
    return {
      members,
      months,
      year,
      currentYear,
      years: [
        ...new Set([
          currentYear - 1,
          currentYear,
          currentYear + 1,
          year,
          ...storedYears
        ])
      ].sort((a, b) => b - a),
      payments,
      activity: activityResult.rows,
      lastUpdated:
        rows
          .map((row) => row.updated_at)
          .sort()
          .at(-1) || null
    };
  }

  const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/favicon.svg", ["favicon.svg", "image/svg+xml"]]
  ]);
  const handler = async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (!["GET", "HEAD"].includes(req.method)) {
        const origin = req.headers.origin;
        const expected =
          appOrigin ||
          `${secureCookie ? "https" : "http"}://${req.headers.host}`;
        if (
          !origin ||
          origin !== expected ||
          req.headers["sec-fetch-site"] === "cross-site"
        )
          throw fail(403, "Bu manzildan o‘zgartirishga ruxsat yo‘q.");
      }
      if (url.pathname === "/api/session" && req.method === "GET") {
        return send(res, 200, { admin: Boolean(await session(req)) });
      }
      if (url.pathname === "/api/state" && req.method === "GET") {
        const year = url.searchParams.has("year")
          ? Number(url.searchParams.get("year"))
          : schoolYear();
        if (!validYear(year)) throw fail(400, "O‘quv yili noto‘g‘ri.");
        return send(res, 200, await state(year));
      }
      if (url.pathname === "/api/login" && req.method === "POST") {
        await consumeAttempt(req);
        const { password } = await body(req);
        const checkedHash = await currentHash();
        if (
          typeof password !== "string" ||
          password.length > 128 ||
          !(await passwordMatches(password, checkedHash))
        )
          throw fail(401, "Parol noto‘g‘ri. Qayta tekshiring.");
        const token = randomBytes(32).toString("hex");
        const tx = await db.transaction();
        try {
          if (await currentHash(tx) !== checkedHash) throw fail(401, 'Parol o‘zgartirilgan. Qayta kiring.');
          const previous = await session(req, tx);
          if (previous) await tx.prepare('DELETE FROM sessions WHERE token_hash = ?').run(previous.token_hash);
          await tx.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(digest(token), Date.now() + sessionDuration);
          await tx.prepare('DELETE FROM auth_attempts WHERE key = ?').run(attemptKey(req));
          await tx.commit();
        } catch (error) { await tx.rollback(); throw error; }
        finally { tx.close(); }
        return send(res, 200, { admin: true }, { "Set-Cookie": cookie(token) });
      }
      if (url.pathname === "/api/logout" && req.method === "POST") {
        const active = await session(req);
        if (active)
          await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
            active.token_hash
          );
        return send(
          res,
          200,
          { admin: false },
          { "Set-Cookie": cookie("", 0) }
        );
      }
      if (url.pathname === "/api/password" && req.method === "POST") {
        const active = await session(req);
        if (!active) throw fail(401, "Avval admin sifatida kiring.");
        await consumeAttempt(req);
        const { currentPassword, newPassword } = await body(req);
        const checkedHash = await currentHash();
        if (
          typeof currentPassword !== "string" ||
          currentPassword.length > 128 ||
          !(await passwordMatches(currentPassword, checkedHash))
        )
          throw fail(401, "Joriy parol noto‘g‘ri.");
        if (
          typeof newPassword !== "string" ||
          newPassword.length < 12 ||
          newPassword.length > 128
        )
          throw fail(400, "Yangi parol 12–128 belgidan iborat bo‘lsin.");
        const hash = await passwordHash(newPassword);
        const tx = await db.transaction();
        try {
          if (!(await session(req, tx)) || await currentHash(tx) !== checkedHash)
            throw fail(401, 'Hisob o‘zgargan. Qayta kiring.');
          await tx.prepare(
            "UPDATE settings SET value = ? WHERE key = 'admin_hash'"
          ).run(hash);
          await tx.prepare("DELETE FROM sessions WHERE token_hash != ?").run(
            active.token_hash
          );
          await tx.prepare('DELETE FROM auth_attempts WHERE key = ?').run(attemptKey(req));
          await tx.commit();
        } catch (error) {
          await tx.rollback();
          throw error;
        } finally { tx.close(); }
        if (bootstrapPath && existsSync(bootstrapPath)) unlinkSync(bootstrapPath);
        return send(res, 200, { success: true });
      }
      if (url.pathname === "/api/payments" && req.method === "PATCH") {
        if (!(await session(req)))
          throw fail(401, "To‘lovlarni faqat admin o‘zgartira oladi.");
        const { memberId, month, year, paid, version } = await body(req);
        if (
          !memberIds.has(memberId) ||
          !monthIds.has(month) ||
          !validYear(year) ||
          typeof paid !== "boolean" ||
          !Number.isInteger(version) ||
          version < 0
        )
          throw fail(400, "To‘lov ma’lumotlarini tekshiring.");
        const tx = await db.transaction();
        try {
          if (!(await session(req, tx))) throw fail(401, 'Avval admin sifatida kiring.');
          const previous = await tx
            .prepare(
              "SELECT paid, version FROM payments WHERE year = ? AND member_id = ? AND month = ?"
            )
            .get(year, memberId, month);
          if ((previous?.version || 0) !== version)
            throw fail(
              409,
              "Bu katak boshqa oynada o‘zgargan. Jadval yangilandi, qayta tanlang."
            );
          if (Boolean(previous?.paid) !== paid) {
            const now = new Date().toISOString();
            await tx.prepare(
              `INSERT INTO payments (year, member_id, month, paid, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(year, member_id, month) DO UPDATE SET paid = excluded.paid, version = excluded.version, updated_at = excluded.updated_at`
            ).run(year, memberId, month, Number(paid), version + 1, now);
            await tx.prepare(
              "INSERT INTO activity (year, member_id, month, paid, created_at) VALUES (?, ?, ?, ?, ?)"
            ).run(year, memberId, month, Number(paid), now);
          }
          await tx.commit();
        } catch (error) {
          await tx.rollback();
          throw error;
        } finally { tx.close(); }
        return send(res, 200, await state(year));
      }
      if (url.pathname.startsWith("/api/"))
        throw fail(404, "Bunday so‘rov topilmadi.");
      const file = staticFiles.get(url.pathname);
      if (file && ["GET", "HEAD"].includes(req.method)) {
        const content = readFileSync(path.join(root, "public", file[0]));
        res.writeHead(200, {
          "Content-Type": file[1],
          "Cache-Control": "no-cache",
          "Content-Length": content.length
        });
        return res.end(req.method === "HEAD" ? undefined : content);
      }
      throw fail(404, "Sahifa topilmadi.");
    } catch (error) {
      if (!error.status) console.error("Server error:", error.code || error.name);
      if (!res.headersSent)
        send(res, error.status || 500, {
          error: error.status
            ? error.message
            : "Serverda xatolik. Qayta urinib ko‘ring."
        });
      else res.end();
    }
  };
  const server = http.createServer(handler);
  server.on("close", () => {
    db.close();
  });
  return { server, handler, bootstrapPath, close: () => db.close() };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server, bootstrapPath } = await createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`11-B fond: http://${host}:${port}`);
    if (bootstrapPath && existsSync(bootstrapPath))
      console.log(`Admin paroli faqat mahalliy faylda: ${bootstrapPath}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
