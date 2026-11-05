package com.outsiderdev.drop

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.concurrent.thread

/**
 * Server lokal di dalam aplikasi:
 * - menyajikan tampilan web (assets)
 * - signaling WebSocket untuk WebRTC (saat menjadi host)
 * - /save/... menulis file masuk langsung ke Download/OutsiderDrop (hanya dari HP ini sendiri)
 */
class LocalServer(private val ctx: Context) {
    @Volatile var port = 8080; private set
    @Volatile var signal = ""      // kosong = HP ini host; isi "ip:port" = gabung ke host lain
    @Volatile var shareUrl = ""
    private var server: ServerSocket? = null
    private val rooms = ConcurrentHashMap<String, CopyOnWriteArraySet<Client>>()
    private val saves = ConcurrentHashMap<String, Sink>()

    fun start() {
        if (server != null) return
        for (p in 8080..8100) {
            try {
                val s = ServerSocket()
                s.reuseAddress = true
                s.bind(InetSocketAddress("0.0.0.0", p))
                server = s; port = p; break
            } catch (_: Exception) { }
        }
        val s = server ?: return
        thread(name = "od-accept", isDaemon = true) {
            while (!s.isClosed) {
                val sock = try { s.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) { try { handle(sock) } catch (_: Exception) { } finally { } }
            }
        }
    }

    fun lanIp(): String? {
        val ips = mutableListOf<String>()
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp || ni.isLoopback) continue
                for (a in ni.inetAddresses) if (a is Inet4Address && !a.isLoopbackAddress) ips.add(a.hostAddress ?: continue)
            }
        } catch (_: Exception) { }
        return ips.firstOrNull { it.startsWith("192.168.") } ?: ips.firstOrNull { it.startsWith("10.") } ?: ips.firstOrNull()
    }

    // ---------------- HTTP ----------------
    private class Req(val method: String, val path: String, val query: Map<String, String>, val headers: Map<String, String>)

    private fun readHead(input: InputStream): Req? {
        val buf = ByteArrayOutputStream()
        var last4 = 0
        while (true) {
            val b = input.read()
            if (b < 0) return null
            buf.write(b)
            last4 = (last4 shl 8) or b
            if (last4 == 0x0D0A0D0A) break
            if (buf.size() > 16384) return null
        }
        val lines = buf.toString("UTF-8").split("\r\n")
        val parts = lines[0].split(" ")
        if (parts.size < 2) return null
        val full = parts[1]
        val qi = full.indexOf('?')
        val path = URLDecoder.decode(if (qi >= 0) full.substring(0, qi) else full, "UTF-8")
        val query = mutableMapOf<String, String>()
        if (qi >= 0) for (kv in full.substring(qi + 1).split("&")) {
            val i = kv.indexOf('=')
            if (i > 0) query[URLDecoder.decode(kv.substring(0, i), "UTF-8")] = URLDecoder.decode(kv.substring(i + 1), "UTF-8")
        }
        val headers = mutableMapOf<String, String>()
        for (l in lines.drop(1)) { val i = l.indexOf(':'); if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim() }
        return Req(parts[0], path, query, headers)
    }

    private fun respond(out: OutputStream, code: Int, type: String, body: ByteArray) {
        val status = when (code) { 200 -> "OK"; 403 -> "Forbidden"; 404 -> "Not Found"; else -> "Error" }
        out.write(("HTTP/1.1 $code $status\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\n" +
                "Cache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray())
        out.write(body); out.flush()
    }

    private fun handle(sock: Socket) {
        sock.tcpNoDelay = true
        val input = BufferedInputStream(sock.getInputStream(), 65536)
        val out = sock.getOutputStream()
        val req = readHead(input) ?: return sock.close()
        val loopback = sock.inetAddress.isLoopbackAddress

        val ws = Regex("^/ws/([A-Za-z0-9]{4,12})$").find(req.path)
        if (ws != null && req.headers["upgrade"]?.lowercase() == "websocket") {
            return webSocket(sock, input, out, req, ws.groupValues[1].uppercase())
        }
        try {
            when {
                req.path == "/config.json" -> {
                    val j = JSONObject()
                        .put("mode", "local").put("room", "LOKAL").put("app", true)
                        .put("signal", signal).put("url", shareUrl)
                        .put("save", loopback).put("saveDir", "Download/OutsiderDrop")
                    respond(out, 200, "application/json", j.toString().toByteArray())
                }
                req.path.startsWith("/save/") -> handleSave(req, input, out, loopback)
                else -> serveAsset(req.path, out)
            }
        } finally { try { sock.close() } catch (_: Exception) { } }
    }

    private fun serveAsset(p: String, out: OutputStream) {
        var name = p.trimStart('/')
        if (name.isEmpty() || name.endsWith("/")) name += "index.html"
        if (name.contains("..")) return respond(out, 403, "text/plain", ByteArray(0))
        val bytes = try { ctx.assets.open(name).use { it.readBytes() } } catch (_: Exception) {
            name = "index.html"; ctx.assets.open(name).use { it.readBytes() }
        }
        val type = when (name.substringAfterLast('.', "")) {
            "html" -> "text/html; charset=utf-8"; "js" -> "text/javascript"; "css" -> "text/css"
            "json" -> "application/json"; "webmanifest" -> "application/manifest+json"
            "svg" -> "image/svg+xml"; "png" -> "image/png"; else -> "application/octet-stream"
        }
        respond(out, 200, type, bytes)
    }

    // ---------------- Simpan ke Download/OutsiderDrop ----------------
    private class Sink(val stream: OutputStream, val uri: Uri?, val file: File?)

    private fun cleanSeg(s: String) = s.replace(Regex("[\\\\:*?\"<>|]"), "_").split("/").filter { it.isNotBlank() && it != "." && it != ".." }

    private fun handleSave(req: Req, input: InputStream, out: OutputStream, loopback: Boolean) {
        if (req.method != "POST" || !loopback) return respond(out, 403, "text/plain", ByteArray(0))
        val op = req.path.removePrefix("/save/")
        val id = req.query["id"] ?: return respond(out, 404, "text/plain", ByteArray(0))
        val len = req.headers["content-length"]?.toLongOrNull() ?: 0L
        when (op) {
            "open" -> {
                skip(input, len)
                val sub = cleanSeg(req.query["path"] ?: "").joinToString("/")
                val name = cleanSeg(req.query["name"] ?: "file").joinToString("_").ifEmpty { "file" }
                saves[id] = openSink(sub, name)
            }
            "append" -> {
                val sink = saves[id] ?: return respond(out, 404, "text/plain", ByteArray(0))
                val buf = ByteArray(65536); var left = len
                while (left > 0) {
                    val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (n < 0) break
                    sink.stream.write(buf, 0, n); left -= n
                }
            }
            "close", "abort" -> {
                skip(input, len)
                val sink = saves.remove(id) ?: return respond(out, 404, "text/plain", ByteArray(0))
                try { sink.stream.close() } catch (_: Exception) { }
                if (op == "abort") {
                    sink.uri?.let { ctx.contentResolver.delete(it, null, null) }
                    sink.file?.delete()
                } else if (sink.uri != null && Build.VERSION.SDK_INT >= 29) {
                    val v = ContentValues(); v.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    ctx.contentResolver.update(sink.uri, v, null, null)
                }
            }
            else -> return respond(out, 404, "text/plain", ByteArray(0))
        }
        respond(out, 200, "text/plain", "ok".toByteArray())
    }

    private fun skip(input: InputStream, len: Long) { var l = len; while (l > 0) { val n = input.skip(l); if (n <= 0) break; l -= n } }

    private fun openSink(sub: String, name: String): Sink {
        val rel = "OutsiderDrop" + if (sub.isNotEmpty()) "/$sub" else ""
        if (Build.VERSION.SDK_INT >= 29) {
            val v = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + rel)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
                ?: throw IllegalStateException("Tidak bisa membuat file")
            val os = ctx.contentResolver.openOutputStream(uri) ?: throw IllegalStateException("Tidak bisa menulis")
            return Sink(os.buffered(1 shl 20), uri, null)
        }
        @Suppress("DEPRECATION")
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), rel)
        dir.mkdirs()
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var f = File(dir, name); var i = 1
        while (f.exists()) f = File(dir, "$base (${i++})$ext")
        return Sink(FileOutputStream(f).buffered(1 shl 20), null, f)
    }

    // ---------------- WebSocket signaling ----------------
    private inner class Client(val sock: Socket, val out: OutputStream, val id: String, val name: String, val os: String) {
        fun info(): JSONObject = JSONObject().put("id", id).put("name", name).put("os", os)
        @Synchronized fun send(text: String) {
            try {
                val p = text.toByteArray()
                val head = when {
                    p.size < 126 -> byteArrayOf(0x81.toByte(), p.size.toByte())
                    p.size < 65536 -> byteArrayOf(0x81.toByte(), 126, (p.size shr 8).toByte(), p.size.toByte())
                    else -> ByteArray(10).also { h -> h[0] = 0x81.toByte(); h[1] = 127; for (i in 0 until 8) h[9 - i] = (p.size.toLong() shr (8 * i)).toByte() }
                }
                out.write(head); out.write(p); out.flush()
            } catch (_: Exception) { }
        }
    }

    private fun webSocket(sock: Socket, input: InputStream, out: OutputStream, req: Req, code: String) {
        val key = req.headers["sec-websocket-key"] ?: return sock.close()
        val accept = android.util.Base64.encodeToString(
            MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray()),
            android.util.Base64.NO_WRAP)
        out.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n\r\n".toByteArray())
        out.flush()
        sock.tcpNoDelay = true

        val room = rooms.getOrPut(code) { CopyOnWriteArraySet() }
        val me = Client(sock, out, UUID.randomUUID().toString().take(8),
            (req.query["name"] ?: "Perangkat").take(40), (req.query["os"] ?: "").take(20))
        val peers = JSONArray(); room.forEach { peers.put(it.info()) }
        me.send(JSONObject().put("type", "welcome").put("id", me.id).put("peers", peers).toString())
        val join = JSONObject().put("type", "join").put("peer", me.info()).toString()
        room.forEach { it.send(join) }
        room.add(me)

        val frag = ByteArrayOutputStream()
        try {
            while (true) {
                val b0 = input.read(); val b1 = input.read()
                if (b0 < 0 || b1 < 0) break
                val fin = b0 and 0x80 != 0; val op = b0 and 0x0f; val masked = b1 and 0x80 != 0
                var len = (b1 and 0x7f).toLong()
                if (len == 126L) len = ((input.read() shl 8) or input.read()).toLong()
                else if (len == 127L) { len = 0; repeat(8) { len = (len shl 8) or input.read().toLong() } }
                val mask = ByteArray(4); if (masked) readFully(input, mask)
                if (len > 8_000_000) break
                val data = ByteArray(len.toInt()); readFully(input, data)
                if (masked) for (i in data.indices) data[i] = (data[i].toInt() xor mask[i and 3].toInt()).toByte()
                when (op) {
                    0x8 -> break
                    0x9 -> synchronized(me) { out.write(byteArrayOf(0x8a.toByte(), data.size.toByte())); out.write(data); out.flush() }
                    0x0, 0x1 -> { frag.write(data); if (fin) { onText(me, room, frag.toString("UTF-8")); frag.reset() } }
                }
            }
        } catch (_: Exception) { }
        room.remove(me)
        val leave = JSONObject().put("type", "leave").put("id", me.id).toString()
        room.forEach { it.send(leave) }
        if (room.isEmpty()) rooms.remove(code)
        try { sock.close() } catch (_: Exception) { }
    }

    private fun readFully(input: InputStream, b: ByteArray) {
        var off = 0
        while (off < b.size) { val n = input.read(b, off, b.size - off); if (n < 0) throw java.io.EOFException(); off += n }
    }

    private fun onText(me: Client, room: Set<Client>, raw: String) {
        val m = try { JSONObject(raw) } catch (_: Exception) { return }
        if (m.optString("type") == "ping") return me.send("{\"type\":\"pong\"}")
        val to = m.optString("to"); if (to.isEmpty()) return
        m.put("from", me.id)
        val s = m.toString()
        room.firstOrNull { it.id == to }?.send(s)
    }
}
