package com.guantou.mcsim;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The {@code MCSimNative} JavaScript bridge — the Android counterpart of {@code electron/main.cjs}
 * and {@code electron/ai-core.cjs}.
 *
 * <p>Every method of docs/android/architecture.md §2.2 is implemented here. Calls arrive on the
 * WebView JavaBridge thread and are moved to the main thread; results go back through
 * {@code window.__mcsimNativeResult(id, ok, payloadJson)} and events through
 * {@code window.__mcsimNativeEvent(name, payloadJson)}.
 *
 * <p>{@code payloadJson} is always a JSON object, except for the nullable methods of the contract
 * ({@code file.open}, {@code file.read}, …): those answer {@code ok=true} with the literal payload
 * {@code null}, which is how {@code FileResult | null} travels over the wire.
 */
public final class Bridge {
    static final String TAG = "MCSim";

    /** Virtual origin the WebView loads from; see MainActivity. */
    private static final String[] AI_DEFAULT_KEYS = {"enabled", "baseUrl", "model", "includeScript"};

    private static final String PREF_AI = "ai.settings";
    private static final String PREF_AI_KEY = "ai.key";
    private static final String PREF_LANG = "lang";

    private static final long MAX_BYTES = 64L * 1024 * 1024;
    private static final long BACK_TIMEOUT_MS = 800;
    /** Upper bound for the pre-`app.ready` event queue; real traffic is at most a couple of events. */
    private static final int MAX_PENDING_EVENTS = 200;

    private static final int KIND_OPEN_TEXT = 1;
    private static final int KIND_OPEN_CHAT = 2;
    private static final int KIND_OPEN_STRUCTURE = 3;
    private static final int KIND_CREATE_TEXT = 4;
    private static final int KIND_CREATE_BYTES = 5;
    private static final int KIND_EXPORT_FOLDER = 6;

    private final Activity activity;
    private final WebView webView;
    private final SharedPreferences prefs;
    private final Vfs vfs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<Integer, Pending> pending = new HashMap<>();
    private final List<JSONObject> pendingExternal = new ArrayList<>();
    /** Events raised before the JS hooks exist; flushed by app.ready (see event()). */
    private final List<EventMessage> pendingEvents = new ArrayList<>();
    private final Map<String, AiClient> aiRuns = new ConcurrentHashMap<>();
    private final JSONObject state = new JSONObject();

    private boolean ready;
    private boolean destroyed;
    private boolean backPending;
    private Runnable backTimeout;
    private int nextRequest = 4200;

    Bridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.prefs = activity.getSharedPreferences("mcsim", Activity.MODE_PRIVATE);
        this.vfs = new Vfs(activity);
    }

    // ------------------------------------------------------------------ rpc entry point

    /**
     * Called by the JS shim as {@code window.MCSimNative.invoke(id, method, argsJson)}.
     * The call is queued on the main thread; the reply arrives asynchronously.
     */
    @JavascriptInterface
    public String invoke(int id, String method, String argsJson) {
        final String m = method == null ? "" : method;
        final String a = argsJson == null || argsJson.isEmpty() ? "{}" : argsJson;
        handler.post(() -> {
            if (destroyed) return;
            dispatch(id, m, a);
        });
        return null;
    }

    private void dispatch(int id, String method, String argsJson) {
        JSONObject args;
        try {
            args = new JSONObject(argsJson);
        } catch (JSONException e) {
            fail(id, "Bad arguments: " + e.getMessage());
            return;
        }
        try {
            handle(id, method, args);
        } catch (JSONException e) {
            fail(id, "Bad arguments: " + message(e));
        } catch (IOException e) {
            fail(id, message(e));
        } catch (SecurityException e) {
            fail(id, message(e));
        } catch (RuntimeException e) {
            Log.e(TAG, "invoke " + method + " failed", e);
            fail(id, message(e));
        }
    }

    private void handle(int id, String method, JSONObject args) throws JSONException, IOException {
        switch (method) {
            case "app.info": {
                result(id, obj(
                        "version", BuildConfig.VERSION_NAME,
                        "platform", "android",
                        "sdk", android.os.Build.VERSION.SDK_INT,
                        "model", android.os.Build.MODEL == null ? "" : android.os.Build.MODEL));
                return;
            }
            case "app.ready": {
                ready = true;
                // The JS shim installs __mcsimNativeEvent/__mcsimNativeResult right before it calls
                // app.ready, so this is the earliest safe moment to push anything at it: queued
                // events (e.g. a transient lifecycle ones are dropped, see event()) are flushed
                // first, then the files a VIEW/SEND intent carried.
                flushPendingEvents();
                flushPendingExternal();
                result(id, new JSONObject());
                return;
            }
            case "file.open":
                launchOpen(id, KIND_OPEN_TEXT, "*/*");
                return;
            case "file.read": {
                String path = args.optString("path", "");
                Uri uri = vfs.uriFor(path);
                if (uri == null) {
                    fail(id, "Unknown file: " + path);
                    return;
                }
                Text text = readText(uri);
                result(id, fileResult(path, vfs.nameFor(path), text));
                return;
            }
            case "file.save": {
                String path = args.optString("path", "");
                String content = args.optString("content", "");
                Uri uri = vfs.uriFor(path);
                if (uri == null) {
                    // A virtual path without a backing document (a shared text, or a save of a
                    // document whose permission is gone): fall back to "save as".
                    launchCreate(id, path, content, true);
                    return;
                }
                writeBytes(uri, content.getBytes(StandardCharsets.UTF_8));
                result(id, obj("path", path));
                return;
            }
            case "file.saveAs": {
                String suggested = suggest(args, "untitled.mcsim");
                launchCreate(id, suggested, args.optString("content", ""), true);
                return;
            }
            case "file.exportText": {
                String suggested = suggest(args, "commands.txt");
                launchCreate(id, suggested, args.optString("content", ""), true);
                return;
            }
            case "structure.import":
                launchOpen(id, KIND_OPEN_STRUCTURE, "*/*");
                return;
            case "structure.export":
                launchCreateBytes(id, suggest(args, "structure.mcstructure"), args.optString("base64", ""));
                return;
            case "structure.exportBdx":
                launchCreateBytes(id, suggest(args, "structure.bdx"), args.optString("base64", ""));
                return;
            case "chat.open":
                launchOpen(id, KIND_OPEN_CHAT, "*/*");
                return;
            case "chat.saveAs":
                launchCreate(id, suggest(args, "conversation.mcchat"), args.optString("content", ""), true);
                return;
            case "file.exportFolder": {
                JSONArray files = args.optJSONArray("files");
                if (files == null || files.length() == 0) {
                    result(id, null);
                    return;
                }
                for (int i = 0; i < files.length(); i++) {
                    JSONObject file = files.optJSONObject(i);
                    String relative = file == null ? "" : file.optString("path", "");
                    if (!validRelativePath(relative)) {
                        fail(id, "Bad path: " + relative);
                        return;
                    }
                }
                launchExportFolder(id, files);
                return;
            }
            case "app.choose":
                choose(id, args);
                return;
            case "app.confirmDiscard":
                confirmDiscard(id, args.optString("name", ""));
                return;
            case "app.setState": {
                try {
                    state.put("dirty", args.optBoolean("dirty", false));
                    state.put("name", args.optString("name", ""));
                } catch (JSONException ignored) {
                    // state is only used for the exit confirmation
                }
                result(id, new JSONObject());
                return;
            }
            case "app.forceClose": {
                result(id, new JSONObject());
                handler.postDelayed(this::finishActivity, 120);
                return;
            }
            case "app.setLanguage": {
                String lang = args.optString("lang", "");
                if ("zh".equals(lang) || "en".equals(lang)) prefs.edit().putString(PREF_LANG, lang).apply();
                result(id, new JSONObject());
                return;
            }
            case "app.keepAwake": {
                if (args.optBoolean("on", false)) {
                    activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
                result(id, new JSONObject());
                return;
            }
            case "app.share":
                share(id, args.optString("name", ""), args.optString("content", ""));
                return;
            case "app.backResult": {
                boolean handled = args.optBoolean("handled", false);
                if (backPending) {
                    backPending = false;
                    if (backTimeout != null) handler.removeCallbacks(backTimeout);
                    backTimeout = null;
                }
                result(id, new JSONObject());
                if (!handled) handler.postDelayed(this::finishActivity, 60);
                return;
            }
            case "ai.settings.get":
                result(id, aiView());
                return;
            case "ai.settings.set":
                result(id, applyAiSettings(args));
                return;
            case "ai.chat":
                startAi(id, args);
                return;
            case "ai.cancel": {
                String runId = args.optString("id", "");
                AiClient run = aiRuns.remove(runId);
                if (run != null) run.cancel();
                result(id, new JSONObject());
                return;
            }
            default:
                fail(id, "Unknown method: " + method);
        }
    }

    // ------------------------------------------------------------------ replies and events

    private void result(int id, Object payload) {
        String json = payload == null ? "null" : payload.toString();
        eval("(function(){var f=window.__mcsimNativeResult;"
                + "if(typeof f==='function')f(" + id + ",true," + JSONObject.quote(json) + ");"
                + "else console.error('MCSim: __mcsimNativeResult is missing');})()");
    }

    private void fail(int id, String text) {
        String json;
        try {
            json = new JSONObject().put("error", text == null ? "Error" : text).toString();
        } catch (JSONException e) {
            json = "{\"error\":\"Error\"}";
        }
        eval("(function(){var f=window.__mcsimNativeResult;"
                + "if(typeof f==='function')f(" + id + ",false," + JSONObject.quote(json) + ");"
                + "else console.error('MCSim: __mcsimNativeResult is missing');})()");
    }

    /**
     * Native → JS event. Before the page has called {@code app.ready} the JS hooks are not installed
     * yet (the app calls onResume() before the WebView has even loaded), so events are queued in
     * order and flushed by {@link #flushPendingEvents()}. Transient lifecycle events are simply
     * dropped while not ready: delivering a stale pause/resume later would be wrong.
     */
    private void event(String name, JSONObject payload) {
        if (name == null) name = "";
        if (!ready) {
            if ("lifecycle".equals(name)) return;
            if (pendingEvents.size() < MAX_PENDING_EVENTS) {
                pendingEvents.add(new EventMessage(name, payload == null ? new JSONObject() : payload));
            } else {
                Log.w(TAG, "dropping native event " + name + ": too many queued events");
            }
            return;
        }
        emitEvent(name, payload);
    }

    private void emitEvent(String name, JSONObject payload) {
        String json = payload == null ? "{}" : payload.toString();
        eval("(function(){var f=window.__mcsimNativeEvent;"
                + "if(typeof f==='function')f(" + JSONObject.quote(name) + "," + JSONObject.quote(json) + ");"
                + "else console.error('MCSim: __mcsimNativeEvent is missing (event dropped: "
                + name.replace("'", "") + ")');})()");
    }

    private void flushPendingEvents() {
        if (pendingEvents.isEmpty()) return;
        List<EventMessage> queue = new ArrayList<>(pendingEvents);
        pendingEvents.clear();
        for (EventMessage message : queue) emitEvent(message.name, message.payload);
    }

    private static final class EventMessage {
        final String name;
        final JSONObject payload;

        EventMessage(String name, JSONObject payload) {
            this.name = name;
            this.payload = payload;
        }
    }

    private void eval(final String code) {
        handler.post(() -> {
            WebView view = webView;
            if (view == null || destroyed) return;
            try {
                view.evaluateJavascript(code, null);
            } catch (Throwable t) {
                Log.w(TAG, "evaluateJavascript failed", t);
            }
        });
    }

    // ------------------------------------------------------------------ lifecycle for the activity

    /** True when the back press was taken over (the JS side decides); false lets Android finish the activity. */
    boolean handleBack() {
        if (destroyed) return false;
        if (!ready) return false;
        if (backPending) return true;
        backPending = true;
        event("back", new JSONObject());
        backTimeout = () -> {
            if (backPending && !destroyed) {
                backPending = false;
                finishActivity();
            }
        };
        handler.postDelayed(backTimeout, BACK_TIMEOUT_MS);
        return true;
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        Pending request = pending.remove(requestCode);
        if (request == null) return;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            result(request.id, null);
            return;
        }
        Uri uri = data.getData();
        try {
            switch (request.kind) {
                case KIND_OPEN_TEXT: {
                    persistPermission(uri);
                    Text text = readText(uri);
                    String path = vfs.register(uri, null);
                    result(request.id, fileResult(path, vfs.nameFor(path), text));
                    break;
                }
                case KIND_OPEN_CHAT: {
                    persistPermission(uri);
                    Text text = readText(uri);
                    String path = vfs.register(uri, null);
                    result(request.id, obj("path", path, "content", text.content));
                    break;
                }
                case KIND_OPEN_STRUCTURE: {
                    persistPermission(uri);
                    byte[] bytes = readBytes(uri);
                    String name = displayName(uri);
                    if (name == null || name.isEmpty()) name = "structure.mcstructure";
                    result(request.id, obj("name", name,
                            "base64", Base64.encodeToString(bytes, Base64.NO_WRAP)));
                    break;
                }
                case KIND_CREATE_TEXT: {
                    persistPermission(uri);
                    writeBytes(uri, (request.content == null ? "" : request.content)
                            .getBytes(StandardCharsets.UTF_8));
                    // The provider is the authority on the real file name (a picker or a provider may
                    // still adjust it); the virtual path therefore uses the name on disk, not the
                    // suggestion, so the tab title and the file agree.
                    String path = vfs.register(uri, actualName(uri, request.suggestedName));
                    result(request.id, obj("path", path));
                    break;
                }
                case KIND_CREATE_BYTES: {
                    persistPermission(uri);
                    byte[] bytes = Base64.decode(request.base64 == null ? "" : request.base64, Base64.DEFAULT);
                    writeBytes(uri, bytes);
                    String path = vfs.register(uri, actualName(uri, request.suggestedName));
                    result(request.id, obj("path", path));
                    break;
                }
                case KIND_EXPORT_FOLDER:
                    exportFolder(request, uri);
                    break;
                default:
                    fail(request.id, "Unknown request");
            }
        } catch (Exception e) {
            Log.e(TAG, "document picker result failed", e);
            fail(request.id, message(e));
            toast(activity.getString(R.string.cannot_save) + ": " + message(e));
        }
    }

    /** The activity is going away: stop timers, cancel AI runs and drop the bridge. */
    void destroy() {
        destroyed = true;
        ready = false;
        if (backTimeout != null) handler.removeCallbacks(backTimeout);
        for (AiClient run : aiRuns.values()) run.cancel();
        aiRuns.clear();
        pending.clear();
        pendingExternal.clear();
        pendingEvents.clear();
        handler.removeCallbacksAndMessages(null);
    }

    void onPause() {
        // Documents live in JS; only the app lifecycle is reported (contract §2.4, optional).
        event("lifecycle", obj("state", "pause"));
    }

    void onResume() {
        event("lifecycle", obj("state", "resume"));
    }

    // ------------------------------------------------------------------ files launched from outside

    /** A file sent by {@code VIEW} (file manager, "open with") or {@code onNewIntent}. */
    void queueExternalUri(Uri uri, String name) {
        if (uri == null) return;
        try {
            // Usually only a transient read grant, but some senders allow it to be persisted, which
            // keeps "save" working after a restart; a refusal is ignored.
            persistPermission(uri);
            Text text = readText(uri);
            String display = name;
            if (display == null || display.isEmpty()) display = displayName(uri);
            String path = vfs.register(uri, display);
            deliverExternal(fileResult(path, vfs.nameFor(path), text));
        } catch (Exception e) {
            Log.e(TAG, "cannot read the launched file", e);
            toast(activity.getString(R.string.cannot_open) + ": " + message(e));
        }
    }

    /** Text shared from another app ({@code ACTION_SEND text/plain}) becomes a new unsaved document. */
    void queueExternalText(String text, String subject) {
        if (text == null) return;
        String name = subject;
        if (name == null || name.trim().isEmpty()) name = "shared.txt";
        if (!name.contains(".")) name = name + ".txt";
        String path = vfs.registerText(name);
        String content = normalizeText(text);
        deliverExternal(obj(
                "path", path,
                "name", vfs.nameFor(path),
                "content", content,
                "eol", eolOf(text)));
    }

    private void deliverExternal(JSONObject payload) {
        if (ready) event("openExternal", payload);
        else pendingExternal.add(payload);
    }

    private void flushPendingExternal() {
        if (pendingExternal.isEmpty()) return;
        List<JSONObject> queue = new ArrayList<>(pendingExternal);
        pendingExternal.clear();
        for (JSONObject payload : queue) event("openExternal", payload);
    }

    // ------------------------------------------------------------------ SAF launches

    private void launchOpen(int id, int kind, String mime) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime == null || mime.isEmpty() ? "*/*" : mime);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startForResult(intent, new Pending(id, kind));
    }

    private void launchCreate(int id, String suggestedName, String content, boolean rememberPath) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // DocumentsUI appends the extension of the MIME type unless the title's own extension maps
        // to it; `application/octet-stream` is treated as "matches anything" there, so `.mcsim` and
        // `.mcchat` keep their names. A plain `.txt` export uses text/plain (its extension already
        // matches, so nothing is appended either). See docs/android/native.md §12.
        intent.setType(createMimeFor(suggestedName));
        intent.putExtra(Intent.EXTRA_TITLE, suggestedName);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        Pending request = new Pending(id, KIND_CREATE_TEXT);
        request.suggestedName = suggestedName;
        request.content = content;
        request.rememberPath = rememberPath;
        startForResult(intent, request);
    }

    /** MIME used for ACTION_CREATE_DOCUMENT; keeps the suggested extension intact (see above). */
    private static String createMimeFor(String suggestedName) {
        String lower = suggestedName == null ? "" : suggestedName.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private void launchCreateBytes(int id, String suggestedName, String base64) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, suggestedName);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        Pending request = new Pending(id, KIND_CREATE_BYTES);
        request.suggestedName = suggestedName;
        request.base64 = base64;
        startForResult(intent, request);
    }

    private void launchExportFolder(int id, JSONArray files) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        Pending request = new Pending(id, KIND_EXPORT_FOLDER);
        request.files = files;
        startForResult(intent, request);
    }

    private void startForResult(Intent intent, Pending request) {
        int requestCode = nextRequest++;
        if (nextRequest > 60000) nextRequest = 4200;
        pending.put(requestCode, request);
        try {
            activity.startActivityForResult(intent, requestCode);
        } catch (ActivityNotFoundException e) {
            pending.remove(requestCode);
            fail(request.id, "No app can open the document picker");
        }
    }

    private void exportFolder(Pending request, Uri treeUri) throws IOException {
        persistPermission(treeUri);
        DocumentFile tree = DocumentFile.fromTreeUri(activity, treeUri);
        if (tree == null || !tree.isDirectory()) throw new IOException("That is not a folder");
        JSONArray files = request.files;
        for (int i = 0; files != null && i < files.length(); i++) {
            JSONObject file = files.optJSONObject(i);
            if (file == null) continue;
            String relative = file.optString("path", "");
            String content = file.optString("content", "");
            String[] parts = relative.split("/");
            DocumentFile dir = tree;
            for (int p = 0; p < parts.length - 1; p++) {
                String segment = parts[p];
                DocumentFile next = dir.findFile(segment);
                if (next == null || !next.isDirectory()) next = dir.createDirectory(segment);
                if (next == null) throw new IOException("Cannot create folder: " + segment);
                dir = next;
            }
            String name = parts[parts.length - 1];
            DocumentFile existing = dir.findFile(name);
            if (existing != null) existing.delete();
            DocumentFile created = dir.createFile(mimeFor(name), name);
            if (created == null) throw new IOException("Cannot create file: " + name);
            try (OutputStream out = activity.getContentResolver().openOutputStream(created.getUri(), "wt")) {
                if (out == null) throw new IOException("Cannot write " + name);
                out.write(content.getBytes(StandardCharsets.UTF_8));
            }
        }
        String label = displayName(treeUri);
        if (label == null || label.isEmpty()) label = "export";
        result(request.id, obj("path", label));
    }

    private static String mimeFor(String name) {
        String lower = name == null ? "" : name.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".mcstructure") || lower.endsWith(".bdx")) return "application/octet-stream";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".txt") || lower.endsWith(".mcsim") || lower.endsWith(".mcchat")) return "text/plain";
        return "application/octet-stream";
    }

    // ------------------------------------------------------------------ native dialogs

    /**
     * A blocking native dialog is part of the JS back handling ("discard unsaved changes?"), which
     * takes longer than the 800ms back timeout. The timer is a safety net for a JS side that never
     * answers at all, so it is suspended while such a dialog is in front; the JS side finishes the
     * flow itself with {@code app.backResult} / {@code app.forceClose}.
     */
    private void suspendBackTimeout() {
        if (backTimeout != null) {
            handler.removeCallbacks(backTimeout);
            backTimeout = null;
        }
    }

    private void choose(int id, JSONObject args) {
        String message = args.optString("message", "");
        JSONArray buttons = args.optJSONArray("buttons");
        if (buttons == null || buttons.length() == 0) {
            result(id, obj("index", -1));
            return;
        }
        suspendBackTimeout();
        String[] labels = new String[buttons.length()];
        for (int i = 0; i < buttons.length(); i++) labels[i] = buttons.optString(i, "");
        final int[] picked = {-1};
        final boolean[] replied = {false};
        AlertDialog.Builder builder = new AlertDialog.Builder(activity);
        if (!message.isEmpty()) builder.setTitle(message);
        builder.setItems(labels, (dialog, which) -> {
            picked[0] = which;
            dialog.dismiss();
        });
        AlertDialog dialog = builder.create();
        dialog.setOnDismissListener(d -> {
            if (replied[0]) return;
            replied[0] = true;
            result(id, obj("index", picked[0]));
        });
        dialog.show();
    }

    private void confirmDiscard(int id, String name) {
        suspendBackTimeout();
        final boolean[] discard = {false};
        final boolean[] replied = {false};
        String shown = name == null || name.isEmpty() ? "untitled" : name;
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setMessage(activity.getString(R.string.dialog_unsaved, shown))
                .setPositiveButton(activity.getString(R.string.dialog_discard),
                        (d, which) -> discard[0] = true)
                .setNegativeButton(activity.getString(R.string.dialog_cancel), null)
                .setCancelable(true)
                .create();
        dialog.setOnDismissListener(d -> {
            if (replied[0]) return;
            replied[0] = true;
            result(id, obj("ok", discard[0]));
        });
        dialog.show();
    }

    private void share(int id, String name, String content) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, activity.getString(R.string.share_subject,
                name == null || name.isEmpty() ? "" : name));
        send.putExtra(Intent.EXTRA_TEXT, content == null ? "" : content);
        try {
            activity.startActivity(Intent.createChooser(send, activity.getString(R.string.share_chooser)));
        } catch (ActivityNotFoundException e) {
            fail(id, "No app can share text");
            return;
        }
        result(id, new JSONObject());
    }

    // ------------------------------------------------------------------ AI

    private JSONObject aiDefaults() {
        return obj(
                "enabled", false,
                "baseUrl", "https://api.openai.com/v1",
                "model", "",
                "includeScript", true);
    }

    private JSONObject aiStored() {
        String raw = prefs.getString(PREF_AI, null);
        if (raw != null && !raw.isEmpty()) {
            try {
                return new JSONObject(raw);
            } catch (JSONException ignored) {
                // fall through to the defaults
            }
        }
        return new JSONObject();
    }

    /** Stored settings filtered to the documented keys and their expected types. */
    private JSONObject aiSettings() {
        JSONObject defaults = aiDefaults();
        JSONObject stored = aiStored();
        JSONObject out = new JSONObject();
        for (String key : AI_DEFAULT_KEYS) {
            Object fallback = defaults.opt(key);
            Object value = stored.opt(key);
            try {
                out.put(key, sameType(fallback, value) ? value : fallback);
            } catch (JSONException ignored) {
                // cannot happen for these keys
            }
        }
        return out;
    }

    private String aiKey() {
        String encoded = prefs.getString(PREF_AI_KEY, null);
        if (encoded == null || encoded.isEmpty()) return "";
        try {
            return new String(Base64.decode(encoded, Base64.NO_WRAP), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return "";
        }
    }

    /** {@code canEncrypt} is true: the key lives base64-encoded inside this app's private storage. */
    private JSONObject aiView() {
        JSONObject settings = aiSettings();
        try {
            settings.put("hasKey", !aiKey().isEmpty());
            settings.put("canEncrypt", true);
        } catch (JSONException ignored) {
            // cannot happen
        }
        return settings;
    }

    private JSONObject applyAiSettings(JSONObject change) {
        JSONObject next = aiSettings();
        JSONObject defaults = aiDefaults();
        for (String key : AI_DEFAULT_KEYS) {
            if (!change.has(key)) continue;
            Object value = change.opt(key);
            if (!sameType(defaults.opt(key), value)) continue;
            try {
                next.put(key, value);
            } catch (JSONException ignored) {
                // cannot happen
            }
        }
        String baseUrl = next.optString("baseUrl", "");
        if (!baseUrl.trim().isEmpty()) {
            try {
                AiClient.checkBaseUrl(baseUrl);
            } catch (IllegalArgumentException e) {
                return obj("error", message(e));
            }
        }
        if (change.has("key")) {
            Object key = change.opt("key");
            if (key instanceof String) {
                String text = (String) key;
                if (text.isEmpty()) prefs.edit().remove(PREF_AI_KEY).apply();
                else {
                    prefs.edit().putString(PREF_AI_KEY,
                            Base64.encodeToString(text.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP)).apply();
                }
            }
        }
        prefs.edit().putString(PREF_AI, next.toString()).apply();
        return obj("settings", aiView());
    }

    private void startAi(int id, JSONObject args) throws JSONException {
        String runId = args.optString("id", "");
        JSONArray messages = args.optJSONArray("messages");
        if (runId.isEmpty() || !validMessages(messages)) {
            fail(id, "Bad request");
            return;
        }
        JSONObject settings = aiSettings();
        String baseUrl = args.optString("baseUrl", "");
        if (baseUrl.trim().isEmpty()) baseUrl = settings.optString("baseUrl", "");
        String model = args.optString("model", "");
        if (model.trim().isEmpty()) model = settings.optString("model", "");
        String apiKey = args.optString("apiKey", "");
        if (apiKey.isEmpty()) apiKey = aiKey();
        boolean test = args.optBoolean("test", false);
        // Pre-flight failures are answered as a rejection (ok=false): the JS shim only surfaces a
        // failed ai.chat through its catch branch (`{error}`), so a resolved `{error}` payload would
        // look like a started run and the assistant pane would wait for an ai.event forever.
        if (!settings.optBoolean("enabled", false)) {
            fail(id, "The AI assistant is switched off in the settings");
            return;
        }
        if (apiKey.isEmpty() || model.trim().isEmpty()) {
            fail(id, "Enter the model name and the API key in the settings first");
            return;
        }
        String url;
        try {
            url = AiClient.endpoint(AiClient.checkBaseUrl(baseUrl));
        } catch (IllegalArgumentException e) {
            fail(id, message(e));
            return;
        }
        final String finalId = runId;
        AiClient run = new AiClient(apiKey);
        AiClient previous = aiRuns.put(runId, run);
        if (previous != null) previous.cancel();
        run.start(url, model.trim(), messages, test, new AiClient.Listener() {
            @Override
            public void delta(String text) {
                event("ai.event", obj("id", finalId, "type", "delta", "text", text));
            }

            @Override
            public void done(String text) {
                aiRuns.remove(finalId, run);
                event("ai.event", obj("id", finalId, "type", "done", "text", text));
            }

            @Override
            public void error(String text) {
                aiRuns.remove(finalId, run);
                event("ai.event", obj("id", finalId, "type", "error", "text", text));
            }

            @Override
            public void cancelled() {
                aiRuns.remove(finalId, run);
                event("ai.event", obj("id", finalId, "type", "cancelled", "text", "Cancelled"));
            }
        });
        result(id, obj("started", true));
    }

    private static boolean validMessages(JSONArray messages) {
        if (messages == null || messages.length() == 0 || messages.length() > 200) return false;
        long total = 0;
        for (int i = 0; i < messages.length(); i++) {
            JSONObject message = messages.optJSONObject(i);
            if (message == null) return false;
            String role = message.optString("role", "");
            if (!"system".equals(role) && !"user".equals(role) && !"assistant".equals(role)) return false;
            Object content = message.opt("content");
            if (!(content instanceof String)) return false;
            total += ((String) content).length();
            if (total > 2_000_000L) return false;
        }
        return true;
    }

    // ------------------------------------------------------------------ file helpers

    private static final class Text {
        final String content;
        final String eol;

        Text(String content, String eol) {
            this.content = content;
            this.eol = eol;
        }
    }

    private static final class Pending {
        final int id;
        final int kind;
        String suggestedName;
        String content;
        String base64;
        JSONArray files;
        boolean rememberPath;

        Pending(int id, int kind) {
            this.id = id;
            this.kind = kind;
        }
    }

    private byte[] readBytes(Uri uri) throws IOException {
        if (uri == null) throw new IOException("No file selected");
        InputStream in;
        if ("file".equals(uri.getScheme())) in = new FileInputStream(new File(uri.getPath()));
        else in = activity.getContentResolver().openInputStream(uri);
        if (in == null) throw new IOException("Cannot read " + uri);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buffer)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new IOException("The file is too large for this device");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        } finally {
            try {
                in.close();
            } catch (IOException ignored) {
                // nothing to do
            }
        }
    }

    private void writeBytes(Uri uri, byte[] data) throws IOException {
        if (uri == null) throw new IOException("No file selected");
        OutputStream out;
        if ("file".equals(uri.getScheme())) out = new FileOutputStream(new File(uri.getPath()));
        else out = activity.getContentResolver().openOutputStream(uri, "wt");
        if (out == null) throw new IOException("Cannot write " + uri);
        try (OutputStream stream = out) {
            stream.write(data);
            stream.flush();
        }
    }

    private Text readText(Uri uri) throws IOException {
        String text = new String(readBytes(uri), StandardCharsets.UTF_8);
        if (!text.isEmpty() && text.charAt(0) == '\uFEFF') text = text.substring(1);
        return new Text(normalizeText(text), eolOf(text));
    }

    /** Same normalisation as {@code decodeText} in electron/lib.cjs: CRLF/CR become LF. */
    private static String normalizeText(String text) {
        return text == null ? "" : text.replace("\r\n", "\n").replace('\r', '\n');
    }

    private static String eolOf(String text) {
        return text != null && text.contains("\r\n") ? "crlf" : "lf";
    }

    private void persistPermission(Uri uri) {
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        try {
            activity.getContentResolver().takePersistableUriPermission(uri, flags);
            return;
        } catch (SecurityException ignored) {
            // the provider may grant only one of the two
        }
        try {
            activity.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // not persistable at all; re-picking the document still works
        }
    }

    /** The real file name of a created document; falls back to the suggestion when a provider has none. */
    private String actualName(Uri uri, String fallback) {
        String name = displayName(uri);
        return name == null || name.isEmpty() ? fallback : name;
    }

    private String displayName(Uri uri) {        if (uri == null) return null;
        if ("file".equals(uri.getScheme())) {
            String path = uri.getPath();
            return path == null ? null : new File(path).getName();
        }
        Cursor cursor = null;
        try {
            cursor = activity.getContentResolver().query(uri,
                    new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "cannot query the display name", e);
        } finally {
            if (cursor != null) {
                try {
                    cursor.close();
                } catch (Exception ignored) {
                    // nothing to do
                }
            }
        }
        String segment = uri.getLastPathSegment();
        if (segment != null) {
            int slash = segment.lastIndexOf('/');
            if (slash >= 0 && slash < segment.length() - 1) segment = segment.substring(slash + 1);
            int colon = segment.lastIndexOf(':');
            if (colon >= 0 && colon < segment.length() - 1) segment = segment.substring(colon + 1);
        }
        return segment;
    }

    private static boolean validRelativePath(String path) {
        if (path == null || path.isEmpty()) return false;
        if (path.startsWith("/") || path.startsWith("\\")) return false;
        if (path.indexOf(':') >= 0) return false;
        for (String part : path.split("/")) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) return false;
        }
        return true;
    }

    private JSONObject fileResult(String path, String name, Text text) {
        return obj("path", path, "name", name, "content", text.content, "eol", text.eol);
    }

    private static String suggest(JSONObject args, String fallback) {
        String name = args.optString("suggestedName", "");
        return name == null || name.trim().isEmpty() ? fallback : name.trim();
    }

    private static boolean sameType(Object expected, Object value) {
        if (expected instanceof Boolean) return value instanceof Boolean;
        if (expected instanceof String) return value instanceof String;
        return value != null && expected != null && expected.getClass() == value.getClass();
    }

    private static String message(Throwable t) {
        if (t == null) return "Error";
        String text = t.getMessage();
        return text == null || text.isEmpty() ? t.toString() : text;
    }

    private void toast(final String text) {
        try {
            Toast.makeText(activity, text, Toast.LENGTH_LONG).show();
        } catch (Throwable ignored) {
            // a toast is only a hint
        }
    }

    private void finishActivity() {
        if (destroyed) return;
        try {
            activity.finish();
        } catch (Throwable t) {
            Log.w(TAG, "finish failed", t);
        }
    }

    /** Small JSON object builder; null values are skipped. */
    private static JSONObject obj(Object... pairs) {
        JSONObject out = new JSONObject();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            Object value = pairs[i + 1];
            if (value == null) continue;
            try {
                out.put(String.valueOf(pairs[i]), value);
            } catch (JSONException ignored) {
                // values used here are all JSON-safe
            }
        }
        return out;
    }
}
