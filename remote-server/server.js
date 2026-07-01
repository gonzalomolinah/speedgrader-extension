"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

let extensionClient = null;
let latestState = null;
let latestStatus = null;
const remoteClients = new Set();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(res, {
      ok: true,
      extensionConnected: Boolean(extensionClient),
      remoteClients: remoteClients.size
    });
    return;
  }

  serveStatic(url.pathname, res);
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/extension") {
    if (!isLoopback(req.socket.remoteAddress)) {
      rejectUpgrade(socket, 403, "Extension must connect from localhost");
      return;
    }

    acceptExtension(req, socket);
    return;
  }

  if (url.pathname === "/remote") {
    acceptRemote(req, socket);
    return;
  }

  rejectUpgrade(socket, 404, "Not found");
});

server.listen(PORT, HOST, () => {
  const urls = getPanelUrls();

  console.log("Canvas Corrector remote server");
  urls.forEach((url) => console.log(`Panel: ${url}`));
  console.log("Keep this process running while using remote mode.");
});

function acceptExtension(req, socket) {
  completeHandshake(req, socket);

  if (extensionClient) {
    extensionClient.close();
  }

  extensionClient = createWsClient(socket, "extension");
  extensionClient.send({
    type: "server:hello",
    urls: getPanelUrls()
  });
  notifyRemoteCount();

  extensionClient.onMessage = (message) => {
    if (message.type === "extension:state") {
      latestState = message.state || null;
      broadcastRemotes(message);
      return;
    }

    if (message.type === "extension:status") {
      latestStatus = message.status || null;
      broadcastRemotes(message);
    }
  };

  extensionClient.onClose = () => {
    if (extensionClient?.socket === socket) {
      extensionClient = null;
    }

    broadcastRemotes({
      type: "server:extension-disconnected"
    });
  };
}

function acceptRemote(req, socket) {
  completeHandshake(req, socket);

  const remote = createWsClient(socket, "remote");
  remoteClients.add(remote);

  remote.send({
    type: "server:hello",
    extensionConnected: Boolean(extensionClient)
  });

  if (latestState) {
    remote.send({
      type: "extension:state",
      state: latestState
    });
  }

  if (latestStatus) {
    remote.send({
      type: "extension:status",
      status: latestStatus
    });
  }

  notifyRemoteCount();

  remote.onMessage = (message) => {
    if (!extensionClient) {
      remote.send({
        type: "server:error",
        message: "La extension no esta conectada."
      });
      return;
    }

    if (
      message.type === "remote:toggleCriterion" ||
      message.type === "remote:clearSelection" ||
      message.type === "remote:insertGrade"
    ) {
      extensionClient.send(message);
    }
  };

  remote.onClose = () => {
    remoteClients.delete(remote);
    notifyRemoteCount();
  };
}

function createWsClient(socket, role) {
  const client = {
    role,
    socket,
    buffer: Buffer.alloc(0),
    onMessage: null,
    onClose: null,
    send(message) {
      if (socket.destroyed) {
        return;
      }

      socket.write(encodeFrame(JSON.stringify(message)));
    },
    close() {
      if (!socket.destroyed) {
        socket.end();
      }
    }
  };

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);

    while (client.buffer.length > 0) {
      let frame = null;

      try {
        frame = decodeFrame(client.buffer);
      } catch (error) {
        socket.destroy();
        return;
      }

      if (!frame) {
        break;
      }

      client.buffer = client.buffer.slice(frame.frameLength);

      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }

      if (frame.opcode === 0x9) {
        socket.write(encodeFrame(frame.payload, 0xA));
        continue;
      }

      if (frame.opcode !== 0x1) {
        continue;
      }

      try {
        const message = JSON.parse(frame.payload.toString("utf8"));
        client.onMessage?.(message);
      } catch (error) {
        client.send({
          type: "server:error",
          message: "Mensaje remoto invalido."
        });
      }
    }
  });

  socket.on("close", () => client.onClose?.());
  socket.on("error", () => client.onClose?.());

  return client;
}

function completeHandshake(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n")
  );
}

function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const length = payload.length;
  let header = null;

  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) === 0x80;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }

    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }

    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Frame too large");
    }

    length = Number(bigLength);
    offset += 8;
  }

  let mask = null;

  if (masked) {
    if (buffer.length < offset + 4) {
      return null;
    }

    mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + length) {
    return null;
  }

  const payload = Buffer.from(buffer.slice(offset, offset + length));

  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    opcode,
    payload,
    frameLength: offset + length
  };
}

function broadcastRemotes(message) {
  remoteClients.forEach((remote) => remote.send(message));
}

function notifyRemoteCount() {
  extensionClient?.send({
    type: "server:remote-count",
    count: remoteClients.size
  });
}

function serveStatic(pathname, res) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.resolve(PUBLIC_DIR, `.${filePath}`);
  const relativePath = path.relative(PUBLIC_DIR, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": getContentType(resolvedPath),
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

function sendJson(res, body) {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function rejectUpgrade(socket, statusCode, message) {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\n\r\n`);
  socket.destroy();
}

function getPanelUrls() {
  const urls = [];
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach((items) => {
    (items || []).forEach((item) => {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${PORT}`);
      }
    });
  });

  urls.push(`http://localhost:${PORT}`);

  return urls;
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";

  return "application/octet-stream";
}

function isLoopback(address) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}
