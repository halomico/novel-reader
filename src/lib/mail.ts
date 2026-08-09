import net from "node:net";
import tls from "node:tls";

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  username: string;
  password: string;
  from: string;
  replyTo: string;
};

type SmtpSocket = net.Socket | tls.TLSSocket;

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLocaleLowerCase("en-US"));
}

function validMailbox(value: string): boolean {
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}

export function getMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  if (!readBool(env.MAIL_ENABLED, false)) return null;
  const host = (env.SMTP_HOST || "").trim();
  const port = Math.min(Math.max(Math.floor(Number(env.SMTP_PORT || 465)), 1), 65_535);
  const secure = readBool(env.SMTP_SECURE, port === 465);
  const startTls = !secure && readBool(env.SMTP_STARTTLS, true);
  const username = env.SMTP_USER || "";
  const password = env.SMTP_PASSWORD || "";
  const from = (env.MAIL_FROM || "").trim();
  const replyTo = (env.MAIL_REPLY_TO || "").trim();
  if (!host || !username || !password || !validMailbox(from) || (replyTo && !validMailbox(replyTo))) {
    return null;
  }
  return { host, port, secure, startTls, username, password, from, replyTo };
}

export function isMailConfigured(): boolean {
  return getMailConfig() !== null;
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(sanitizeHeader(value), "utf8").toString("base64")}?=`;
}

function base64Lines(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
}

function smtpMessage(input: {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}): string {
  const boundary = `novel-reader-${Date.now().toString(36)}`;
  const headers = [
    `From: <${input.from}>`,
    `To: <${input.to}>`,
    ...(input.replyTo ? [`Reply-To: <${input.replyTo}>`] : []),
    `Subject: ${encodedHeader(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    input.html
      ? `Content-Type: multipart/alternative; boundary="${boundary}"`
      : "Content-Type: text/plain; charset=UTF-8",
    ...(input.html ? [] : ["Content-Transfer-Encoding: base64"]),
  ];
  if (!input.html) return `${headers.join("\r\n")}\r\n\r\n${base64Lines(input.text)}\r\n`;
  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

class SmtpConnection {
  private buffer = "";
  private responses: string[] = [];
  private waiters: Array<(value: string) => void> = [];

  constructor(private socket: SmtpSocket) {
    this.attach(socket);
  }

  replaceSocket(socket: SmtpSocket) {
    this.socket.removeAllListeners("data");
    this.socket = socket;
    this.buffer = "";
    this.attach(socket);
  }

  private attach(socket: SmtpSocket) {
    socket.setTimeout(15_000);
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || "";
      let response = "";
      for (const line of lines) {
        response += `${line}\n`;
        if (/^\d{3} /.test(line)) {
          const completed = response.trimEnd();
          response = "";
          const waiter = this.waiters.shift();
          if (waiter) waiter(completed);
          else this.responses.push(completed);
        }
      }
    });
  }

  read(): Promise<string> {
    const response = this.responses.shift();
    if (response) return Promise.resolve(response);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("SMTP 响应超时")), 15_000);
      this.waiters.push((value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });
  }

  async command(value: string, accepted: readonly number[]): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${value}\r\n`, (error) => error ? reject(error) : resolve());
    });
    const response = await this.read();
    const code = Number(response.slice(0, 3));
    if (!accepted.includes(code)) {
      throw new Error(`SMTP 命令失败（${code || "unknown"}）`);
    }
    return response;
  }

  writeMessage(message: string): Promise<void> {
    const stuffed = message.replace(/(^|\r\n)\./g, "$1..");
    return new Promise((resolve, reject) => {
      this.socket.write(`${stuffed}\r\n.\r\n`, (error) => error ? reject(error) : resolve());
    });
  }

  close() {
    this.socket.end();
  }
}

function connectPlain(config: MailConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function connectSecure(config: MailConfig, socket?: net.Socket): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      host: socket ? undefined : config.host,
      port: socket ? undefined : config.port,
      socket,
      servername: config.host,
      minVersion: "TLSv1.2",
    });
    secureSocket.once("secureConnect", () => resolve(secureSocket));
    secureSocket.once("error", reject);
  });
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const config = getMailConfig();
  if (!config) throw new Error("邮件服务未配置");
  const to = input.to.trim().toLocaleLowerCase("en-US");
  if (!validMailbox(to)) throw new Error("收件邮箱无效");

  let socket: SmtpSocket = config.secure ? await connectSecure(config) : await connectPlain(config);
  const connection = new SmtpConnection(socket);
  try {
    const greeting = await connection.read();
    if (!greeting.startsWith("220")) throw new Error("SMTP 服务未就绪");
    await connection.command(`EHLO ${process.env.SMTP_HELO_NAME || "novel-reader.local"}`, [250]);
    if (config.startTls) {
      await connection.command("STARTTLS", [220]);
      socket = await connectSecure(config, socket as net.Socket);
      connection.replaceSocket(socket);
      await connection.command(`EHLO ${process.env.SMTP_HELO_NAME || "novel-reader.local"}`, [250]);
    }
    const auth = Buffer.from(`\u0000${config.username}\u0000${config.password}`, "utf8").toString("base64");
    await connection.command(`AUTH PLAIN ${auth}`, [235]);
    await connection.command(`MAIL FROM:<${config.from}>`, [250]);
    await connection.command(`RCPT TO:<${to}>`, [250, 251]);
    await connection.command("DATA", [354]);
    await connection.writeMessage(smtpMessage({
      from: config.from,
      to,
      replyTo: config.replyTo || undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
    }));
    const accepted = await connection.read();
    if (!accepted.startsWith("250")) throw new Error("SMTP 未接受邮件");
    await connection.command("QUIT", [221]);
  } finally {
    connection.close();
  }
}
