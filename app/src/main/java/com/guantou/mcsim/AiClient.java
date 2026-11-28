package com.guantou.mcsim;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * OpenAI-format streaming chat client, a Java port of {@code electron/ai-core.cjs}.
 *
 * <p>Runs on its own thread ({@code HttpURLConnection}) and reports pieces through {@link Listener};
 * {@link Bridge} turns those into {@code ai.event} messages. The API key is only ever used in the
 * Authorization header and is replaced with {@code ***} in every error text.
 */
final class AiClient {
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    /** Same silence budget as ai-core.cjs (60 s). */
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int MAX_ERROR_CHARS = 500;
    private static final int MAX_PLAIN_BODY = 1 << 20;

    interface Listener {
        void delta(String text);

        void done(String text);

        void error(String text);

        void cancelled();
    }

    private final String apiKey;
    private volatile HttpURLConnection connection;
    private volatile boolean cancelled;

    AiClient(String apiKey) {
        this.apiKey = apiKey == null ? "" : apiKey;
    }

    /** {@code https://host/v1}, {@code https://host/v1/} and {@code …/chat/completions} name the same endpoint. */
    static String endpoint(String baseUrl) {
        String u = baseUrl == null ? "" : baseUrl.trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u.endsWith("/chat/completions") ? u : u + "/chat/completions";
    }

    /** Only https, or http to this device (a local model server). */
    static String checkBaseUrl(String baseUrl) {
        String raw = baseUrl == null ? "" : baseUrl.trim();
        URL url;
        try {
            url = new URL(raw);
        } catch (Exception e) {
            throw new IllegalArgumentException("The base URL is not a valid address");
        }
        String host = url.getHost() == null ? "" : url.getHost();
        boolean local = "localhost".equals(host) || "127.0.0.1".equals(host) || "[::1]".equals(host)
                || "::1".equals(host);
        boolean https = "https".equalsIgnoreCase(url.getProtocol());
        boolean http = "http".equalsIgnoreCase(url.getProtocol());
        if (!https && !(http && local)) {
            throw new IllegalArgumentException(
                    "The base URL must start with https:// (http:// is only allowed for localhost)");
        }
        return url.toString();
    }

    void start(final String url, final String model, final JSONArray messages, final boolean test,
               final Listener listener) {
        Thread thread = new Thread(() -> run(url, model, messages, test, listener), "mcsim-ai");
        thread.setDaemon(true);
        thread.start();
    }

    void cancel() {
        cancelled = true;
        HttpURLConnection c = connection;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Throwable ignored) {
                // already gone
            }
        }
    }

    private void run(String url, String model, JSONArray messages, boolean test, Listener listener) {
        StringBuilder all = new StringBuilder();
        try {
            JSONObject body = new JSONObject();
            body.put("model", model);
            body.put("messages", messages);
            body.put("stream", true);
            if (test) body.put("max_tokens", 8);
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);

            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            connection = c;
            c.setRequestMethod("POST");
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setDoOutput(true);
            c.setUseCaches(false);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("Accept", "text/event-stream");
            c.setRequestProperty("Authorization", "Bearer " + apiKey);
            c.setRequestProperty("User-Agent", "MCSim-Android/" + BuildConfig.VERSION_NAME);
            c.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = c.getOutputStream()) {
                out.write(payload);
                out.flush();
            }

            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException(httpError(c, code));

            String type = c.getContentType() == null ? "" : c.getContentType();
            if (!type.contains("text/event-stream")) {
                // A server that ignores `stream` and answers with plain JSON.
                String piece = contentOf(parse(readSmall(c.getInputStream())));
                if (piece != null && !piece.isEmpty()) {
                    all.append(piece);
                    listener.delta(piece);
                }
                listener.done(all.toString());
                return;
            }

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
            try {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (cancelled) throw new IOException("Cancelled");
                    String trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) continue;
                    String data = trimmed.substring(5).trim();
                    if (data.isEmpty() || "[DONE]".equals(data)) continue;
                    JSONObject event = parse(data);
                    if (event == null) continue;
                    if (event.has("error")) throw new IOException(serverError(event));
                    String piece = contentOf(event);
                    if (piece != null && !piece.isEmpty()) {
                        all.append(piece);
                        listener.delta(piece);
                    }
                }
            } finally {
                try {
                    reader.close();
                } catch (IOException ignored) {
                    // nothing to do
                }
            }
            if (cancelled) throw new IOException("Cancelled");
            listener.done(all.toString());
        } catch (SocketTimeoutException e) {
            failure(listener, "No answer for " + (READ_TIMEOUT_MS / 1000) + " seconds");
        } catch (Exception e) {
            String message = e.getMessage() == null ? e.toString() : e.getMessage();
            if (cancelled || message.contains("Cancelled") || message.contains("closed")) {
                listener.cancelled();
            } else {
                failure(listener, message);
            }
        } finally {
            HttpURLConnection c = connection;
            connection = null;
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Throwable ignored) {
                    // already gone
                }
            }
        }
    }

    private void failure(Listener listener, String message) {
        listener.error(clean(message));
    }

    /** Removes anything that could carry the key out of a message. */
    private String clean(String text) {
        if (text == null || text.isEmpty()) return "The AI request failed";
        return apiKey == null || apiKey.isEmpty() ? text : text.replace(apiKey, "***");
    }

    private String httpError(HttpURLConnection c, int code) {
        String body = "";
        try {
            body = readSmall(c.getErrorStream());
        } catch (Exception ignored) {
            // no body
        }
        JSONObject parsed = parse(body);
        if (parsed != null) {
            JSONObject err = parsed.optJSONObject("error");
            String message = err != null ? err.optString("message", "") : "";
            if (message.isEmpty()) message = parsed.optString("message", "");
            if (!message.isEmpty()) body = message;
        }
        body = clean(body);
        if (body.length() > MAX_ERROR_CHARS) body = body.substring(0, MAX_ERROR_CHARS);
        return "HTTP " + code + (body.isEmpty() ? "" : ": " + body);
    }

    private String serverError(JSONObject event) {
        JSONObject err = event.optJSONObject("error");
        String message = err != null ? err.optString("message", "") : "";
        if (message.isEmpty()) message = event.optString("message", "");
        return message.isEmpty() ? "The server reported an error" : message;
    }

    private static JSONObject parse(String text) {
        if (text == null || text.isEmpty()) return null;
        try {
            return new JSONObject(text);
        } catch (JSONException e) {
            return null;
        }
    }

    private static String contentOf(JSONObject event) {
        if (event == null) return null;
        JSONArray choices = event.optJSONArray("choices");
        if (choices == null || choices.length() == 0) return null;
        JSONObject first = choices.optJSONObject(0);
        if (first == null) return null;
        JSONObject delta = first.optJSONObject("delta");
        if (delta != null && delta.has("content")) return delta.optString("content", "");
        JSONObject message = first.optJSONObject("message");
        if (message != null && message.has("content")) return message.optString("content", "");
        return null;
    }

    private static String readSmall(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = stream.read(buffer)) > 0) {
                out.write(buffer, 0, n);
                if (out.size() > MAX_PLAIN_BODY) break;
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
