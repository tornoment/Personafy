package com.tornoment.personafy;

import android.media.AudioManager;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/* The player's window. The page itself is the same as on the iPhone (mobile/www); here only:
   - the notification / lock-screen player (MediaPlugin + PlaybackService);
   - the phone's volume buttons always change the music's volume;
   - the back button/gesture closes panels and steps back through the screens (app.js backStep);
     on the home screen it sends the app to the background instead of closing it, so the music keeps playing. */
public class MainActivity extends BridgeActivity {

    private static final String BACK_JS =
        "(function(){try{return !!(window.personafyBack&&window.personafyBack())}catch(e){return false}})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaPlugin.class);
        super.onCreate(savedInstanceState);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge != null ? bridge.getWebView() : null;
                if (web == null) {
                    moveTaskToBack(true);
                    return;
                }
                web.evaluateJavascript(BACK_JS, (handled) -> {
                    if (!"true".equals(handled)) moveTaskToBack(true);
                });
            }
        });
    }
}
