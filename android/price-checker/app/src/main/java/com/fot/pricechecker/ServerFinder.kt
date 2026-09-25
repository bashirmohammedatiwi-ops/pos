package com.fot.pricechecker

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

object ServerFinder {
    private const val DISCOVERY_PORT = 49500
    private const val PROBE = "FOT-POS?"
    private val KNOWN_PREFIXES = arrayOf("192.168.75.", "192.168.68.", "192.168.1.", "10.0.0.")

    /** Fast path: default/saved IP first. Full discovery only when user taps search. */
    fun find(context: Context, force: Boolean = false): String {
        val saved = Prefs.apiBase(context).trim()
        trySaved(context, saved, if (force) 2 else 3)?.let { return it }
        if (!force) return saved

        waitForLan(context, 4000)
        trySaved(context, saved, 2)?.let { return it }

        val udp = discoverUdp(context, 1800)
        if (!udp.isNullOrBlank() && isFot(context, udp, 1200)) {
            Prefs.setApiBase(context, udp, lock = true)
            return udp
        }

        val default = Prefs.DEFAULT_API.trimEnd('/')
        if (isFot(context, default, 1200)) {
            Prefs.setApiBase(context, default, lock = true)
            return default
        }

        val swept = sweep(context, quick = true)
        if (!swept.isNullOrBlank()) {
            Prefs.setApiBase(context, swept, lock = true)
            return swept
        }
        return saved
    }

    private fun trySaved(context: Context, saved: String, tries: Int): String? {
        if (saved.isBlank()) return null
        repeat(tries) {
            if (isFot(context, saved, 1200)) return saved
            try { Thread.sleep(200) } catch (_: InterruptedException) { return saved }
        }
        return null
    }

    fun isFot(context: Context, base: String, timeoutMs: Int): Boolean {
        val clean = base.trim().trimEnd('/')
        if (clean.isEmpty()) return false
        val t = timeoutMs.coerceIn(200, 3000)
        val ping = httpGet(context, clean, "/api/price-checker/ping", t)
        if (looksFot(ping)) return true
        if (statusOf(ping) == 0) return false
        val info = httpGet(context, clean, "/api/price-checker/catalog/info", t)
        if (looksFot(info)) return true
        val catalog = httpGet(context, clean, "/api/v1/catalog/version", t)
        if (looksFot(catalog)) return true
        if (statusOf(info) == 0) return false
        return looksFot(httpGet(context, clean, "/health", t.coerceAtMost(1000)))
    }

    private fun statusOf(raw: String): Int {
        val nl = raw.indexOf('\n')
        return if (nl < 0) 0 else raw.substring(0, nl).toIntOrNull() ?: 0
    }

    private fun looksFot(raw: String): Boolean {
        val status = statusOf(raw)
        if (status in 200..299) return true
        val body = raw.substringAfter('\n', "")
        return status == 503 && body.contains("status")
    }

    fun httpGet(context: Context, base: String, path: String, timeoutMs: Int): String {
        val clean = base.trim().trimEnd('/')
        if (clean.isEmpty()) return "0\nno-base"
        val p = if (path.startsWith("/")) path else "/$path"
        val t = timeoutMs.coerceIn(200, 30000)
        val viaHttp = httpGetUrl(context, clean + p, t)
        if (looksFot(viaHttp)) return viaHttp
        val hp = hostPort(clean) ?: return viaHttp
        val viaSock = httpGetSocket(hp.first, hp.second, p, t)
        return if (looksFot(viaSock) || statusOf(viaHttp) == 0) viaSock else viaHttp
    }

    private fun hostPort(base: String): Pair<String, Int>? {
        val rest = base.replace(Regex("^https?://"), "")
        val hostPart = rest.substringBefore('/')
        val host = hostPart.substringBefore(':')
        if (host.isBlank()) return null
        val port = hostPart.substringAfter(':', "5000").toIntOrNull() ?: 5000
        return host to port
    }

    private fun httpGetUrl(context: Context, fullUrl: String, timeoutMs: Int): String {
        return try {
            val conn = openConnection(context, URL(fullUrl)) as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.useCaches = false
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Connection", "close")
            conn.setRequestProperty("User-Agent", "FOT-Price-Checker")
            val code = try {
                conn.responseCode
            } catch (e: Exception) {
                conn.disconnect()
                return "0\n" + (e.message ?: "net")
            }
            val stream = if (code >= 400) conn.errorStream ?: conn.inputStream else conn.inputStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            conn.disconnect()
            "$code\n$body"
        } catch (e: Exception) {
            "0\n" + (e.message ?: "net")
        }
    }

    private fun httpGetSocket(host: String, port: Int, path: String, timeoutMs: Int): String {
        val socket = Socket()
        return try {
            val local = deviceIpv4s().firstOrNull { sameSubnet(it, host) }
            if (!local.isNullOrBlank()) {
                try { socket.bind(InetSocketAddress(local, 0)) } catch (_: Exception) {}
            }
            socket.connect(InetSocketAddress(host, port), timeoutMs)
            socket.soTimeout = timeoutMs
            val req = "GET $path HTTP/1.1\r\nHost: $host:$port\r\nAccept: application/json\r\nConnection: close\r\nUser-Agent: FOT-Price-Checker\r\n\r\n"
            socket.getOutputStream().write(req.toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()
            val raw = socket.getInputStream().bufferedReader(Charsets.UTF_8).readText()
            val sep = raw.indexOf("\r\n\r\n")
            val headers = if (sep < 0) raw else raw.substring(0, sep)
            val body = if (sep < 0) "" else raw.substring(sep + 4)
            val status = Regex("""HTTP/\d(?:\.\d)?\s+(\d+)""").find(headers)?.groupValues?.get(1)?.toIntOrNull() ?: 0
            "$status\n$body"
        } catch (e: Exception) {
            "0\n" + (e.message ?: "net")
        } finally {
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun openConnection(context: Context, url: URL): java.net.URLConnection {
        val network = pickLanNetwork(context, url.host)
        if (network != null && Build.VERSION.SDK_INT >= 23) {
            try { return network.openConnection(url) } catch (_: Exception) {}
        }
        return url.openConnection()
    }

    @Suppress("DEPRECATION")
    private fun pickLanNetwork(context: Context, host: String): Network? {
        if (Build.VERSION.SDK_INT < 21) return null
        return try {
            val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            var best: Network? = null
            var bestScore = 99
            for (network in cm.allNetworks) {
                val score = scoreNetwork(cm, network, host)
                if (score < bestScore) {
                    bestScore = score
                    best = network
                }
            }
            best
        } catch (_: Exception) {
            null
        }
    }

    private fun scoreNetwork(cm: ConnectivityManager, network: Network, host: String): Int {
        val caps = cm.getNetworkCapabilities(network) ?: return 90
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
            || caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
        ) return 80
        val eth = caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        val wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        if (!eth && !wifi) return 70
        var same = false
        try {
            val links = cm.getLinkProperties(network)?.linkAddresses ?: emptyList()
            for (link in links) {
                val ip = ipv4String(link.address) ?: continue
                if (sameSubnet(ip, host)) same = true
            }
        } catch (_: Exception) {
        }
        return when {
            same && eth -> 0
            same && wifi -> 1
            eth -> 3
            wifi -> 4
            else -> 10
        }
    }

    fun waitForLan(context: Context, timeoutMs: Int): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs.coerceAtLeast(0)
        while (true) {
            if (hasLan(context)) return true
            if (System.currentTimeMillis() >= deadline) return hasLan(context)
            try { Thread.sleep(300) } catch (_: InterruptedException) { return hasLan(context) }
        }
    }

    fun hasLan(context: Context): Boolean {
        if (deviceIpv4s().isNotEmpty()) return true
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= 21) {
                for (network in cm.allNetworks) {
                    val caps = cm.getNetworkCapabilities(network) ?: continue
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                        || caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    ) return true
                }
            }
            @Suppress("DEPRECATION")
            val info = cm.activeNetworkInfo ?: return false
            @Suppress("DEPRECATION")
            info.isConnected && (info.type == ConnectivityManager.TYPE_ETHERNET
                || info.type == ConnectivityManager.TYPE_WIFI)
        } catch (_: Exception) {
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun discoverUdp(context: Context, timeoutMs: Int): String? {
        var lock: WifiManager.MulticastLock? = null
        var socket: DatagramSocket? = null
        return try {
            try {
                val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                lock = wifi.createMulticastLock("fot-price")
                lock.setReferenceCounted(false)
                lock.acquire()
            } catch (_: Exception) {
            }
            socket = DatagramSocket()
            socket.broadcast = true
            socket.soTimeout = 300
            val probe = PROBE.toByteArray(Charsets.UTF_8)
            val targets = broadcastTargets()
            val buf = ByteArray(4096)
            val deadline = System.currentTimeMillis() + timeoutMs
            var lastSend = 0L
            while (System.currentTimeMillis() < deadline) {
                if (System.currentTimeMillis() - lastSend > 500) {
                    for (host in targets) {
                        try {
                            socket.send(DatagramPacket(probe, probe.size, InetAddress.getByName(host), DISCOVERY_PORT))
                        } catch (_: Exception) {
                        }
                    }
                    lastSend = System.currentTimeMillis()
                }
                try {
                    val pkt = DatagramPacket(buf, buf.size)
                    socket.receive(pkt)
                    val url = parseBeacon(context, String(pkt.data, 0, pkt.length, Charsets.UTF_8))
                    if (!url.isNullOrBlank()) return url
                } catch (_: SocketTimeoutException) {
                } catch (_: Exception) {
                }
            }
            null
        } catch (_: Exception) {
            null
        } finally {
            try { socket?.close() } catch (_: Exception) {}
            try { if (lock?.isHeld == true) lock.release() } catch (_: Exception) {}
        }
    }

    fun deviceIpv4s(): List<String> {
        val out = LinkedHashSet<String>()
        try {
            val ifaces = NetworkInterface.getNetworkInterfaces() ?: return emptyList()
            for (ni in Collections.list(ifaces)) {
                try {
                    if (!ni.isUp || ni.isLoopback) continue
                } catch (_: Exception) {
                    continue
                }
                if (ifaceKind(ni.name ?: "") >= 9) continue
                for (a in try { Collections.list(ni.inetAddresses) } catch (_: Exception) { continue }) {
                    ipv4String(a)?.let { out.add(it) }
                }
            }
        } catch (_: Exception) {
        }
        return out.toList()
    }

    fun sameSubnet(deviceIp: String, serverHost: String): Boolean {
        val d = deviceIp.split('.')
        val s = serverHost.trim().split('.')
        if (d.size != 4 || s.size != 4) return false
        return d[0] == s[0] && d[1] == s[1] && d[2] == s[2]
    }

    fun subnetOk(serverHost: String): Boolean {
        val host = serverHost.trim().replace(Regex("^https?://"), "").split(':')[0]
        if (host.isEmpty()) return false
        return deviceIpv4s().any { sameSubnet(it, host) }
    }

    fun networkDiag(serverHost: String): JSONObject {
        val host = serverHost.trim().replace(Regex("^https?://"), "").split(':')[0]
        val ips = deviceIpv4s()
        return JSONObject().apply {
            put("serverHost", host)
            put("deviceIps", JSONArray(ips))
            put("subnetOk", ips.any { sameSubnet(it, host) })
        }
    }

    private fun parseBeacon(context: Context, text: String): String? {
        if (text.indexOf("FOT-POS") < 0) return null
        val urls = ArrayList<String>()
        try {
            val obj = JSONObject(text)
            if (obj.optString("app") != "FOT-POS") return null
            val arr = obj.optJSONArray("urls") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val url = arr.optString(i)
                if (url.startsWith("http://")) urls.add(url.trimEnd('/'))
            }
            val host = obj.optString("host")
            val port = obj.optInt("port", 5000)
            if (host.isNotBlank()) urls.add(0, "http://$host:$port")
        } catch (_: Exception) {
            Regex("http://[0-9.]+[:][0-9]+").find(text)?.value?.let { urls.add(it) }
        }
        if (urls.isEmpty()) return null
        for (url in urls) {
            val ip = url.replace(Regex("^https?://"), "").split(':')[0]
            if (ip.startsWith("192.168.75")) return url
        }
        return urls[0]
    }

    private fun sweep(context: Context, quick: Boolean): String? {
        val prefixes = LinkedHashSet<String>()
        prefixes.add("192.168.75.")
        if (!quick) for (p in KNOWN_PREFIXES) prefixes.add(p)
        for (p in sweepPrefixes(context)) prefixes.add(p)

        val found = AtomicReference<String?>(null)
        val pool = Executors.newFixedThreadPool(24)
        try {
            for (prefix in prefixes) {
                if (prefix == "192.168.75.") {
                    if (isFot(context, Prefs.DEFAULT_API.trimEnd('/'), 800)) {
                        found.set(Prefs.DEFAULT_API.trimEnd('/'))
                        break
                    }
                }
                val latch = CountDownLatch(254)
                for (i in 1..254) {
                    pool.execute {
                        try {
                            if (found.get() != null) return@execute
                            val url = "http://$prefix$i:5000"
                            if (isFot(context, url, 250)) found.set(url)
                        } finally {
                            latch.countDown()
                        }
                    }
                }
                latch.await(if (quick) 3 else 6, TimeUnit.SECONDS)
                if (found.get() != null) break
            }
        } catch (_: Exception) {
        } finally {
            pool.shutdownNow()
        }
        return found.get()
    }

    @Suppress("DEPRECATION")
    private fun sweepPrefixes(context: Context): List<String> {
        val ranked = LinkedHashMap<String, Int>()
        for (row in lanPrefixes()) ranked[row.first] = minOf(ranked[row.first] ?: 99, row.second)
        try {
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ip = wifi.connectionInfo?.ipAddress ?: 0
            if (ip != 0) {
                val prefix = "${ip and 0xff}.${ip shr 8 and 0xff}.${ip shr 16 and 0xff}."
                if (usablePrefix(prefix)) ranked[prefix] = minOf(ranked[prefix] ?: 99, 2)
            }
        } catch (_: Exception) {
        }
        return ranked.entries.sortedBy { it.value }.map { it.key }
    }

    private fun broadcastTargets(): List<String> {
        val set = LinkedHashSet<String>()
        set.add("255.255.255.255")
        set.add("192.168.75.255")
        for (row in lanPrefixes()) set.add(row.first + "255")
        return set.toList()
    }

    private fun lanPrefixes(): List<Pair<String, Int>> {
        val out = ArrayList<Pair<String, Int>>()
        try {
            val ifaces = NetworkInterface.getNetworkInterfaces() ?: return out
            for (ni in Collections.list(ifaces)) {
                try {
                    if (!ni.isUp || ni.isLoopback) continue
                } catch (_: Exception) {
                    continue
                }
                val kind = ifaceKind(ni.name ?: "")
                if (kind >= 9) continue
                for (a in try { Collections.list(ni.inetAddresses) } catch (_: Exception) { continue }) {
                    val ip = ipv4String(a) ?: continue
                    prefixOf(ip)?.let { out.add(it to kind) }
                }
            }
        } catch (_: Exception) {
        }
        return out.sortedBy { it.second }
    }

    private fun ifaceKind(name: String): Int {
        val n = name.lowercase()
        if (n.startsWith("eth") || n.contains("ethernet") || n.startsWith("lan")) return 0
        if (n.startsWith("en") && !n.startsWith("dummy")) return 1
        if (n.startsWith("wlan") || n.startsWith("wifi") || n.startsWith("wl")) return 2
        if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("wwan")
            || n.startsWith("ppp") || n.startsWith("tun") || n.startsWith("dummy")
            || n.startsWith("lo") || n.startsWith("sit")
        ) return 9
        return 3
    }

    private fun ipv4String(a: InetAddress): String? {
        if (a !is Inet4Address || a.isLoopbackAddress) return null
        val b = a.address ?: return null
        if (b.size != 4) return null
        return "${b[0].toInt() and 0xff}.${b[1].toInt() and 0xff}.${b[2].toInt() and 0xff}.${b[3].toInt() and 0xff}"
    }

    private fun prefixOf(ip: String): String? {
        val p = ip.split('.')
        if (p.size != 4) return null
        val prefix = "${p[0]}.${p[1]}.${p[2]}."
        return if (usablePrefix(prefix)) prefix else null
    }

    private fun usablePrefix(prefix: String): Boolean {
        if (prefix.startsWith("127.")) return false
        if (prefix.startsWith("169.254.")) return false
        return true
    }
}
