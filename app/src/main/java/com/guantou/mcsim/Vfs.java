package com.guantou.mcsim;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Virtual path &lt;-&gt; SAF {@link Uri} registry.
 *
 * <p>The contract (docs/android/architecture.md §2.3) says the UI only ever sees a short virtual
 * path such as {@code demo.mcsim}; the real {@code content://…} URI stays here and is persisted
 * in SharedPreferences so a document can be re-read or saved back after a restart. Duplicate
 * names get " (2)", " (3)" before the extension.
 */
final class Vfs {
    private static final String PREFS = "mcsim_vfs";
    private static final String KEY = "map";
    private static final int MAX_NAME = 128;

    private final SharedPreferences prefs;
    /** virtual path -> {"uri": "content://…" | "", "name": "demo.mcsim"} */
    private final JSONObject map = new JSONObject();
    /** content URI -> virtual path, so reopening the same file does not allocate a new name. */
    private final Map<String, String> uriToPath = new HashMap<>();

    Vfs(Context ctx) {
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        load();
    }

    private void load() {
        String raw = prefs.getString(KEY, null);
        if (raw == null || raw.isEmpty()) return;
        try {
            JSONObject stored = new JSONObject(raw);
            for (Iterator<String> it = stored.keys(); it.hasNext(); ) {
                String path = it.next();
                JSONObject entry = stored.optJSONObject(path);
                if (entry == null) continue;
                put(path, entry.optString("uri", ""), entry.optString("name", path));
            }
            if (!map.keys().hasNext()) prefs.edit().remove(KEY).apply();
        } catch (JSONException e) {
            // A damaged registry is not fatal: start from an empty one.
            reset();
        }
    }

    /** {@code JSONObject} on Android has no clear(), so drop the keys one by one. */
    private void reset() {
        List<String> keys = new ArrayList<>();
        for (Iterator<String> it = map.keys(); it.hasNext(); ) keys.add(it.next());
        for (String key : keys) map.remove(key);
        uriToPath.clear();
    }

    private synchronized void put(String path, String uri, String name) {
        JSONObject entry = new JSONObject();
        try {
            entry.put("uri", uri == null ? "" : uri);
            entry.put("name", name == null || name.isEmpty() ? path : name);
        } catch (JSONException ignored) {
            return;
        }
        try {
            map.put(path, entry);
        } catch (JSONException ignored) {
            return;
        }
        if (uri != null && !uri.isEmpty()) uriToPath.put(uri, path);
    }

    private void persist() {
        prefs.edit().putString(KEY, map.toString()).apply();
    }

    /** Registers a picked document and returns its (unique) virtual path. */
    synchronized String register(Uri uri, String displayName) {
        String uriString = uri == null ? "" : uri.toString();
        if (!uriString.isEmpty()) {
            String existing = uriToPath.get(uriString);
            if (existing != null) return existing;
        }
        String name = sanitize(displayName != null && !displayName.isEmpty() ? displayName : lastSegment(uri));
        String path = map.has(name) ? unique(name) : name;
        put(path, uriString, path);
        persist();
        return path;
    }

    /** Registers a document that only exists in memory (shared text); {@code file.save} turns it into a new file. */
    synchronized String registerText(String displayName) {
        String name = sanitize(displayName != null && !displayName.isEmpty() ? displayName : "shared.txt");
        String path = map.has(name) ? unique(name) : name;
        put(path, "", path);
        persist();
        return path;
    }

    synchronized Uri uriFor(String path) {
        if (path == null) return null;
        JSONObject entry = map.optJSONObject(path);
        if (entry == null) return null;
        String uri = entry.optString("uri", "");
        if (uri.isEmpty()) return null;
        try {
            return Uri.parse(uri);
        } catch (Exception e) {
            return null;
        }
    }

    synchronized String nameFor(String path) {
        JSONObject entry = map.optJSONObject(path);
        if (entry == null) return path;
        String name = entry.optString("name", path);
        return name == null || name.isEmpty() ? path : name;
    }

    synchronized boolean has(String path) {
        return path != null && map.optJSONObject(path) != null;
    }

    private String unique(String name) {
        String stem = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0 && dot > name.length() - 12) {
            stem = name.substring(0, dot);
            ext = name.substring(dot);
        }
        for (int i = 2; i < 10000; i++) {
            String candidate = stem + " (" + i + ")" + ext;
            if (!map.has(candidate)) return candidate;
        }
        return stem + " (" + System.currentTimeMillis() + ")" + ext;
    }

    private static String sanitize(String name) {
        if (name == null) return "untitled";
        StringBuilder out = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c == '/' || c == '\\' || c == ':' || c == '\0' || c < 0x20) out.append('_');
            else out.append(c);
        }
        String cleaned = out.toString().trim();
        if (cleaned.isEmpty() || ".".equals(cleaned) || "..".equals(cleaned)) cleaned = "untitled";
        if (cleaned.length() > MAX_NAME) {
            int dot = cleaned.lastIndexOf('.');
            String ext = dot > 0 && dot > cleaned.length() - 12 ? cleaned.substring(dot) : "";
            cleaned = cleaned.substring(0, MAX_NAME - ext.length()) + ext;
        }
        return cleaned;
    }

    private static String lastSegment(Uri uri) {
        if (uri == null) return "untitled";
        String seg = uri.getLastPathSegment();
        if (seg == null || seg.isEmpty()) return "untitled";
        int slash = seg.lastIndexOf('/');
        if (slash >= 0 && slash < seg.length() - 1) seg = seg.substring(slash + 1);
        int colon = seg.lastIndexOf(':');
        if (colon >= 0 && colon < seg.length() - 1) seg = seg.substring(colon + 1);
        return seg;
    }
}
