package com.guantou.mcsim;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JsResult;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

/**
 * The Android half of the MC Command Simulator: a dark, edge-to-edge {@link WebView} that serves the
 * bundled web UI from {@code assets/www} through {@link WebViewAssetLoader} and talks to it through
 * the {@link Bridge} ({@code window.MCSimNative}).
 *
 * <p>The virtual origin is {@code https://appassets.androidplatform.net}. A {@code file://} URL is
 * never used: ES modules and workers would be rejected by the same-origin policy there.
 */
public final class MainActivity extends Activity {
    private static final String TAG = "MCSim";
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/assets/www/index.html";
    private static final int BACKGROUND = 0xFF1E1E1E;

    private WebViewAssetLoader assetLoader;
    private WebView webView;
    private Bridge bridge;
    private FrameLayout root;
    private Object backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            buildUi(savedInstanceState);
        } catch (Throwable t) {
            // Keep the crash, but leave a tagged trace: logcat -s MCSim shows what failed first.
            Log.e(TAG, "startup failed", t);
            throw t;
        }
    }

    private void buildUi(Bundle savedInstanceState) {
        setupWindowChrome();
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        webView = new WebView(this);
        setupWebView();
        bridge = new Bridge(this, webView);
        webView.addJavascriptInterface(bridge, "MCSimNative");
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // Everything that needs a DecorView must come after setContentView(): before it,
        // Window.getInsetsController() throws a NullPointerException on a real device.
        applyEdgeToEdge();
        applyWindowInsets();
        registerBack();
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
        handleIntent(getIntent());
    }

    // ------------------------------------------------------------------ window, theme, insets

    /** Window-only setup: safe before the content view exists. */
    private void setupWindowChrome() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
    }

    /** Edge-to-edge, called after setContentView() so the DecorView already exists. */
    private void applyEdgeToEdge() {
        Window window = getWindow();
        View decor = window.getDecorView();
        if (decor == null) {
            Log.w(TAG, "no DecorView; falling back to a normal window");
            return;
        }
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller != null) {
                // Light (white) status/navigation bar icons over the dark background.
                controller.setSystemBarsAppearance(0,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_DEFAULT);
            } else {
                Log.w(TAG, "no WindowInsetsController; keeping the default system bars");
            }
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    /**
     * Edge-to-edge means the WebView must not be covered by the status bar, the navigation bar, the
     * display cutout or the keyboard; the web UI cannot see {@code env(safe-area-inset-*)} inside a
     * WebView, so the padding is applied here instead.
     */
    private void applyWindowInsets() {
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left;
            int top;
            int right;
            int bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                android.graphics.Insets cutout = insets.getInsets(WindowInsets.Type.displayCutout());
                left = Math.max(bars.left, cutout.left);
                top = Math.max(bars.top, cutout.top);
                right = Math.max(bars.right, cutout.right);
                bottom = Math.max(Math.max(bars.bottom, ime.bottom), cutout.bottom);
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                // adjustResize already shrinks the window for the keyboard before API 30.
                bottom = insets.getSystemWindowInsetBottom();
            }
            if (view.getPaddingLeft() != left || view.getPaddingTop() != top
                    || view.getPaddingRight() != right || view.getPaddingBottom() != bottom) {
                view.setPadding(left, top, right, bottom);
            }
            return insets;
        });
        root.requestApplyInsets();
    }

    // ------------------------------------------------------------------ WebView

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setBlockNetworkLoads(false);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        webView.setBackgroundColor(BACKGROUND);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());
    }

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return assetLoader.shouldInterceptRequest(Uri.parse(url));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return openExternally(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return openExternally(Uri.parse(url));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            Log.i(TAG, "page finished: " + url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request != null && request.isForMainFrame()) {
                Log.e(TAG, "main frame load failed: " + error.getErrorCode() + " " + error.getDescription());
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The renderer died (usually the system reclaiming memory). The page cannot be reused,
            // so close the shell instead of letting the platform kill the process.
            Log.e(TAG, "render process gone, didCrash=" + detail.didCrash());
            if (bridge != null) {
                bridge.destroy();
                bridge = null;
            }
            if (root != null) root.removeView(view);
            webView = null;
            finish();
            return true;
        }
    }

    /**
     * Keeps the app inside its virtual origin: in-app links stay, http(s) links go to the system
     * browser, anything else is denied.
     */
    private boolean openExternally(Uri uri) {
        if (uri == null) return true;
        String url = uri.toString();
        if (url.startsWith(ORIGIN)) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if ("about".equals(scheme) || "data".equals(scheme) || "javascript".equals(scheme)) return true;
        if ("file".equals(scheme)) {
            Log.w(TAG, "blocked file:// navigation: " + url);
            return true;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "no app for " + url);
        }
        return true;
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            int level = message.messageLevel() == ConsoleMessage.MessageLevel.ERROR
                    ? Log.ERROR
                    : message.messageLevel() == ConsoleMessage.MessageLevel.WARNING ? Log.WARN : Log.INFO;
            Log.println(level, TAG, "console: " + message.message() + " ("
                    + message.sourceId() + ":" + message.lineNumber() + ")");
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel())
                    .setCancelable(true)
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .setCancelable(true)
                    .show();
            return true;
        }

        @Override
        public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
            result.confirm();
            return true;
        }
    }

    // ------------------------------------------------------------------ back key

    @SuppressWarnings("deprecation")
    private void registerBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            android.window.OnBackInvokedCallback callback = this::onBackKey;
            backCallback = callback;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
        }
    }

    private void onBackKey() {
        if (bridge != null && bridge.handleBack()) return;
        finish();
    }

    @Override
    public void onBackPressed() {
        if (bridge != null && bridge.handleBack()) return;
        super.onBackPressed();
    }

    // ------------------------------------------------------------------ intents

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** A {@code VIEW} file or shared text is cached by the bridge until the web UI reports {@code app.ready}. */
    private void handleIntent(Intent intent) {
        if (intent == null || bridge == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            bridge.queueExternalUri(intent.getData(), null);
            return;
        }
        if (Intent.ACTION_SEND.equals(action)) {
            String type = intent.getType();
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text != null && (type == null || type.startsWith("text/"))) {
                bridge.queueExternalText(text, subject);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (bridge != null) bridge.onActivityResult(requestCode, resultCode, data);
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onPause() {
        super.onPause();
        if (bridge != null) bridge.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (bridge != null) bridge.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback instanceof android.window.OnBackInvokedCallback) {
            try {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(
                        (android.window.OnBackInvokedCallback) backCallback);
            } catch (Throwable ignored) {
                // already unregistered
            }
        }
        if (bridge != null) {
            bridge.destroy();
            bridge = null;
        }
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
