# The shell has no reflection-driven code of its own; the WebView bridge is
# reached through the class/method names the JS side uses, so keep them.
-keepclassmembers class com.guantou.mcsim.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.guantou.mcsim.Bridge { *; }
