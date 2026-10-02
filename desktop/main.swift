// Workbench.app: a window around the Workbench server (http://127.0.0.1:<port>).
//
// Two ways to get a server, decided by what is inside the bundle:
//   * embedded (the downloadable app, scripts/macos/package.sh): Contents/Resources/server is a
//     release; the app starts it, owns it and stops it on quit.
//   * dev (`make app`): no server inside; the launchd agent from `make install` is the server,
//     and the app only starts that agent if it isn't running.
// Either way, a server already answering on the port is used as is.
import Cocoa
import WebKit

let label = "dev.workbench.server"
let info = Bundle.main.infoDictionary ?? [:]
let port = ProcessInfo.processInfo.environment["PORT"] ?? info["WBPort"] as? String ?? "4242"  // PORT: only set when started from a terminal
let home = URL(string: "http://127.0.0.1:\(port)")!
let wbHome = ProcessInfo.processInfo.environment["WB_HOME"] ?? NSHomeDirectory() + "/.workbench"
let resources = Bundle.main.resourceURL!
let serverBin = resources.appendingPathComponent("server/bin/workbench")
let embedded = FileManager.default.isExecutableFile(atPath: serverBin.path)
let updateURL = (info["WBUpdateURL"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var booting = true
    var server: Process?
    var stopping = false
    var checkedForUpdate = false

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.mainMenu = makeMenu()

        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "WorkbenchApp"  // the web UI keys off this (see IN_MAC_APP)
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }
        web.allowsBackForwardNavigationGestures = false
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "Workbench"
        window.contentView = web
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 800, height: 500)
        if !window.setFrameUsingName("main") { window.center() }
        window.setFrameAutosaveName("main")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        web.loadHTMLString(Self.page("Starting Workbench…"), baseURL: nil)
        boot()
    }

    // MARK: server

    /// Wait for the server, starting it first if nothing answers.
    func boot() {
        DispatchQueue.global().async {
            var started = false
            for i in 0..<120 {
                if Self.healthy() { break }
                if let p = self.server, !p.isRunning { break }  // it died while starting
                if !started && i >= 1 {
                    started = true
                    if embedded { DispatchQueue.main.sync { self.startEmbedded() } } else { Self.kickstart() }
                }
                Thread.sleep(forTimeInterval: 0.5)
            }
            let up = Self.healthy()
            DispatchQueue.main.async {
                self.booting = false
                if up {
                    self.web.load(URLRequest(url: home))
                    if !self.checkedForUpdate { self.checkedForUpdate = true; self.checkForUpdates(silent: true) }
                } else if embedded {
                    self.web.loadHTMLString(Self.page(
                        "Workbench couldn't start.",
                        "Something else may be using port \(port), or the server crashed. Log: <code>\(wbHome)/logs/workbench.log</code>"),
                        baseURL: nil)
                } else {
                    self.web.loadHTMLString(Self.page(
                        "Workbench isn't running.",
                        "Run <code>make install</code> in the repo to install the server, then reopen the app. Logs: <code>~/.workbench/logs/workbench.log</code>"),
                        baseURL: nil)
                }
            }
        }
    }

    func startEmbedded() {
        let logs = URL(fileURLWithPath: wbHome + "/logs")
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let log = logs.appendingPathComponent("workbench.log")
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        let out = try? FileHandle(forWritingTo: log)
        _ = try? out?.seekToEnd()

        var env = ProcessInfo.processInfo.environment
        env["PORT"] = port
        env["WB_HOME"] = wbHome
        env["WB_SIDECAR"] = resources.appendingPathComponent("sidecar/claude.bundle.js").path
        env["WB_NODE"] = resources.appendingPathComponent("node/bin/node").path
        env["WB_CLAUDE_FROM_PATH"] = "1"  // the Claude Code you installed, not a bundled copy
        env["LANG"] = env["LANG"] ?? "en_US.UTF-8"
        env["ELIXIR_ERL_OPTIONS"] = "+fnu"
        // the bundle is read-only in practice: keep everything the release script writes outside it
        env["RELEASE_TMP"] = wbHome + "/tmp"
        env["RELEASE_DISTRIBUTION"] = "none"

        let p = Process()
        p.executableURL = serverBin
        p.arguments = ["start"]
        p.environment = env
        p.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory())
        p.standardOutput = out ?? FileHandle.nullDevice
        p.standardError = out ?? FileHandle.nullDevice
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.stopping, !self.booting else { return }
                self.web.loadHTMLString(Self.page(
                    "The Workbench server stopped.",
                    "Choose Workbench > Restart Server. Log: <code>\(wbHome)/logs/workbench.log</code>"),
                    baseURL: nil)
            }
        }
        do { try p.run(); server = p } catch { NSLog("could not start server: \(error)") }
    }

    /// SIGTERM lets the VM shut down cleanly (agents stopped, DB closed); wait a few seconds for it.
    func stopEmbedded() {
        guard let p = server, p.isRunning else { server = nil; return }
        stopping = true
        p.terminate()
        let deadline = Date().addingTimeInterval(8)
        while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        if p.isRunning { kill(p.processIdentifier, SIGKILL) }
        server = nil
        stopping = false
    }

    static func healthy() -> Bool {
        var req = URLRequest(url: home.appendingPathComponent("api/health"))
        req.timeoutInterval = 1
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            ok = (resp as? HTTPURLResponse)?.statusCode == 200
            sem.signal()
        }.resume()
        sem.wait()
        return ok
    }

    static func kickstart(kill: Bool = false) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = ["kickstart"] + (kill ? ["-k"] : []) + ["gui/\(getuid())/\(label)"]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try? p.run()
        p.waitUntilExit()
    }

    static func page(_ title: String, _ detail: String = "") -> String {
        """
        <body style="margin:0;height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText;
        font:14px -apple-system,system-ui;color-scheme:light dark"><div style="text-align:center;max-width:420px">
        <p style="font-size:16px">\(title)</p><p style="opacity:.6;line-height:1.5">\(detail)</p></div></body>
        """
    }

    // MARK: navigation

    /// Anything that isn't Workbench itself (PR links, docs) opens in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        let local = url.scheme == "about" || url.scheme == "blob" || url.scheme == "data"
            || url.host == home.host && url.port == home.port
        if local || action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // The server was restarted under us (`make restart`): reload once it answers again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // MARK: JS dialogs (WKWebView drops these unless we implement them)

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.beginSheetModal(for: window) {
            completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    // MARK: window / app

    // Embedded: closing the window leaves the app (and its running agents) up, like any Mac app;
    // ⌘Q stops the server. Dev: closing quits, the launchd server keeps running either way.
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { !embedded }

    func applicationWillTerminate(_ note: Notification) { stopEmbedded() }

    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    @objc func reload() { if !booting { web.reload() } }
    @objc func zoomIn() { web.pageZoom += 0.1 }
    @objc func zoomOut() { web.pageZoom = max(0.5, web.pageZoom - 0.1) }
    @objc func zoomReset() { web.pageZoom = 1 }
    @objc func openInBrowser() { NSWorkspace.shared.open(home) }
    @objc func openLogs() {
        NSWorkspace.shared.open(URL(fileURLWithPath: wbHome + "/logs/workbench.log"))
    }
    @objc func restartServer() {
        web.loadHTMLString(Self.page("Restarting Workbench…"), baseURL: nil)
        booting = true
        DispatchQueue.global().async {
            if embedded { self.stopEmbedded() } else { Self.kickstart(kill: true) }
            DispatchQueue.main.async { self.boot() }
        }
    }

    // MARK: updates (the site publishes {"version": "0.2.0", "url": "https://…"} at WBUpdateURL)

    @objc func checkForUpdatesFromMenu() { checkForUpdates(silent: false) }

    func checkForUpdates(silent: Bool) {
        guard let url = updateURL else { return }
        let current = info["CFBundleShortVersionString"] as? String ?? "0"
        URLSession.shared.dataTask(with: url) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            let latest = json?["version"] as? String
            let page = (json?["url"] as? String).flatMap(URL.init(string:))
            DispatchQueue.main.async {
                let a = NSAlert()
                if let latest, let page, latest.compare(current, options: .numeric) == .orderedDescending {
                    a.messageText = "Workbench \(latest) is available"
                    a.informativeText = "You have \(current)."
                    a.addButton(withTitle: "Download"); a.addButton(withTitle: "Later")
                    if a.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(page) }
                } else if !silent {
                    a.messageText = latest == nil ? "Couldn't check for updates" : "Workbench is up to date"
                    a.informativeText = latest == nil ? "Try again later." : "You have \(current)."
                    a.runModal()
                }
            }
        }.resume()
    }

    // MARK: menu

    func makeMenu() -> NSMenu {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem?]) {
            let item = NSMenuItem(); main.addItem(item)
            let m = NSMenu(title: title); item.submenu = m
            items.compactMap { $0 }.forEach { m.addItem($0) }
        }
        func item(_ title: String, _ sel: Selector?, _ key: String = "",
                  _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = target
            return i
        }

        // No ⌘, ⌘P ⌘K ⌘\ ⌘S ⌘T here: Workbench binds those itself and a menu item would swallow them.
        add("Workbench", [
            item("About Workbench", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            updateURL == nil ? nil : item("Check for Updates…", #selector(checkForUpdatesFromMenu), target: self),
            item("Restart Server", #selector(restartServer), target: self),
            item("Show Server Log", #selector(openLogs), target: self),
            .separator(),
            item("Hide Workbench", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            .separator(),
            item("Quit Workbench", #selector(NSApplication.terminate(_:)), "q"),
        ])
        add("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        add("View", [
            item("Reload", #selector(reload), "r", target: self),
            .separator(),
            item("Actual Size", #selector(zoomReset), "0", target: self),
            item("Zoom In", #selector(zoomIn), "+", target: self),
            item("Zoom Out", #selector(zoomOut), "-", target: self),
            .separator(),
            item("Open in Browser", #selector(openInBrowser), target: self),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        add("Window", [
            item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
            item("Minimize", #selector(NSWindow.miniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.zoom(_:))),
        ])
        return main
    }
}

let delegate = App()
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
