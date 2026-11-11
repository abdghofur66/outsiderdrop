package com.outsiderdev.drop

import android.Manifest
import android.app.DownloadManager
import android.content.Intent
import android.os.StrictMode
import android.webkit.MimeTypeMap
import android.widget.Toast
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var server: LocalServer
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        // parseResult bawaan hanya membaca satu file; pilihan banyak file ada di clipData
        val uris = mutableListOf<Uri>()
        val data = r.data
        if (r.resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            if (clip != null) for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
            else data.data?.let { uris.add(it) }
        }
        fileCallback?.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
        fileCallback = null
    }

    private val scanQr = registerForActivityResult(ScanContract()) { r ->
        val text = r.contents ?: return@registerForActivityResult
        join(text)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT < 29) StrictMode.setVmPolicy(StrictMode.VmPolicy.Builder().build())
        server = shared ?: LocalServer(applicationContext).also { it.start(); shared = it }
        // izinkan aplikasi menerima siaran pencarian host di WiFi
        try {
            val wm = applicationContext.getSystemService(WIFI_SERVICE) as android.net.wifi.WifiManager
            wm.createMulticastLock("outsiderdrop").apply { setReferenceCounted(false); acquire() }
        } catch (_: Exception) { }

        if (Build.VERSION.SDK_INT < 29 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)
        }

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
        }
        web.webViewClient = WebViewClient()
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try {
                    val intent = params.createIntent()
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(android.content.Intent.EXTRA_ALLOW_MULTIPLE, true)
                    pickFiles.launch(intent); true
                } catch (_: Exception) { fileCallback = null; false }
            }
        }
        web.addJavascriptInterface(Bridge(), "ODApp")
        web.loadUrl(base() + "/start.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.url?.contains("/start.html") == true) finish()
                else web.evaluateJavascript("document.getElementById('leaveBtn')&&!document.getElementById('roomView').hidden?document.getElementById('leaveBtn').click():location.href='/start.html'", null)
            }
        })
    }

    private fun base() = "http://127.0.0.1:${server.port}"

    private fun host() {
        server.hosting = true
        server.signal = ""
        val ip = server.lanIp()
        server.shareUrl = if (ip != null) "http://$ip:${server.port}" else ""
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.loadUrl(base() + "/")
    }

    private fun join(raw: String) {
        var a = raw.trim().removePrefix("http://").removePrefix("https://").substringBefore('/').substringBefore('?')
        if (a.isEmpty()) return
        if (!a.contains(':')) a += ":8080"
        server.hosting = false
        server.signal = a
        server.shareUrl = "http://$a"
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.loadUrl(base() + "/")
    }

    private fun openFile(id: String) {
        val (uri, file) = server.saved[id] ?: return toast("File tidak ditemukan")
        val target = uri ?: file?.let { Uri.fromFile(it) } ?: return
        val type = contentResolver.getType(target)
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(target.toString()).lowercase())
            ?: "*/*"
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(target, type)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try { startActivity(i) } catch (_: Exception) { toast("Tidak ada aplikasi untuk membuka file ini") }
    }

    private fun openFolder() {
        // Buka folder Download/OutsiderDrop di aplikasi File; bila tidak didukung, buka daftar Unduhan
        val doc = Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload%2FOutsiderDrop")
        val tries = listOf(
            Intent(Intent.ACTION_VIEW).setDataAndType(doc, "vnd.android.document/directory"),
            Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)
        )
        for (i in tries) {
            try { startActivity(i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) { }
        }
        toast("Buka aplikasi File, lalu masuk ke Download/OutsiderDrop")
    }

    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()

    inner class Bridge {
        @JavascriptInterface fun host() = runOnUiThread { this@MainActivity.host() }
        @JavascriptInterface fun join(addr: String) = runOnUiThread { this@MainActivity.join(addr) }
        @JavascriptInterface fun scan() = runOnUiThread {
            scanQr.launch(ScanOptions().setPrompt("Pindai QR dari perangkat host").setBeepEnabled(false).setOrientationLocked(false))
        }
        @JavascriptInterface fun leave() = runOnUiThread {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        @JavascriptInterface fun openFile(id: String) = runOnUiThread { this@MainActivity.openFile(id) }
        @JavascriptInterface fun openFolder(id: String) = runOnUiThread { this@MainActivity.openFolder() }
        @JavascriptInterface fun info(): String =
            JSONObject().put("ip", server.lanIp() ?: "").put("port", server.port).toString()
    }

    companion object { private var shared: LocalServer? = null }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
